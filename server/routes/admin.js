'use strict';
// Private administrator API. Requires an administrator session; families'
// sessions are never accepted here.
const express = require('express');
const rateLimit = require('express-rate-limit');
const QRCode = require('qrcode');
const db = require('../db');
const config = require('../config');
const mailer = require('../mailer');
const auth = require('../auth');
const status = require('../status');
const v = require('../validate');
const profiles = require('../profiles');
const schema = require('../../public/js/questionnaire-schema');
const sec = require('../security');

const router = express.Router();
const loginLimit = rateLimit({ windowMs: 15 * 60e3, limit: 15, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait a few minutes and try again.' } });

const INQUIRY_STATUSES = ['new', 'reviewed', 'contacted', 'invited', 'declined', 'archived'];
const FAMILY_STATUSES = ['contacted', 'invited', 'onboarding', 'profiles_submitted', 'ready_for_review', 'more_info_needed', 'active', 'archived'];
const REVIEW_STATUSES = ['pending', 'ready_for_review', 'more_info_needed', 'reviewed'];

// ---------------------------------------------------------------- first-time setup & sign in

router.get('/setup-status', async (req, res, next) => {
  try {
    const n = await db.withContext({ role: 'auth' }, async (c) => (await c.query('SELECT count(*)::int AS n FROM admin_users')).rows[0].n);
    res.json({ needsSetup: n === 0, setupEnabled: !!config.adminSetupToken });
  } catch (err) { next(err); }
});

router.post('/setup', loginLimit, async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!config.adminSetupToken || String(b.token || '') !== config.adminSetupToken) {
      return res.status(403).json({ error: 'The setup code is not correct.' });
    }
    const name = v.text(b.name, { label: 'your name', max: 120, required: true });
    const email = v.email(b.email);
    const problem = sec.passwordProblem(b.password);
    if (problem) throw new v.ValidationError(problem);
    const hash = sec.hashPassword(b.password);
    const id = await db.withContext({ role: 'auth' }, async (c) => {
      await c.query('LOCK TABLE admin_users IN EXCLUSIVE MODE');
      const n = (await c.query('SELECT count(*)::int AS n FROM admin_users')).rows[0].n;
      if (n > 0) return null;
      return (await c.query('INSERT INTO admin_users (email, name, password_hash) VALUES ($1,$2,$3) RETURNING id', [email, name, hash])).rows[0].id;
    });
    if (!id) return res.status(403).json({ error: 'Setup has already been completed. Please sign in.' });
    await auth.startSession(res, 'admin', id);
    res.status(201).json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/login', loginLimit, async (req, res, next) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const code = String(req.body?.code || '').trim();
    const result = await db.withContext({ role: 'auth' }, async (c) => {
      const r = await c.query('SELECT id, password_hash, totp_enabled, totp_secret_enc, locked_until FROM admin_users WHERE email = $1', [email]);
      const u = r.rows[0];
      const ok = sec.verifyPassword(password, u ? u.password_hash : sec.DUMMY_HASH);
      if (u && u.locked_until && u.locked_until > new Date()) return { locked: true };
      const fail = async () => {
        if (u) await c.query(`UPDATE admin_users SET failed_logins = failed_logins + 1,
          locked_until = CASE WHEN failed_logins + 1 >= 6 THEN now() + interval '30 minutes' END WHERE id = $1`, [u.id]);
        return null;
      };
      if (!u || !ok) return fail();
      if (u.totp_enabled) {
        if (!code) return { needCode: true };
        if (!sec.verifyTotp(sec.decryptText(u.totp_secret_enc), code)) return fail();
      }
      await c.query('UPDATE admin_users SET failed_logins = 0, locked_until = NULL, last_login_at = now() WHERE id = $1', [u.id]);
      return { id: u.id };
    });
    if (result && result.locked) return res.status(429).json({ error: 'This account is temporarily locked. Please try again in 30 minutes.' });
    if (result && result.needCode) return res.status(401).json({ needCode: true, error: 'Please enter the 6-digit code from your authenticator app.' });
    if (!result) return res.status(401).json({ error: 'Those sign-in details were not recognised.' });
    await auth.startSession(res, 'admin', result.id);
    await db.withContext({ role: 'admin', userId: result.id }, (c) => db.audit(c, { kind: 'admin', userId: result.id }, 'admin.login'));
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/logout', async (req, res, next) => {
  try { await auth.endSession(req, res, 'admin'); res.json({ ok: true }); } catch (err) { next(err); }
});

// ---------------------------------------------------------------- everything below requires an administrator

router.use(auth.requireAdmin);

const q = (req, fn) => db.withContext(req.dbctx, fn);

router.get('/me', async (req, res, next) => {
  try {
    const me = await q(req, async (c) => (await c.query('SELECT id, name, email, totp_enabled FROM admin_users WHERE id = $1', [req.actor.userId])).rows[0]);
    if (!me) return res.status(401).json({ error: 'Please sign in to continue.' });
    res.json({ me, storage: status.get(), emailConfigured: mailer.isConfigured() });
  } catch (err) { next(err); }
});

