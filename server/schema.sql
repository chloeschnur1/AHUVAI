-- AHUVAI database schema.
-- Safe to run repeatedly: every statement is idempotent.
--
-- Access model (enforced by PostgreSQL itself, not only by application code):
--   Every request runs inside a transaction that switches to the restricted
--   role "ahuvai_rls" and sets app.role / app.family_id / app.user_id.
--     app.role = 'public'  -> may only INSERT contact messages
--     app.role = 'auth'    -> sign-in / invitation lookups
--     app.role = 'family'  -> may only see rows belonging to app.family_id
--     app.role = 'admin'   -> full access (authorized administrator session)
--     app.role = 'system'  -> maintenance scripts (migrations, seeding)
--   Without a role set, every policy evaluates to false and no rows are visible.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION app_role() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT coalesce(nullif(current_setting('app.role', true), ''), 'none') $$;

CREATE OR REPLACE FUNCTION app_family_id() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('app.family_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION app_is_staff() RETURNS boolean LANGUAGE sql STABLE AS
$$ SELECT app_role() IN ('admin', 'system') $$;

-- ---------------------------------------------------------------- tables

CREATE TABLE IF NOT EXISTS admin_users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE,
  name          text NOT NULL,
  password_hash text NOT NULL,
  totp_secret_enc text,
  totp_enabled  boolean NOT NULL DEFAULT false,
  failed_logins integer NOT NULL DEFAULT 0,
  locked_until  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);


CREATE TABLE IF NOT EXISTS families (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_name        text NOT NULL,
  primary_guardian   text NOT NULL,
  primary_email      text NOT NULL,
  phone              text,
  preferred_contact  text,
  -- Travel details shared by every child in the family (destination, dates, modes ...)
  travel             jsonb NOT NULL DEFAULT '{}'::jsonb,
  status             text NOT NULL DEFAULT 'invited'
                     CHECK (status IN ('contacted','invited','onboarding','profiles_submitted','ready_for_review',
                                       'more_info_needed','active','archived')),
  privacy_consent_at timestamptz,
  is_demo            boolean NOT NULL DEFAULT false,
  submitted_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);


CREATE TABLE IF NOT EXISTS family_users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id     uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  email         text NOT NULL UNIQUE,
  name          text NOT NULL,
  password_hash text NOT NULL,
  failed_logins integer NOT NULL DEFAULT 0,
  locked_until  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);

