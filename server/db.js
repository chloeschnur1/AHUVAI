'use strict';
// Database access. Every query runs inside withContext(), which switches to the
// restricted "ahuvai_rls" role and declares who is asking, so PostgreSQL's
// row-level security decides which rows are visible.
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const config = require('./config');

function sslOption() {
  if (config.databaseSsl === 'off') return false;
  if (config.databaseSsl === 'no-verify') return { rejectUnauthorized: false };
  return { rejectUnauthorized: true };
}

const pool = new Pool({ connectionString: config.databaseUrl, ssl: sslOption(), max: 10 });
pool.on('error', (err) => console.error('Database connection error:', err.message));

// Whether queries switch to the restricted "ahuvai_rls" role (decided after migration).
let restrictedRole = true;

const ROLES = new Set(['public', 'auth', 'family', 'admin', 'system', 'none']);

/**
 * Run fn(client) in one transaction as the given actor.
 * ctx: { role: 'public'|'auth'|'family'|'admin'|'system', familyId?, userId? }
 */
async function withContext(ctx, fn) {
  if (!ROLES.has(ctx.role)) throw new Error('Unknown database role');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (restrictedRole) await client.query('SET LOCAL ROLE ahuvai_rls');
    await client.query(
      `SELECT set_config('app.role', $1, true), set_config('app.family_id', $2, true), set_config('app.user_id', $3, true)`,
      [ctx.role === 'none' ? '' : ctx.role, ctx.familyId || '', ctx.userId || '']
    );
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(727274)');
    await client.query(sql);
    const r = await client.query(`SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ahuvai_rls')
      AND pg_has_role(current_user, 'ahuvai_rls', 'MEMBER') AS ok`);
    restrictedRole = r.rows[0].ok;
  } finally {
    await client.query('SELECT pg_advisory_unlock(727274)').catch(() => {});
    client.release();
  }
}

/**
 * Confirms the database is actually enforcing row-level security for the role
 * the application uses. Returns a list of problems (empty when all is well).
 */
async function verifyRowLevelSecurity() {
  const problems = [];
  await withContext({ role: 'none' }, async (c) => {
    const who = await c.query(
      `SELECT current_user AS u, r.rolsuper, r.rolbypassrls FROM pg_roles r WHERE r.rolname = current_user`);
    const row = who.rows[0];
    if (!row) problems.push('Could not identify the database role.');
    else if (restrictedRole && row.u !== 'ahuvai_rls') problems.push('Queries are not running as the restricted role.');
    else if (row.rolsuper || row.rolbypassrls) problems.push(`The database account "${row.u}" can bypass row-level security. Use a regular (non-admin) database user.`);
    const tables = await c.query(
      `SELECT relname FROM pg_class
        WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'
          AND (NOT relrowsecurity OR NOT relforcerowsecurity)`);
    for (const t of tables.rows) problems.push(`Row-level security is off for table ${t.relname}.`);
    // With no role declared, private tables must look empty.
    for (const t of ['families', 'children', 'child_profiles', 'admin_notes', 'family_users', 'inquiries']) {
      const r = await c.query(`SELECT count(*)::int AS n FROM ${t}`);
      if (r.rows[0].n !== 0) problems.push(`Table ${t} is readable without signing in.`);
    }
  });
  return problems;
}

async function audit(client, actor, action, targetType, targetId) {
  await client.query(
    'INSERT INTO audit_log (actor_kind, actor_id, action, target_type, target_id) VALUES ($1,$2,$3,$4,$5)',
    [actor.kind || actor.role || 'system', actor.userId || null, action, targetType || null, targetId || null]);
}

module.exports = { pool, withContext, migrate, verifyRowLevelSecurity, audit };