router.get('/overview', async (req, res, next) => {
  try {
    const data = await q(req, async (c) => {
      const stats = (await c.query(`SELECT
        (SELECT count(*) FROM inquiries)::int AS total_inquiries,
        (SELECT count(*) FROM inquiries WHERE status = 'new')::int AS new_inquiries,
        (SELECT count(*) FROM families WHERE status <> 'archived')::int AS active_families,
        (SELECT count(*) FROM children)::int AS child_profiles,
        (SELECT count(*) FROM child_profiles WHERE submitted_at IS NOT NULL)::int AS completed_profiles,
        (SELECT count(*) FROM child_profiles WHERE submitted_at IS NULL)::int AS incomplete_profiles,
        (SELECT count(*) FROM messages WHERE NOT is_read)::int AS unread_messages`)).rows[0];
      const recent = (await c.query(`SELECT c.id, c.preferred_name, c.full_name, to_char(c.date_of_birth,'YYYY-MM-DD') AS dob,
          f.id AS family_id, f.family_name, f.travel->>'destination' AS destination, p.submitted_at, p.review_status, p.completion_status
        FROM child_profiles p JOIN children c ON c.id = p.child_id JOIN families f ON f.id = p.family_id
        WHERE p.submitted_at IS NOT NULL ORDER BY p.submitted_at DESC LIMIT 8`)).rows;
      const inquiries = (await c.query(`SELECT id, parent_name, destination, num_children, created_at, status FROM inquiries
        WHERE status = 'new' ORDER BY created_at DESC LIMIT 5`)).rows;
      return { stats, recent: recent.map((r) => ({ ...r, age_label: schema.ageLabel(r.dob) })), inquiries };
    });
    res.json(data);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------- inquiries

router.get('/inquiries', async (req, res, next) => {
  try {
    const st = INQUIRY_STATUSES.includes(req.query.status) ? req.query.status : null;
    const rows = await q(req, async (c) => (await c.query(
      `SELECT id, parent_name, email, preferred_contact, destination, to_char(travel_start,'YYYY-MM-DD') AS travel_start,
              to_char(travel_end,'YYYY-MM-DD') AS travel_end, num_children, children_ages, nanny_type, status, family_id, created_at
         FROM inquiries WHERE ($1::text IS NULL OR status = $1) ORDER BY created_at DESC LIMIT 500`, [st])).rows);
    res.json({ inquiries: rows });
  } catch (err) { next(err); }
});

router.get('/inquiries/:id', async (req, res, next) => {
  try {
    const id = v.uuid(req.params.id);
    const data = await q(req, async (c) => {
      const r = await c.query(`SELECT *, to_char(travel_start,'YYYY-MM-DD') AS travel_start, to_char(travel_end,'YYYY-MM-DD') AS travel_end
        FROM inquiries WHERE id = $1`, [id]);
      if (!r.rows[0]) return null;
      const notes = (await c.query('SELECT id, author_name, body, created_at FROM admin_notes WHERE inquiry_id = $1 ORDER BY created_at DESC', [id])).rows;
      return { inquiry: r.rows[0], notes };
    });
    if (!data) return res.status(404).json({ error: 'Not found.' });
    res.json(data);
  } catch (err) { next(err); }
});

router.patch('/inquiries/:id', async (req, res, next) => {
  try {
    const id = v.uuid(req.params.id);
    const st = v.oneOf(req.body?.status, INQUIRY_STATUSES, { label: 'a status', required: true });
    const n = await q(req, async (c) => {
      const r = await c.query('UPDATE inquiries SET status = $2, updated_at = now() WHERE id = $1', [id, st]);
      await db.audit(c, req.actor, `inquiry.status.${st}`, 'inquiry', id);
      return r.rowCount;
    });
    if (!n) return res.status(404).json({ error: 'Not found.' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

function familyNameFrom(parentName) {
  const parts = parentName.trim().split(/\s+/);
  return parts.length > 1 ? `The ${parts[parts.length - 1]} Family` : `The ${parts[0]} Family`;
}

async function createInvitation(c, familyId, email) {
  const token = sec.randomToken();
  await c.query(`UPDATE invitations SET expires_at = now() WHERE family_id = $1 AND kind = 'invite' AND accepted_at IS NULL`, [familyId]);
  await c.query(`INSERT INTO invitations (family_id, email, token_hash, kind, expires_at)
    VALUES ($1, $2, $3, 'invite', now() + ($4 || ' days')::interval)`, [familyId, email, sec.sha256(token), String(config.invitationDays)]);
  return `${config.publicUrl}/portal/invite?token=${token}`;
}

async function sendInvitationEmail(email, guardian, url) {
  return mailer.send({
    to: email,
    subject: 'Your private AHUVAI family portal',
    paragraphs: [`Dear ${guardian},`,
      'Thank you for your interest in AHUVAI. We would be delighted to get to know your family.',
      `Please use the button below to create your private portal account, where you can share a profile for each of your children. This invitation is personal to you and expires in ${config.invitationDays} days.`],
    button: { label: 'Create Your Account', url },
  });
}

router.post('/inquiries/:id/invite', async (req, res, next) => {
  try {
    const id = v.uuid(req.params.id);
    const result = await q(req, async (c) => {
      const inq = (await c.query(`SELECT *, to_char(travel_start,'YYYY-MM-DD') AS ts, to_char(travel_end,'YYYY-MM-DD') AS te FROM inquiries WHERE id = $1`, [id])).rows[0];
      if (!inq) return null;
      let familyId = inq.family_id;
      if (!familyId) {
        const existingUser = await c.query('SELECT family_id FROM family_users WHERE email = $1', [inq.email]);
        if (existingUser.rows[0]) {
          familyId = existingUser.rows[0].family_id;
        } else {
          const travel = schema.sanitizeFamilyTravel({ destination: inq.destination, start_date: inq.ts, end_date: inq.te });
          familyId = (await c.query(`INSERT INTO families (family_name, primary_guardian, primary_email, phone, preferred_contact, travel, inquiry_id, status, is_demo)
            VALUES ($1,$2,$3,$4,$5,$6,$7,'invited',$8) RETURNING id`,
            [familyNameFrom(inq.parent_name), inq.parent_name, inq.email, inq.phone, inq.preferred_contact, travel, inq.id, inq.is_demo])).rows[0].id;
        }
        await c.query(`UPDATE inquiries SET family_id = $2 WHERE id = $1`, [id, familyId]);
      }
      await c.query(`UPDATE inquiries SET status = 'invited', updated_at = now() WHERE id = $1`, [id]);
      const url = await createInvitation(c, familyId, inq.email);
      await db.audit(c, req.actor, 'inquiry.invited', 'family', familyId);
      return { familyId, url, email: inq.email, guardian: inq.parent_name };
    });
    if (!result) return res.status(404).json({ error: 'Not found.' });
    const mail = await sendInvitationEmail(result.email, result.guardian, result.url);
    res.json({ ok: true, familyId: result.familyId, inviteUrl: result.url, emailSent: mail.sent, emailNote: mail.reason || null });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------- families

router.get('/families', async (req, res, next) => {
  try {
    const search = typeof req.query.q === 'string' && req.query.q.trim() ? `%${req.query.q.trim()}%` : null;
    const st = FAMILY_STATUSES.includes(req.query.status) ? req.query.status : null;
    const dest = typeof req.query.destination === 'string' && req.query.destination.trim() ? `%${req.query.destination.trim()}%` : null;
    const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '') ? req.query.from : null;
    const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to || '') ? req.query.to : null;
    const rows = await q(req, async (c) => (await c.query(
      `SELECT f.id, f.family_name, f.primary_guardian, f.primary_email, f.status, f.created_at, f.submitted_at, f.is_demo,
              f.travel->>'destination' AS destination, f.travel->>'start_date' AS start_date, f.travel->>'end_date' AS end_date,
              (SELECT count(*) FROM children c WHERE c.family_id = f.id)::int AS children,
              (SELECT count(*) FROM child_profiles p WHERE p.family_id = f.id AND p.submitted_at IS NOT NULL)::int AS submitted
         FROM families f
        WHERE ($1::text IS NULL OR f.family_name ILIKE $1 OR f.primary_guardian ILIKE $1 OR f.primary_email ILIKE $1)
          AND ($2::text IS NULL OR f.status = $2)
          AND ($3::text IS NULL OR f.travel->>'destination' ILIKE $3)
          AND ($4::text IS NULL OR coalesce(nullif(f.travel->>'end_date',''), nullif(f.travel->>'start_date','')) >= $4)
          AND ($5::text IS NULL OR nullif(f.travel->>'start_date','') <= $5)
        ORDER BY coalesce(f.submitted_at, f.created_at) DESC LIMIT 500`, [search, st, dest, from, to])).rows);
    res.json({ families: rows });
  } catch (err) { next(err); }
});

router.post('/families', async (req, res, next) => {
  try {
    const b = req.body || {};
    const guardian = v.text(b.primary_guardian, { label: "the parent's name", max: 120, required: true });
    const email = v.email(b.primary_email);
    const name = v.text(b.family_name, { label: 'the family name', max: 120 }) || familyNameFrom(guardian);
    const result = await q(req, async (c) => {
      const exists = await c.query('SELECT 1 FROM family_users WHERE email = $1', [email]);
      if (exists.rowCount) return { error: 'A family account with this email already exists.' };
      const id = (await c.query(`INSERT INTO families (family_name, primary_guardian, primary_email, status) VALUES ($1,$2,$3,'invited') RETURNING id`,
        [name, guardian, email])).rows[0].id;
      const url = await createInvitation(c, id, email);
      await db.audit(c, req.actor, 'family.created', 'family', id);
      return { id, url };
    });
    if (result.error) return res.status(400).json({ error: result.error });
    const mail = await sendInvitationEmail(email, guardian, result.url);
    res.status(201).json({ ok: true, familyId: result.id, inviteUrl: result.url, emailSent: mail.sent, emailNote: mail.reason || null });
  } catch (err) { next(err); }
});

router.get('/families/:id', async (req, res, next) => {
  try {
    const id = v.uuid(req.params.id);
    const data = await q(req, async (c) => {
      const f = (await c.query('SELECT * FROM families WHERE id = $1', [id])).rows[0];
      if (!f) return null;
      const children = (await profiles.listChildren(c, id)).map(profiles.summary);
      const users = (await c.query('SELECT name, email, created_at, last_login_at FROM family_users WHERE family_id = $1', [id])).rows;
      const notes = (await c.query('SELECT id, child_id, author_name, body, created_at FROM admin_notes WHERE family_id = $1 AND child_id IS NULL ORDER BY created_at DESC', [id])).rows;
      const invites = (await c.query(`SELECT created_at, expires_at, accepted_at FROM invitations WHERE family_id = $1 AND kind = 'invite' ORDER BY created_at DESC LIMIT 5`, [id])).rows;
      const inquiry = f.inquiry_id ? (await c.query(`SELECT id, created_at, nanny_type, care_duration, children_ages, preferences, cultural_considerations FROM inquiries WHERE id = $1`, [f.inquiry_id])).rows[0] : null;
      await db.audit(c, req.actor, 'family.viewed', 'family', id);
      return { family: f, children, users, notes, invites, inquiry };
    });
    if (!data) return res.status(404).json({ error: 'Not found.' });
    res.json(data);
  } catch (err) { next(err); }
});

router.patch('/families/:id', async (req, res, next) => {
  try {
    const id = v.uuid(req.params.id);
    const b = req.body || {};
    const sets = [];
    const vals = [id];
    if (b.status !== undefined) { vals.push(v.oneOf(b.status, FAMILY_STATUSES, { label: 'a status', required: true })); sets.push(`status = $${vals.length}`); }
    if (b.family_name !== undefined) { vals.push(v.text(b.family_name, { label: 'the family name', max: 120, required: true })); sets.push(`family_name = $${vals.length}`); }
    if (b.phone !== undefined) { vals.push(v.text(b.phone, { label: 'phone', max: 40 })); sets.push(`phone = $${vals.length}`); }
    if (!sets.length) throw new v.ValidationError('Nothing to update.');
    const n = await q(req, async (c) => {
      const r = await c.query(`UPDATE families SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, vals);
      await db.audit(c, req.actor, b.status ? `family.status.${b.status}` : 'family.updated', 'family', id);
      return r.rowCount;
    });
    if (!n) return res.status(404).json({ error: 'Not found.' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/families/:id/invite', async (req, res, next) => {
  try {
    const id = v.uuid(req.params.id);
    const result = await q(req, async (c) => {
      const f = (await c.query('SELECT id, primary_email, primary_guardian FROM families WHERE id = $1', [id])).rows[0];
      if (!f) return null;
      const hasAccount = (await c.query('SELECT 1 FROM family_users WHERE family_id = $1', [id])).rowCount > 0;
      if (hasAccount) return { hasAccount, f };
      const url = await createInvitation(c, id, f.primary_email);
      await db.audit(c, req.actor, 'family.invite_resent', 'family', id);
      return { url, f };
    });
    if (!result) return res.status(404).json({ error: 'Not found.' });
    if (result.hasAccount) {
      const mail = await mailer.send({
        to: result.f.primary_email, subject: 'A note from AHUVAI',
        paragraphs: [`Dear ${result.f.primary_guardian},`, 'A gentle reminder that your private AHUVAI family portal is ready whenever you are.'],
        button: { label: 'Sign In', url: `${config.publicUrl}/portal` },
      });
      return res.json({ ok: true, hasAccount: true, emailSent: mail.sent, emailNote: mail.reason || null });
    }
    const mail = await sendInvitationEmail(result.f.primary_email, result.f.primary_guardian, result.url);
    res.json({ ok: true, inviteUrl: result.url, emailSent: mail.sent, emailNote: mail.reason || null });
  } catch (err) { next(err); }
});

router.post('/families/:id/reset-link', async (req, res, next) => {
  try {
    const id = v.uuid(req.params.id);
    const token = sec.randomToken();
    const user = await q(req, async (c) => {
      const u = (await c.query('SELECT email, name FROM family_users WHERE family_id = $1 ORDER BY created_at LIMIT 1', [id])).rows[0];
      if (!u) return null;
      await c.query(`INSERT INTO invitations (family_id, email, token_hash, kind, expires_at)
        VALUES ($1, $2, $3, 'reset', now() + interval '48 hours')`, [id, u.email, sec.sha256(token)]);
      await db.audit(c, req.actor, 'family.reset_link_created', 'family', id);
      return u;
    });
    if (!user) return res.status(404).json({ error: 'This family has no portal account yet.' });
    const url = `${config.publicUrl}/portal/reset?token=${token}`;
    const mail = await mailer.send({
      to: user.email, subject: 'Reset your AHUVAI password',
      paragraphs: [`Dear ${user.name},`, 'Please use the button below within 48 hours to choose a new password for your AHUVAI family portal.'],
      button: { label: 'Choose a New Password', url },
    });
    res.json({ ok: true, inviteUrl: url, emailSent: mail.sent, emailNote: mail.reason || null });
  } catch (err) { next(err); }
});

router.post('/families/:id/request-info', async (req, res, next) => {
  try {
    const id = v.uuid(req.params.id);
    const message = v.text(req.body?.message, { label: 'a message', max: 2000 });
    const childIds = Array.isArray(req.body?.child_ids) ? req.body.child_ids.map(v.uuid) : [];
    const f = await q(req, async (c) => {
      const fam = (await c.query('SELECT id, primary_email, primary_guardian FROM families WHERE id = $1', [id])).rows[0];
      if (!fam) return null;
      if (childIds.length) {
        await c.query(`UPDATE child_profiles SET review_status = 'more_info_needed' WHERE family_id = $1 AND child_id = ANY($2::uuid[])`, [id, childIds]);
      }
      await c.query(`UPDATE families SET status = 'more_info_needed', updated_at = now() WHERE id = $1`, [id]);
      await db.audit(c, req.actor, 'family.more_info_requested', 'family', id);
      return fam;
    });
    if (!f) return res.status(404).json({ error: 'Not found.' });
    const paragraphs = [`Dear ${f.primary_guardian},`,
      'Thank you for sharing your family profiles with AHUVAI. To prepare the best possible care, we would be grateful for a little more information.'];
    if (message) paragraphs.push(message);
    paragraphs.push('Please sign in to your private portal to review and update your profiles.');
    const mail = await mailer.send({ to: f.primary_email, subject: 'A little more information for your AHUVAI profile', paragraphs,
      button: { label: 'Sign In', url: `${config.publicUrl}/portal` } });
    res.json({ ok: true, emailSent: mail.sent, emailNote: mail.reason || null });
  } catch (err) { next(err); }
});

router.get('/families/:id/export', async (req, res, next) => {
  try {
    const id = v.uuid(req.params.id);
    const data = await q(req, async (c) => {
      const f = (await c.query('SELECT * FROM families WHERE id = $1', [id])).rows[0];
      if (!f) return null;
      const users = (await c.query('SELECT name, email, created_at, last_login_at FROM family_users WHERE family_id = $1', [id])).rows;
      const inquiry = f.inquiry_id ? (await c.query('SELECT * FROM inquiries WHERE id = $1', [f.inquiry_id])).rows[0] : null;
      const kids = await profiles.listChildren(c, id);
      const messages = (await c.query(`SELECT subject, body, created_at FROM messages WHERE family_id = $1`, [id])).rows;
      await db.audit(c, req.actor, 'family.exported', 'family', id);
      return {
        exported_at: new Date().toISOString(),
        family: { name: f.family_name, primary_guardian: f.primary_guardian, email: f.primary_email, phone: f.phone,
          preferred_contact: f.preferred_contact, status: f.status, travel: f.travel, privacy_consent_at: f.privacy_consent_at, created_at: f.created_at },
        account_holders: users,
        inquiry,
        children: kids.map((k) => ({
          ...profiles.summary(k),
          submitted_answers: k.submitted_answers_enc ? sec.decryptJSON(k.submitted_answers_enc) : null,
          current_answers: sec.decryptJSON(k.answers_enc),
          health_consent_at: k.health_consent_at,
        })),
        messages,
      };
    });
    if (!data) return res.status(404).json({ error: 'Not found.' });
    const slug = data.family.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    res.setHeader('Content-Disposition', `attachment; filename="ahuvai-${slug}-${new Date().toISOString().slice(0, 10)}.json"`);
    res.setHeader('Cache-Control', 'no-store');
    res.type('application/json').send(JSON.stringify(data, null, 2));
  } catch (err) { next(err); }
});

router.delete('/families/:id', async (req, res, next) => {
  try {
    const id = v.uuid(req.params.id);
    const result = await q(req, async (c) => {
      const f = (await c.query('SELECT family_name, inquiry_id FROM families WHERE id = $1', [id])).rows[0];
      if (!f) return null;
      if (String(req.body?.confirm || '').trim() !== f.family_name) return { mismatch: true };
      await c.query('DELETE FROM families WHERE id = $1', [id]);
      await c.query('DELETE FROM inquiries WHERE id = $1 OR family_id = $2', [f.inquiry_id, id]);
      await db.audit(c, req.actor, 'family.deleted', 'family', id);
      return { ok: true };
    });
    if (!result) return res.status(404).json({ error: 'Not found.' });
    if (result.mismatch) return res.status(400).json({ error: 'Please type the family name exactly to confirm deletion.' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------- children

router.get('/children', async (req, res, next) => {
  try {
    const submittedOnly = req.query.submitted === '1';
    const search = typeof req.query.q === 'string' && req.query.q.trim() ? `%${req.query.q.trim()}%` : null;
    const rows = await q(req, async (c) => (await c.query(
      `SELECT c.id, c.preferred_name, c.full_name, to_char(c.date_of_birth,'YYYY-MM-DD') AS dob, c.position,
              f.id AS family_id, f.family_name, f.travel->>'destination' AS destination,
              p.percent_complete, p.completion_status, p.review_status, p.completion, p.submitted_at, p.updated_at
         FROM children c JOIN child_profiles p ON p.child_id = c.id JOIN families f ON f.id = c.family_id
        WHERE ($1::boolean IS FALSE OR p.submitted_at IS NOT NULL)
          AND ($2::text IS NULL OR c.full_name ILIKE $2 OR c.preferred_name ILIKE $2 OR f.family_name ILIKE $2)
        ORDER BY ${submittedOnly ? 'p.submitted_at DESC' : 'f.family_name, c.position'} LIMIT 1000`, [submittedOnly, search])).rows);
    res.json({ children: rows.map((r) => ({ ...r, age_label: schema.ageLabel(r.dob),
      missing: schema.SECTIONS.filter((s) => !(r.completion || {})[s.key]).map((s) => s.key) })) });
  } catch (err) { next(err); }
});

router.get('/children/:id', async (req, res, next) => {
  try {
    const id = v.uuid(req.params.id);
    const data = await q(req, async (c) => {
      const row = await profiles.getChild(c, id);
      if (!row) return null;
      const family = (await c.query('SELECT id, family_name, primary_guardian, primary_email, status, travel FROM families WHERE id = $1', [row.family_id])).rows[0];
      const siblings = (await profiles.listChildren(c, row.family_id)).map(profiles.summary);
      const notes = (await c.query('SELECT id, author_name, body, created_at FROM admin_notes WHERE child_id = $1 ORDER BY created_at DESC', [id])).rows;
      await db.audit(c, req.actor, 'child.viewed', 'child', id);
      return { row, family, siblings, notes };
    });
    if (!data) return res.status(404).json({ error: 'Not found.' });
    // Administrators see exactly what the parent submitted — never an unsent draft.
    const submitted = data.row.submitted_answers_enc ? schema.sanitizeAnswers(sec.decryptJSON(data.row.submitted_answers_enc)) : null;
    res.json({
      child: profiles.summary(data.row),
      answers: submitted,
      submittedCompletion: submitted ? schema.completion(submitted, data.family.travel) : null,
      parentEditing: data.row.completion_status === 'editing_after_submit',
      health_consent_at: data.row.health_consent_at,
      family: data.family, siblings: data.siblings, notes: data.notes,
    });
  } catch (err) { next(err); }
});

router.patch('/children/:id/review', async (req, res, next) => {
  try {
    const id = v.uuid(req.params.id);
    const st = v.oneOf(req.body?.review_status, REVIEW_STATUSES, { label: 'a review status', required: true });
    const n = await q(req, async (c) => {
      const r = await c.query('UPDATE child_profiles SET review_status = $2 WHERE child_id = $1', [id, st]);
      await db.audit(c, req.actor, `child.review.${st}`, 'child', id);
      return r.rowCount;
    });
    if (!n) return res.status(404).json({ error: 'Not found.' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.get('/care-preferences', async (req, res, next) => {
  try {
    const rows = await q(req, async (c) => (await c.query(
      `SELECT c.id, c.preferred_name, c.full_name, to_char(c.date_of_birth,'YYYY-MM-DD') AS dob, f.id AS family_id, f.family_name,
              f.travel->>'destination' AS destination, p.submitted_answers_enc
         FROM children c JOIN child_profiles p ON p.child_id = c.id JOIN families f ON f.id = c.family_id
        WHERE p.submitted_answers_enc IS NOT NULL AND f.status <> 'archived' ORDER BY f.family_name, c.position`)).rows);
    res.json({ children: rows.map((r) => {
      const a = schema.sanitizeAnswers(sec.decryptJSON(r.submitted_answers_enc));
      return {
        id: r.id, family_id: r.family_id, family_name: r.family_name, destination: r.destination,
        name: r.preferred_name || r.full_name, age_label: schema.ageLabel(r.dob),
        allergies: a.health.has_allergies, allergy_details: a.health.allergy_details,
        diet: a.health.diet, traditions: a.traditions.picks, sensory: a.sensory.picks,
        comfort: a.comfort.picks, arrangement: a.travel.arrangement, languages: a.basic.languages,
        medical: !!(a.health.medical_conditions || a.health.medications),
      };
    }) });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------- notes & messages

router.post('/notes', async (req, res, next) => {
  try {
    const b = req.body || {};
    const body = v.text(b.body, { label: 'a note', max: 5000, required: true });
    const familyId = b.family_id ? v.uuid(b.family_id) : null;
    const childId = b.child_id ? v.uuid(b.child_id) : null;
    const inquiryId = b.inquiry_id ? v.uuid(b.inquiry_id) : null;
    if (!familyId && !inquiryId) throw new v.ValidationError('A note must belong to a family or an inquiry.');
    const note = await q(req, async (c) => {
      const me = (await c.query('SELECT name FROM admin_users WHERE id = $1', [req.actor.userId])).rows[0];
      return (await c.query(`INSERT INTO admin_notes (family_id, child_id, inquiry_id, author_id, author_name, body)
        VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, author_name, body, created_at`, [familyId, childId, inquiryId, req.actor.userId, me.name, body])).rows[0];
    });
    res.status(201).json({ note });
  } catch (err) { next(err); }
});

router.delete('/notes/:id', async (req, res, next) => {
  try {
    const id = v.uuid(req.params.id);
    await q(req, (c) => c.query('DELETE FROM admin_notes WHERE id = $1', [id]));
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.get('/messages', async (req, res, next) => {
  try {
    const rows = await q(req, async (c) => (await c.query(
      `SELECT m.id, m.source, m.family_id, f.family_name, m.name, m.email, m.subject, m.body, m.is_read, m.created_at
         FROM messages m LEFT JOIN families f ON f.id = m.family_id ORDER BY m.created_at DESC LIMIT 500`)).rows);
    res.json({ messages: rows });
  } catch (err) { next(err); }
});

router.patch('/messages/:id', async (req, res, next) => {
  try {
    const id = v.uuid(req.params.id);
    await q(req, (c) => c.query('UPDATE messages SET is_read = $2 WHERE id = $1', [id, req.body?.is_read === true]));
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.delete('/messages/:id', async (req, res, next) => {
  try {
    const id = v.uuid(req.params.id);
    await q(req, (c) => c.query('DELETE FROM messages WHERE id = $1', [id]));
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------- settings

router.get('/settings', async (req, res, next) => {
  try {
    const data = await q(req, async (c) => {
      const admins = (await c.query('SELECT id, name, email, totp_enabled, created_at, last_login_at FROM admin_users ORDER BY created_at')).rows;
      const demo = (await c.query(`SELECT (SELECT count(*) FROM families WHERE is_demo)::int AS families,
        (SELECT count(*) FROM inquiries WHERE is_demo)::int AS inquiries, (SELECT count(*) FROM messages WHERE is_demo)::int AS messages`)).rows[0];
      const retention = (await c.query(`SELECT id, family_name, status, updated_at FROM families
        WHERE status = 'archived' OR updated_at < now() - ($1 || ' months')::interval ORDER BY updated_at LIMIT 200`, [String(config.retentionMonths)])).rows;
      const oldInquiries = (await c.query(`SELECT count(*)::int AS n FROM inquiries WHERE status IN ('declined','archived') AND updated_at < now() - ($1 || ' months')::interval`, [String(config.retentionMonths)])).rows[0].n;
      return { admins, demo, retention, oldInquiries };
    });
    res.json({ ...data, meId: req.actor.userId, emailConfigured: mailer.isConfigured(), storage: status.get(),
      retentionMonths: config.retentionMonths, publicUrl: config.publicUrl });
  } catch (err) { next(err); }
});

router.post('/admins', async (req, res, next) => {
  try {
    const name = v.text(req.body?.name, { label: 'a name', max: 120, required: true });
    const email = v.email(req.body?.email);
    const problem = sec.passwordProblem(req.body?.password);
    if (problem) throw new v.ValidationError(problem);
    const hash = sec.hashPassword(req.body.password);
    const result = await q(req, async (c) => {
      const exists = await c.query('SELECT 1 FROM admin_users WHERE email = $1', [email]);
      if (exists.rowCount) return null;
      const id = (await c.query('INSERT INTO admin_users (email, name, password_hash) VALUES ($1,$2,$3) RETURNING id', [email, name, hash])).rows[0].id;
      await db.audit(c, req.actor, 'admin.created', 'admin', id);
      return id;
    });
    if (!result) return res.status(400).json({ error: 'An administrator with this email already exists.' });
    res.status(201).json({ ok: true });
  } catch (err) { next(err); }
});

router.delete('/admins/:id', async (req, res, next) => {
  try {
    const id = v.uuid(req.params.id);
    if (id === req.actor.userId) return res.status(400).json({ error: 'You cannot remove your own account.' });
    await q(req, async (c) => {
      await c.query('DELETE FROM admin_users WHERE id = $1', [id]);
      await db.audit(c, req.actor, 'admin.removed', 'admin', id);
    });
    await db.withContext({ role: 'system' }, (c) => auth.endAllSessionsFor(c, id));
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/me/password', async (req, res, next) => {
  try {
    const problem = sec.passwordProblem(req.body?.next);
    if (problem) throw new v.ValidationError(problem);
    const ok = await q(req, async (c) => {
      const u = (await c.query('SELECT password_hash FROM admin_users WHERE id = $1', [req.actor.userId])).rows[0];
      if (!u || !sec.verifyPassword(String(req.body?.current || ''), u.password_hash)) return false;
      await c.query('UPDATE admin_users SET password_hash = $2 WHERE id = $1', [req.actor.userId, sec.hashPassword(req.body.next)]);
      await db.audit(c, req.actor, 'admin.password_changed', 'admin', req.actor.userId);
      return true;
    });
    if (!ok) return res.status(400).json({ error: 'Your current password is not correct.' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/me/totp/setup', async (req, res, next) => {
  try {
    const secret = sec.totpSecret();
    const me = await q(req, async (c) => {
      await c.query('UPDATE admin_users SET totp_secret_enc = $2, totp_enabled = false WHERE id = $1', [req.actor.userId, sec.encryptText(secret)]);
      return (await c.query('SELECT email FROM admin_users WHERE id = $1', [req.actor.userId])).rows[0];
    });
    const uri = `otpauth://totp/AHUVAI:${encodeURIComponent(me.email)}?secret=${secret}&issuer=AHUVAI`;
    const svg = await QRCode.toString(uri, { type: 'svg', margin: 1, color: { dark: '#30383C', light: '#FFFFFF' } });
    res.json({ secret, qrSvg: svg });
  } catch (err) { next(err); }
});

router.post('/me/totp/enable', async (req, res, next) => {
  try {
    const ok = await q(req, async (c) => {
      const u = (await c.query('SELECT totp_secret_enc FROM admin_users WHERE id = $1', [req.actor.userId])).rows[0];
      if (!u?.totp_secret_enc || !sec.verifyTotp(sec.decryptText(u.totp_secret_enc), req.body?.code)) return false;
      await c.query('UPDATE admin_users SET totp_enabled = true WHERE id = $1', [req.actor.userId]);
      await db.audit(c, req.actor, 'admin.2fa_enabled', 'admin', req.actor.userId);
      return true;
    });
    if (!ok) return res.status(400).json({ error: 'That code did not match. Please try the newest code from your app.' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/me/totp/disable', async (req, res, next) => {
  try {
    const ok = await q(req, async (c) => {
      const u = (await c.query('SELECT password_hash FROM admin_users WHERE id = $1', [req.actor.userId])).rows[0];
      if (!u || !sec.verifyPassword(String(req.body?.password || ''), u.password_hash)) return false;
      await c.query('UPDATE admin_users SET totp_enabled = false, totp_secret_enc = NULL WHERE id = $1', [req.actor.userId]);
      await db.audit(c, req.actor, 'admin.2fa_disabled', 'admin', req.actor.userId);
      return true;
    });
    if (!ok) return res.status(400).json({ error: 'Your password is not correct.' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.delete('/demo-data', async (req, res, next) => {
  try {
    const counts = await q(req, async (c) => {
      const f = await c.query('DELETE FROM families WHERE is_demo');
      const i = await c.query('DELETE FROM inquiries WHERE is_demo');
      const m = await c.query('DELETE FROM messages WHERE is_demo');
      await db.audit(c, req.actor, 'demo_data.removed');
      return { families: f.rowCount, inquiries: i.rowCount, messages: m.rowCount };
    });
    res.json({ ok: true, removed: counts });
  } catch (err) { next(err); }
});

router.delete('/old-inquiries', async (req, res, next) => {
  try {
    const n = await q(req, async (c) => {
      const r = await c.query(`DELETE FROM inquiries WHERE family_id IS NULL AND status IN ('declined','archived')
        AND updated_at < now() - ($1 || ' months')::interval`, [String(config.retentionMonths)]);
      await db.audit(c, req.actor, 'inquiries.retention_purge');
      return r.rowCount;
    });
    res.json({ ok: true, removed: n });
  } catch (err) { next(err); }
});

router.get('/audit', async (req, res, next) => {
  try {
    const rows = await q(req, async (c) => (await c.query(
      `SELECT a.action, a.actor_kind, a.target_type, a.target_id, a.created_at,
              coalesce(au.name, fu.name) AS actor_name
         FROM audit_log a LEFT JOIN admin_users au ON a.actor_kind = 'admin' AND au.id = a.actor_id
         LEFT JOIN family_users fu ON a.actor_kind = 'family' AND fu.id = a.actor_id
        ORDER BY a.id DESC LIMIT 200`)).rows);
    res.json({ entries: rows });
  } catch (err) { next(err); }
});

module.exports = router;
