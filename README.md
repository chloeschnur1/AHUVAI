# AHUVAI — Private Family Concierge

Public website, private family portal with a 13-step child profile questionnaire, and an
administrator dashboard, backed by PostgreSQL with row-level security.

**Owner's guide (non-technical):** [SETUP-GUIDE.md](SETUP-GUIDE.md)

## Stack

- Node.js 20+ / Express, no front-end build step (plain HTML, CSS, JavaScript)
- PostgreSQL 13+ (tested on 16)
- Self-hosted fonts; strict Content-Security-Policy (no inline scripts or styles, no third-party requests)

## Layout

```
server/
  index.js          app, security headers, page rendering, startup checks
  schema.sql        tables, row-level security policies, protective triggers (idempotent)
  db.js             withContext(): per-request transaction + SET LOCAL ROLE + app.role/app.family_id
  auth.js           family/admin sessions (separate cookies and tables), CSRF guard
  security.js       AES-256-GCM field encryption, scrypt passwords, TOTP
  profiles.js       child profile read/write, completion tracking
  status.js         "secure storage ready" self-check; blocks sensitive writes when not ready
  routes/public.js  inquiry + contact forms (insert-only)
  routes/family.js  family portal API
  routes/admin.js   administrator API
public/js/questionnaire-schema.js   options, validation and completion rules (shared by browser and server)
public/js/portal.js                 family dashboard + questionnaire
public/js/admin.js                  administrator dashboard
views/              layouts, partials and page content
scripts/            seed-demo.js, create-admin.js, demo-data.js
tests/              e2e.test.js, storage-guard.test.js, browser-flow.js
```

## Security model

- Every query runs in a transaction that switches to the restricted `ahuvai_rls` role (or, if the
  host forbids creating roles, the app's own non-superuser account under `FORCE ROW LEVEL SECURITY`)
  and sets `app.role` / `app.family_id`. Policies return no rows when no role is set.
- Families see only rows with their `family_id`. `admin_notes` is staff-only. Triggers stop families
  from changing review fields, and stop administrators from modifying parent answers.
- Answers are stored as AES-256-GCM ciphertext (`answers_enc` for the draft, `submitted_answers_enc`
  for the version AHUVAI reviews). Administrators only ever see submitted versions.
- At startup and every 10 minutes, `status.check()` verifies the encryption key, the role's lack
  of `BYPASSRLS`/superuser, forced RLS on every table, and that private tables look empty without
  a role. If any check fails, all profile writes return `503 storage_not_ready` and the portal
  shows a demonstration-mode banner.

## Local development

```bash
cp .env.example .env              # set DATABASE_URL, DATA_ENCRYPTION_KEY (npm run generate-key), ADMIN_SETUP_TOKEN
npm install
npm run dev                       # http://localhost:3000 ; first admin via /admin with the setup token
npm run seed:demo                 # optional fictional families (marked Demo)
```

## Tests

```bash
# Uses TEST_DATABASE_URL (default postgres://ahuvai:ahuvai_dev@localhost:5432/ahuvai_test); the test DB is wiped.
npm test               # API end-to-end scenario + access-control + storage guard (19 tests)
npm run test:browser   # real browser: inquiry → invite → 3 children × 13 steps → admin review; screenshots in ./screenshots
```

Run the tests with a non-superuser database account, because superusers bypass row-level security.

## Deployment

`render.yaml` defines a Render web service and a private PostgreSQL database. Any Node host
with PostgreSQL works. Set `NODE_ENV=production`, `PUBLIC_URL=https://…`, `DATABASE_URL`,
`DATA_ENCRYPTION_KEY` and `ADMIN_SETUP_TOKEN`. See SETUP-GUIDE.md.
