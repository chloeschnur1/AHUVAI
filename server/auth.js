'use strict';
// Sessions for families and administrators. The two kinds use different
// cookies and different user tables, and a session of one kind is never
// accepted where the other is required.
const config = require('./config');
const db = require('./db');
const { randomToken, sha256 } = require('./security');

const COOKIES = { family: 'ahuvai_family', admin: 'ahuvai_admin' };

function cookieOptions(maxAgeMs) {
  return {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeMs,
  };
}

async function startSession(res, kind, userId, familyId) {
  const token = randomToken();
  const ms = kind === 'admin' ? config.adminSessionHours * 3600e3 : config.familySessionDays * 86400e3;
  await db.withContext({ role: 'auth' }, (c) => c.query(
    `INSERT INTO sessions (token_hash, kind, user_id, family_id, expires_at)
     VALUES ($1, $2, $3, $4, now() + ($5 || ' milliseconds')::interval)`,
    [sha256(token), kind, userId, familyId || null, String(ms)]));
  res.cookie(COOKIES[kind], token, cookieOptions(ms));
}

async function endSession(req, res, kind) {
  const token = req.cookies[COOKIES[kind]];
  if (token) {
    await db.withContext({ role: 'auth' }, (c) =>
      c.query('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)]));
  }
  res.clearCookie(COOKIES[kind], { path: '/' });
}

async function endAllSessionsFor(client, userId) {
  await client.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
}

async function readSession(req, kind) {
  const token = req.cookies[COOKIES[kind]];
  if (!token || token.length > 100) return null;
  return db.withContext({ role: 'auth' }, async (c) => {
    const r = await c.query(
      'SELECT kind, user_id, family_id FROM sessions WHERE token_hash = $1 AND expires_at > now()', [sha256(token)]);
    const s = r.rows[0];
    if (!s || s.kind !== kind) return null;
    return { kind, userId: s.user_id, familyId: s.family_id };
  });
}

function requireSession(kind) {
  return async (req, res, next) => {
    try {
      const actor = await readSession(req, kind);
      if (!actor) return res.status(401).json({ error: 'Please sign in to continue.' });
      req.actor = actor;
      req.dbctx = kind === 'admin'
        ? { role: 'admin', userId: actor.userId }
        : { role: 'family', userId: actor.userId, familyId: actor.familyId };
      next();
    } catch (err) { next(err); }
  };
}

// Mutating API calls must come from our own pages: a custom header cannot be
// sent cross-site without a CORS preflight, which this server never grants.
function csrfGuard(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('X-Requested-With') !== 'ahuvai') return res.status(403).json({ error: 'Request blocked.' });
  const origin = req.get('Origin');
  if (origin) {
    const host = req.get('Host');
    try { if (new URL(origin).host !== host) return res.status(403).json({ error: 'Request blocked.' }); }
    catch { return res.status(403).json({ error: 'Request blocked.' }); }
  }
  next();
}

async function purgeExpiredSessions() {
  await db.withContext({ role: 'system' }, (c) => c.query('DELETE FROM sessions WHERE expires_at < now()'));
}

module.exports = {
  COOKIES, startSession, endSession, endAllSessionsFor, readSession,
  requireFamily: requireSession('family'), requireAdmin: requireSession('admin'),
  csrfGuard, purgeExpiredSessions,
};
