'use strict';
// Private family portal API. Every query runs as the signed-in family, so the
// database itself only returns that family's rows.
const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const config = require('../config');
const mailer = require('../mailer');
const auth = require('../auth');
const status = require('../status');
const v = require('../validate');
const profiles = require('../profiles');
const schema = require('../../public/js/questionnaire-schema');
const { hashPassword, verifyPassword, DUMMY_HASH, passwordProblem, sha256, randomToken, decryptJSON } = require('../security');

const router = express.Router();
const loginLimit = rateLimit({ windowMs: 15 * 60e3, limit: 20, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait a few minutes and try again.' } });

// ---------------------------------------------------------------- sign in / invitations

router.post('/login', loginLimit, async (req, res, next) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const user = await db.withContext({ role: 'auth' }, async (c) => {
      const r = await c.query('SELECT id, family_id, password_hash, locked_until FROM family_users WHERE email = $1', [email]);
      const u = r.rows[0];
      const ok = verifyPassword(password, u ? u.password_hash : DUMMY_HASH);
      if (u && u.locked_until && u.locked_until > new Date()) return { locked: true };
      if (!u || !ok) {
        if (u) await c.query(`UPDATE family_users SET failed_logins = failed_logins + 1,
          locked_until = CASE WHEN failed_logins + 1 >= 8 THEN now() + interval '15 minutes' END WHERE id = $1`, [u.id]);
        return null;
      }
      await c.query('UPDATE family_users SET failed_logins = 0, locked_until = NULL, last_login_at = now() WHERE id = $1', [u.id]);
      return u;
    });
    if (user && user.locked) return res.status(429).json({ error: 'This account is temporarily locked after several attempts. Please try again in 15 minutes.' });
    if (!user) return res.status(401).json({ error: 'That email and password combination was not recognised.' });
    await auth.startSession(res, 'family', user.id, user.family_id);
    await db.withContext({ role: 'family', familyId: user.family_id, userId: user.id },
      (c) => db.audit(c, { kind: 'family', userId: user.id }, 'family.login', 'family', user.family_id));
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/logout', async (req, res, next) => {
  try { await auth.endSession(req, res, 'family'); res.json({ ok: true }); } catch (err) { next(err); }
});

async function findToken(c, token, kind) {
  const r = await c.query(
    `SELECT i.id, i.family_id, i.email, f.family_name, f.primary_guardian FROM invitations i JOIN families f ON f.id = i.family_id
      WHERE i.token_hash = $1 AND i.kind = $2 AND i.accepted_at IS NULL AND i.expires_at > now()`,
    [sha256(String(token || '')), kind]);
  return r.rows[0] || null;
}

router.get('/invitation', loginLimit, async (req, res, next) => {
  try {
    const inv = await db.withContext({ role: 'auth' }, async (c) => {
      const i = await findToken(c, req.query.token, 'invite');
      if (!i) return null;
      const existing = await c.query('SELECT 1 FROM family_users WHERE email = $1', [i.email]);
      return { ...i, hasAccount: existing.rowCount > 0 };
    });
    if (!inv) return res.status(404).json({ error: 'This invitation link is no longer valid. Please contact AHUVAI for a new one.' });
    res.json({ email: inv.email, familyName: inv.family_name, guardian: inv.primary_guardian, hasAccount: inv.hasAccount });
  } catch (err) { next(err); }
});

router.post('/invitation/accept', loginLimit, async (req, res, next) => {
  try {
    const b = req.body || {};
    const name = v.text(b.name, { label: 'your name', max: 120, required: true });
    const problem = passwordProblem(b.password);
    if (problem) throw new v.ValidationError(problem);
    if (b.consent !== true) throw new v.ValidationError('Please confirm that you have read and accept the privacy notice.');
    const hash = hashPassword(b.password);
    const created = await db.withContext({ role: 'auth' }, async (c) => {
      const inv = await findToken(c, b.token, 'invite');
      if (!inv) return { error: 'This invitation link is no longer valid. Please contact AHUVAI for a new one.' };
      const exists = await c.query('SELECT 1 FROM family_users WHERE email = $1', [inv.email]);
      if (exists.rowCount) return { error: 'An account already exists for this email address. Please sign in instead.' };
      const u = await c.query(
        'INSERT INTO family_users (family_id, email, name, password_hash) VALUES ($1,$2,$3,$4) RETURNING id',
        [inv.family_id, inv.email, name, hash]);
      await c.query('UPDATE invitations SET accepted_at = now() WHERE id = $1', [inv.id]);
      return { userId: u.rows[0].id, familyId: inv.family_id };
    });
    if (created.error) return res.status(400).json({ error: created.error });
    await db.withContext({ role: 'family', familyId: created.familyId, userId: created.userId }, async (c) => {
      await c.query(`UPDATE families SET privacy_consent_at = now(),
        status = CASE WHEN status = 'invited' THEN 'onboarding' ELSE status END, updated_at = now() WHERE id = $1`, [created.familyId]);
      await db.audit(c, { kind: 'family', userId: created.userId }, 'family.account_created', 'family', created.familyId);
    });
    await auth.startSession(res, 'family', created.userId, created.familyId);
    res.status(201).json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/password-reset/request', loginLimit, async (req, res, next) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const token = randomToken();
    const found = await db.withContext({ role: 'auth' }, async (c) => {
      const r = await c.query('SELECT family_id FROM family_users WHERE email = $1', [email]);
      if (!r.rows[0]) return false;
      await c.query(`INSERT INTO invitations (family_id, email, token_hash, kind, expires_at)
        VALUES ($1, $2, $3, 'reset', now() + interval '2 hours')`, [r.rows[0].family_id, email, sha256(token)]);
      return true;
    });
    if (found) {
      await mailer.send({
        to: email, subject: 'Reset your AHUVAI password',
        paragraphs: ['We received a request to reset the password for your AHUVAI family portal.',
          'If this was you, please use the button below within two hours. If not, you can safely ignore this message.'],
        button: { label: 'Choose a New Password', url: `${config.publicUrl}/portal/reset?token=${token}` },
      });
    }
    // Same answer whether or not the address exists.
    res.json({ ok: true, emailEnabled: mailer.isConfigured() });
  } catch (err) { next(err); }
});

router.post('/password-reset/complete', loginLimit, async (req, res, next) => {
  try {
    const problem = passwordProblem(req.body?.password);
    if (problem) throw new v.ValidationError(problem);
    const hash = hashPassword(req.body.password);
    const ok = await db.withContext({ role: 'auth' }, async (c) => {
      const inv = await findToken(c, req.body?.token, 'reset');
      if (!inv) return false;
      const u = await c.query('UPDATE family_users SET password_hash = $2, failed_logins = 0, locked_until = NULL WHERE email = $1 RETURNING id', [inv.email, hash]);
      await c.query('UPDATE invitations SET accepted_at = now() WHERE id = $1', [inv.id]);
      if (u.rows[0]) await auth.endAllSessionsFor(c, u.rows[0].id);
      return !!u.rows[0];
    });
    if (!ok) return res.status(400).json({ error: 'This reset link is no longer valid. Please request a new one.' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------- signed-in family

router.use(auth.requireFamily);

async function loadFamily(c, familyId) {
  const r = await c.query(`SELECT id, family_name, primary_guardian, status, travel, privacy_consent_at FROM families WHERE id = $1`, [familyId]);
  return r.rows[0];
}

function familyChildView(row) {
  const s = profiles.summary(row);
  return { ...s, review_status: s.review_status === 'more_info_needed' ? 'more_info_needed' : undefined };
}

router.get('/me', async (req, res, next) => {
  try {
    const data = await db.withContext(req.dbctx, async (c) => {
      const family = await loadFamily(c, req.actor.familyId);
      const user = (await c.query('SELECT name, email FROM family_users WHERE id = $1', [req.actor.userId])).rows[0];
      const children = (await profiles.listChildren(c, req.actor.familyId)).map(familyChildView);
      return { family, user, children };
    });
    if (!data.family || !data.user) return res.status(401).json({ error: 'Please sign in to continue.' });
    res.json({ ...data, storageReady: status.get().ready });
  } catch (err) { next(err); }
});

router.put('/travel', status.requireReady, async (req, res, next) => {
  try {
    const travel = schema.sanitizeFamilyTravel(req.body?.travel);
    if (travel.start_date && travel.end_date && travel.end_date < travel.start_date) {
      throw new v.ValidationError('The travel end date is before the start date.');
    }
    await db.withContext(req.dbctx, async (c) => {
      await c.query('UPDATE families SET travel = $2, updated_at = now() WHERE id = $1', [req.actor.familyId, travel]);
      await profiles.recomputeFamily(c, req.actor.familyId, travel);
    });
    res.json({ ok: true, travel });
  } catch (err) { next(err); }
});

router.post('/children', status.requireReady, async (req, res, next) => {
  try {
    const name = v.text(req.body?.preferred_name, { label: 'a name', max: 60 });
    const id = await db.withContext(req.dbctx, async (c) => {
      const childId = await profiles.createChild(c, req.actor.familyId, name);
      await c.query(`UPDATE families SET status = 'onboarding', updated_at = now() WHERE id = $1 AND status IN ('invited','profiles_submitted')`, [req.actor.familyId]);
      return childId;
    });
    res.status(201).json({ id });
  } catch (err) { next(err); }
});

// Creates profiles until the family has `count` children (never removes any).
router.post('/children/ensure-count', status.requireReady, async (req, res, next) => {
  try {
    const count = v.int(req.body?.count, { label: 'the number of children (1–12)', min: 1, max: 12 });
    await db.withContext(req.dbctx, async (c) => {
      const existing = (await profiles.listChildren(c, req.actor.familyId)).length;
      for (let i = existing; i < count; i++) await profiles.createChild(c, req.actor.familyId, '');
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.delete('/children/:id', async (req, res, next) => {
  try {
    const id = v.uuid(req.params.id);
    const result = await db.withContext(req.dbctx, async (c) => {
      const row = await profiles.getChild(c, id);
      if (!row) return 'missing';
      if (row.first_submitted_at) return 'submitted';
      await c.query('DELETE FROM children WHERE id = $1', [id]);
      return 'ok';
    });
    if (result === 'missing') return res.status(404).json({ error: 'Not found.' });
    if (result === 'submitted') return res.status(400).json({ error: 'This profile has already been shared with AHUVAI. Please contact us if you would like it removed.' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.get('/children/:id', async (req, res, next) => {
  try {
    const id = v.uuid(req.params.id);
    const data = await db.withContext(req.dbctx, async (c) => {
      const row = await profiles.getChild(c, id);
      if (!row) return null;
      const family = await loadFamily(c, req.actor.familyId);
      return { row, family };
    });
    if (!data) return res.status(404).json({ error: 'Not found.' });
    const answers = schema.sanitizeAnswers(decryptJSON(data.row.answers_enc));
    res.json({ child: familyChildView(data.row), answers, travel: data.family.travel });
  } catch (err) { next(err); }
});

router.put('/children/:id', status.requireReady, async (req, res, next) => {
  try {
    const id = v.uuid(req.params.id);
    const result = await db.withContext(req.dbctx, async (c) => {
      const row = await profiles.getChild(c, id);
      if (!row) return null;
      const family = await loadFamily(c, req.actor.familyId);
      const saved = await profiles.saveAnswers(c, row, req.body?.answers, family.travel);
      await c.query(`UPDATE families SET status = 'onboarding', updated_at = now() WHERE id = $1 AND status = 'invited'`, [req.actor.familyId]);
      return { saved, row: await profiles.getChild(c, id) };
    });
    if (!result) return res.status(404).json({ error: 'Not found.' });
    res.json({ ok: true, child: familyChildView(result.row), completion: result.saved.comp });
  } catch (err) { next(err); }
});

async function submitChildren(c, familyId, ids) {
  const family = await loadFamily(c, familyId);
  const submitted = [];
  const alreadySubmitted = [];
  const incomplete = [];
  for (const id of ids) {
    const row = await profiles.getChild(c, id);
    if (!row) continue;
    const comp = schema.completion(decryptJSON(row.answers_enc), family.travel);
    if (!comp.complete) { incomplete.push({ id, name: profiles.displayName(row), missing: comp.missing }); continue; }
    if (row.completion_status === 'submitted') { alreadySubmitted.push(id); continue; }
    await c.query(`UPDATE child_profiles SET submitted_answers_enc = answers_enc, submitted_at = now(),
        first_submitted_at = coalesce(first_submitted_at, now()), completion_status = 'submitted', review_status = 'pending'
      WHERE child_id = $1`, [id]);
    submitted.push(id);
  }
  const all = await profiles.listChildren(c, familyId);
  const allSubmitted = all.length > 0 && all.every((r) => r.completion_status === 'submitted');
  if (submitted.length) {
    await c.query(`UPDATE families SET status = $2, submitted_at = CASE WHEN $3 THEN now() ELSE submitted_at END, updated_at = now()
      WHERE id = $1 AND status IN ('invited','onboarding','profiles_submitted','ready_for_review','more_info_needed')`,
      [familyId, allSubmitted ? 'profiles_submitted' : 'onboarding', allSubmitted]);
  }
  return { submitted, alreadySubmitted, incomplete };
}

function notifySubmission() {
  if (!config.ownerNotificationEmail) return;
  mailer.send({
    to: config.ownerNotificationEmail, subject: 'A family has submitted child profiles',
    paragraphs: ['A family has submitted one or more child profiles in the AHUVAI portal.', 'Please sign in to review them.'],
    button: { label: 'Open Dashboard', url: `${config.publicUrl}/admin` },
  }).catch(() => {});
}

router.post('/children/:id/submit', status.requireReady, async (req, res, next) => {
  try {
    const id = v.uuid(req.params.id);
    const result = await db.withContext(req.dbctx, async (c) => {
      const r = await submitChildren(c, req.actor.familyId, [id]);
      if (r.submitted.length) await db.audit(c, req.actor, 'family.profile_submitted', 'child', id);
      return r;
    });
    if (result.incomplete.length) {
      return res.status(400).json({ error: 'A few sections still need answers before this profile can be submitted.', incomplete: result.incomplete });
    }
    if (!result.submitted.length && !result.alreadySubmitted.length) return res.status(404).json({ error: 'Not found.' });
    if (result.submitted.length) notifySubmission();
    res.json({ ok: true, submitted: [...result.submitted, ...result.alreadySubmitted] });
  } catch (err) { next(err); }
});

router.post('/submit-all', status.requireReady, async (req, res, next) => {
  try {
    const result = await db.withContext(req.dbctx, async (c) => {
      const ids = (await profiles.listChildren(c, req.actor.familyId)).map((r) => r.id);
      const r = await submitChildren(c, req.actor.familyId, ids);
      for (const id of r.submitted) await db.audit(c, req.actor, 'family.profile_submitted', 'child', id);
      return r;
    });
    if (!result.submitted.length && !result.alreadySubmitted.length) {
      return res.status(400).json({ error: 'Please complete at least one profile before submitting.', incomplete: result.incomplete });
    }
    if (result.submitted.length) notifySubmission();
    res.json({ ok: true, ...result });
  } catch (err) { next(err); }
});

router.post('/feedback', async (req, res, next) => {
  try {
    const body = v.text(req.body?.message, { label: 'a message', max: 4000, required: true });
    const subject = v.text(req.body?.subject, { label: 'a subject', max: 200 });
    await db.withContext(req.dbctx, async (c) => {
      const u = (await c.query('SELECT name, email FROM family_users WHERE id = $1', [req.actor.userId])).rows[0];
      await c.query(`INSERT INTO messages (source, family_id, name, email, subject, body) VALUES ('family_feedback', $1, $2, $3, $4, $5)`,
        [req.actor.familyId, u.name, u.email, subject, body]);
    });
    res.status(201).json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
