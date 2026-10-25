'use strict';
// When secure storage is not configured (here: no encryption key), the portal must
// refuse to store child information rather than pretend to save it.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { db, resetDatabase, client } = require('./helpers');
const { hashPassword } = require('../server/security');

const PORT = 3917;
let proc;

test.before(async () => {
  await resetDatabase();
  await db.withContext({ role: 'system' }, async (c) => {
    const f = await c.query(`INSERT INTO families (family_name, primary_guardian, primary_email) VALUES ('Guard Test','Guard','guard@example.test') RETURNING id`);
    await c.query('INSERT INTO family_users (family_id, email, name, password_hash) VALUES ($1,$2,$3,$4)',
      [f.rows[0].id, 'guard@example.test', 'Guard', hashPassword('guard-password-1')]);
  });
  proc = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], {
    env: { ...process.env, DATA_ENCRYPTION_KEY: '', PORT: String(PORT), NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  await new Promise((resolve, reject) => {
    const onData = (d) => { log += d; if (log.includes('is running')) resolve(); };
    proc.stdout.on('data', onData); proc.stderr.on('data', onData);
    proc.on('exit', () => reject(new Error(log)));
  });
  assert.match(log, /SECURE STORAGE NOT READY/);
});
test.after(async () => { proc.kill(); await db.pool.end(); });

test('child information is refused when the encryption key is missing', async () => {
  const base = `http://127.0.0.1:${PORT}`;
  const status = await client(base).get('/api/status');
  assert.equal(status.body.secureStorageReady, false);
  const fam = client(base);
  assert.equal((await fam.post('/api/family/login', { email: 'guard@example.test', password: 'guard-password-1' })).status, 200);
  const me = await fam.get('/api/family/me');
  assert.equal(me.body.storageReady, false);
  const add = await fam.post('/api/family/children', {});
  assert.equal(add.status, 503);
  assert.equal(add.body.code, 'storage_not_ready');
  assert.equal((await fam.put('/api/family/travel', { travel: { destination: 'Rome' } })).status, 503);
  const count = await db.withContext({ role: 'system' }, (c) => c.query('SELECT count(*)::int n FROM children'));
  assert.equal(count.rows[0].n, 0);
});
