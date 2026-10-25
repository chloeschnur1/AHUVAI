'use strict';
// Test harness: runs the real server against a separate test database.
const crypto = require('crypto');

const TEST_DB = process.env.TEST_DATABASE_URL || 'postgres://ahuvai:ahuvai_dev@localhost:5432/ahuvai_test';
process.env.DATABASE_URL = TEST_DB;
process.env.DATA_ENCRYPTION_KEY = process.env.TEST_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');
process.env.ADMIN_SETUP_TOKEN = 'test-setup-token';
process.env.PORT = '0';
process.env.PUBLIC_URL = 'http://localhost';
process.env.NODE_ENV = 'test';

const db = require('../server/db');
const { start } = require('../server/index');

async function resetDatabase() {
  await db.migrate();
  // TRUNCATE is run by the table owner and is not filtered by row-level security.
  await db.pool.query(`TRUNCATE audit_log, messages, admin_notes, child_profiles, children, sessions, invitations,
    family_users, inquiries, families, admin_users CASCADE`);
}

async function startServer() {
  await resetDatabase();
  const server = await start();
  const base = `http://127.0.0.1:${server.address().port}`;
  return { server, base };
}

// A tiny browser-like client that keeps cookies.
function client(base) {
  const jar = new Map();
  async function call(method, path, body, extraHeaders = {}) {
    const headers = { 'X-Requested-With': 'ahuvai', ...extraHeaders };
    if (jar.size) headers.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i);
      const value = pair.slice(i + 1);
      if (!value || /Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(c)) jar.delete(name); else jar.set(name, value);
    }
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { json = null; }
    return { status: res.status, body: json, text, headers: res.headers };
  }
  return {
    jar,
    get: (p, h) => call('GET', p, undefined, h),
    post: (p, b, h) => call('POST', p, b === undefined ? {} : b, h),
    put: (p, b) => call('PUT', p, b),
    patch: (p, b) => call('PATCH', p, b),
    del: (p, b) => call('DELETE', p, b),
  };
}

module.exports = { db, startServer, client, resetDatabase };