CREATE TABLE IF NOT EXISTS invitations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id   uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  email       text NOT NULL,
  token_hash  text NOT NULL UNIQUE,
  kind        text NOT NULL DEFAULT 'invite' CHECK (kind IN ('invite','reset')),
  expires_at  timestamptz NOT NULL,
  accepted_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  kind       text NOT NULL CHECK (kind IN ('family','admin')),
  user_id    uuid NOT NULL,
  family_id  uuid REFERENCES families(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS children (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id      uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  position       integer NOT NULL DEFAULT 0,
  full_name      text NOT NULL DEFAULT '',
  preferred_name text NOT NULL DEFAULT '',
  date_of_birth  date,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- One profile per child. Questionnaire answers are encrypted by the application
-- (AES-256-GCM) before they reach the database, in addition to the hosting
-- provider's disk encryption.
CREATE TABLE IF NOT EXISTS child_profiles (
  child_id              uuid PRIMARY KEY REFERENCES children(id) ON DELETE CASCADE,
  family_id             uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  answers_enc           text,          -- current working answers (parent's draft)
  submitted_answers_enc text,          -- exact answers as last submitted (what AHUVAI reviews)
  completion            jsonb NOT NULL DEFAULT '{}'::jsonb,  -- section -> true/false (no sensitive content)
  percent_complete      integer NOT NULL DEFAULT 0,
  completion_status     text NOT NULL DEFAULT 'not_started'
                        CHECK (completion_status IN ('not_started','in_progress','complete','submitted','editing_after_submit')),
  review_status         text NOT NULL DEFAULT 'pending'
                        CHECK (review_status IN ('pending','ready_for_review','more_info_needed','reviewed')),
  health_consent_at     timestamptz,
  first_submitted_at    timestamptz,
  submitted_at          timestamptz,
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admin_notes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id  uuid REFERENCES families(id) ON DELETE CASCADE,
  child_id   uuid REFERENCES children(id) ON DELETE CASCADE,
  author_id  uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  author_name text NOT NULL,
  body       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source     text NOT NULL CHECK (source IN ('family_feedback','contact_form')),
  family_id  uuid REFERENCES families(id) ON DELETE CASCADE,
  name       text,
  email      text,
  subject    text,
  body       text NOT NULL,
  is_read    boolean NOT NULL DEFAULT false,
  is_demo    boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Activity history. Never stores questionnaire content.
CREATE TABLE IF NOT EXISTS audit_log (
  id          bigserial PRIMARY KEY,
  actor_kind  text NOT NULL,
  actor_id    uuid,
  action      text NOT NULL,
  target_type text,
  target_id   uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS children_family_idx ON children(family_id);
CREATE INDEX IF NOT EXISTS child_profiles_family_idx ON child_profiles(family_id);
CREATE INDEX IF NOT EXISTS family_users_family_idx ON family_users(family_id);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS admin_notes_family_idx ON admin_notes(family_id);

-- Earlier versions had a separate inquiry form; families now sign up directly.
ALTER TABLE families DROP COLUMN IF EXISTS inquiry_id;
ALTER TABLE admin_notes DROP COLUMN IF EXISTS inquiry_id;
DROP TABLE IF EXISTS inquiries CASCADE;

-- ---------------------------------------------------------------- restricted role

-- Some hosting providers do not allow creating roles. In that case the app keeps
-- using its own (non-superuser) account, which FORCE ROW LEVEL SECURITY still governs.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ahuvai_rls') THEN
    CREATE ROLE ahuvai_rls NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
  END IF;
  BEGIN
    EXECUTE format('GRANT ahuvai_rls TO %I WITH SET TRUE', current_user);
  EXCEPTION WHEN syntax_error THEN
    EXECUTE format('GRANT ahuvai_rls TO %I', current_user);  -- PostgreSQL 15 and older
  END;
  GRANT USAGE ON SCHEMA public TO ahuvai_rls;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ahuvai_rls;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ahuvai_rls;
  GRANT EXECUTE ON FUNCTION app_role(), app_family_id(), app_is_staff() TO ahuvai_rls;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'Could not set up the ahuvai_rls role; relying on forced row-level security for the app account.';
END $$;

-- ---------------------------------------------------------------- row-level security

ALTER TABLE admin_users    ENABLE ROW LEVEL SECURITY;  ALTER TABLE admin_users    FORCE ROW LEVEL SECURITY;
ALTER TABLE families       ENABLE ROW LEVEL SECURITY;  ALTER TABLE families       FORCE ROW LEVEL SECURITY;
ALTER TABLE family_users   ENABLE ROW LEVEL SECURITY;  ALTER TABLE family_users   FORCE ROW LEVEL SECURITY;
ALTER TABLE invitations    ENABLE ROW LEVEL SECURITY;  ALTER TABLE invitations    FORCE ROW LEVEL SECURITY;
ALTER TABLE sessions       ENABLE ROW LEVEL SECURITY;  ALTER TABLE sessions       FORCE ROW LEVEL SECURITY;
ALTER TABLE children       ENABLE ROW LEVEL SECURITY;  ALTER TABLE children       FORCE ROW LEVEL SECURITY;
ALTER TABLE child_profiles ENABLE ROW LEVEL SECURITY;  ALTER TABLE child_profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE admin_notes    ENABLE ROW LEVEL SECURITY;  ALTER TABLE admin_notes    FORCE ROW LEVEL SECURITY;
ALTER TABLE messages       ENABLE ROW LEVEL SECURITY;  ALTER TABLE messages       FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_log      ENABLE ROW LEVEL SECURITY;  ALTER TABLE audit_log      FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS staff_all ON admin_users;
CREATE POLICY staff_all ON admin_users USING (app_is_staff()) WITH CHECK (app_is_staff());
DROP POLICY IF EXISTS auth_rw ON admin_users;
CREATE POLICY auth_rw ON admin_users USING (app_role() = 'auth') WITH CHECK (app_role() = 'auth');


DROP POLICY IF EXISTS staff_all ON families;
CREATE POLICY staff_all ON families USING (app_is_staff()) WITH CHECK (app_is_staff());
DROP POLICY IF EXISTS family_own ON families;
CREATE POLICY family_own ON families USING (app_role() = 'family' AND id = app_family_id())
  WITH CHECK (app_role() = 'family' AND id = app_family_id());
DROP POLICY IF EXISTS auth_read ON families;
CREATE POLICY auth_read ON families FOR SELECT USING (app_role() = 'auth');

DROP POLICY IF EXISTS staff_all ON family_users;
CREATE POLICY staff_all ON family_users USING (app_is_staff()) WITH CHECK (app_is_staff());
DROP POLICY IF EXISTS family_own ON family_users;
CREATE POLICY family_own ON family_users USING (app_role() = 'family' AND family_id = app_family_id())
  WITH CHECK (app_role() = 'family' AND family_id = app_family_id());
DROP POLICY IF EXISTS auth_rw ON family_users;
CREATE POLICY auth_rw ON family_users USING (app_role() = 'auth') WITH CHECK (app_role() = 'auth');

DROP POLICY IF EXISTS staff_all ON invitations;
CREATE POLICY staff_all ON invitations USING (app_is_staff()) WITH CHECK (app_is_staff());
DROP POLICY IF EXISTS auth_rw ON invitations;
CREATE POLICY auth_rw ON invitations USING (app_role() = 'auth') WITH CHECK (app_role() = 'auth');

DROP POLICY IF EXISTS auth_rw ON sessions;
CREATE POLICY auth_rw ON sessions USING (app_role() IN ('auth','system')) WITH CHECK (app_role() IN ('auth','system'));

DROP POLICY IF EXISTS staff_all ON children;
CREATE POLICY staff_all ON children USING (app_is_staff()) WITH CHECK (app_is_staff());
DROP POLICY IF EXISTS family_own ON children;
CREATE POLICY family_own ON children USING (app_role() = 'family' AND family_id = app_family_id())
  WITH CHECK (app_role() = 'family' AND family_id = app_family_id());

DROP POLICY IF EXISTS staff_all ON child_profiles;
CREATE POLICY staff_all ON child_profiles USING (app_is_staff()) WITH CHECK (app_is_staff());
DROP POLICY IF EXISTS family_own ON child_profiles;
CREATE POLICY family_own ON child_profiles USING (app_role() = 'family' AND family_id = app_family_id())
  WITH CHECK (app_role() = 'family' AND family_id = app_family_id()
              AND family_id = (SELECT c.family_id FROM children c WHERE c.id = child_id));

-- Administrator notes: staff only. Families can never read them.
DROP POLICY IF EXISTS staff_all ON admin_notes;
CREATE POLICY staff_all ON admin_notes USING (app_is_staff()) WITH CHECK (app_is_staff());

DROP POLICY IF EXISTS staff_all ON messages;
CREATE POLICY staff_all ON messages USING (app_is_staff()) WITH CHECK (app_is_staff());
DROP POLICY IF EXISTS public_insert ON messages;
CREATE POLICY public_insert ON messages FOR INSERT WITH CHECK (app_role() = 'public' AND source = 'contact_form' AND family_id IS NULL);
DROP POLICY IF EXISTS family_insert ON messages;
CREATE POLICY family_insert ON messages FOR INSERT WITH CHECK (app_role() = 'family' AND source = 'family_feedback' AND family_id = app_family_id());

DROP POLICY IF EXISTS staff_read ON audit_log;
CREATE POLICY staff_read ON audit_log FOR SELECT USING (app_is_staff());
DROP POLICY IF EXISTS anyone_insert ON audit_log;
CREATE POLICY anyone_insert ON audit_log FOR INSERT WITH CHECK (app_role() IN ('admin','system','family','auth','public'));

-- ---------------------------------------------------------------- column protection
-- Families may update their own travel details and progress, but never the
-- fields that belong to AHUVAI's review process.

CREATE OR REPLACE FUNCTION protect_family_columns() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF app_role() = 'family' THEN
    IF NEW.is_demo IS DISTINCT FROM OLD.is_demo
       OR NEW.primary_email IS DISTINCT FROM OLD.primary_email THEN
      RAISE EXCEPTION 'families may not change protected fields';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status
       AND NEW.status NOT IN ('onboarding', 'profiles_submitted') THEN
      RAISE EXCEPTION 'families may not set status %', NEW.status;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS families_protect ON families;
CREATE TRIGGER families_protect BEFORE UPDATE ON families
  FOR EACH ROW EXECUTE FUNCTION protect_family_columns();

CREATE OR REPLACE FUNCTION protect_profile_columns() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF app_role() = 'family' THEN
    IF TG_OP = 'UPDATE' AND NEW.review_status IS DISTINCT FROM OLD.review_status
       AND NEW.review_status <> 'pending' THEN
      RAISE EXCEPTION 'families may not change review status';
    END IF;
    IF TG_OP = 'INSERT' AND NEW.review_status <> 'pending' THEN
      RAISE EXCEPTION 'families may not set review status';
    END IF;
  ELSIF app_is_staff() AND TG_OP = 'UPDATE' AND app_role() = 'admin' THEN
    -- Administrators review but never alter what parents wrote.
    IF NEW.answers_enc IS DISTINCT FROM OLD.answers_enc
       OR NEW.submitted_answers_enc IS DISTINCT FROM OLD.submitted_answers_enc THEN
      RAISE EXCEPTION 'administrators may not modify parent answers';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS child_profiles_protect ON child_profiles;
CREATE TRIGGER child_profiles_protect BEFORE INSERT OR UPDATE ON child_profiles
  FOR EACH ROW EXECUTE FUNCTION protect_profile_columns();
