'use strict';
// Readiness of the secure storage. Sensitive child information is only accepted
// when every check here has passed.
const config = require('./config');
const security = require('./security');
const db = require('./db');

let state = { ready: false, problems: ['Not checked yet.'], checkedAt: null };

async function check() {
  const problems = [];
  if (!config.databaseUrl) problems.push('DATABASE_URL is not set.');
  if (!security.encryptionReady()) problems.push('DATA_ENCRYPTION_KEY is missing or not a valid 32-byte key.');
  if (config.isProduction && !config.publicUrl.startsWith('https://')) problems.push('PUBLIC_URL must start with https:// in production.');
  if (config.databaseUrl) {
    try { problems.push(...await db.verifyRowLevelSecurity()); }
    catch (err) { problems.push('Could not verify database security: ' + err.message); }
  }
  state = { ready: problems.length === 0, problems, checkedAt: new Date().toISOString() };
  return state;
}

function get() { return state; }

function requireReady(req, res, next) {
  if (state.ready) return next();
  res.status(503).json({
    error: 'Secure storage is not fully configured yet, so profile information cannot be saved. Please try again later.',
    code: 'storage_not_ready',
  });
}

module.exports = { check, get, requireReady };
