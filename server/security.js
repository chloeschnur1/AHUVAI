'use strict';
// Encryption, password hashing, tokens and two-step verification codes.
const crypto = require('crypto');
const config = require('./config');

// ---------------------------------------------------------------- field encryption

let key = null;
function loadKey() {
  const raw = config.encryptionKey.trim();
  if (!raw) return null;
  const buf = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  return buf.length === 32 ? buf : null;
}
key = loadKey();

function encryptionReady() { return key !== null; }

function encryptJSON(value) {
  if (!key) throw new Error('DATA_ENCRYPTION_KEY is not configured');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return 'v1:' + Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
}

function decryptJSON(payload) {
  if (!payload) return null;
  if (!key) throw new Error('DATA_ENCRYPTION_KEY is not configured');
  const buf = Buffer.from(payload.slice(3), 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8'));
}

function encryptText(text) { return encryptJSON({ t: text }); }
function decryptText(payload) { const v = decryptJSON(payload); return v ? v.t : null; }

// ---------------------------------------------------------------- passwords

const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function verifyPassword(password, stored) {
  if (!stored || typeof password !== 'string') return false;
  const [scheme, N, r, p, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt') return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(salt, 'base64'), expected.length,
    { N: Number(N), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem });
  return crypto.timingSafeEqual(expected, actual);
}

// A hash to compare against when an account does not exist, so response time
// does not reveal which email addresses are registered.
const DUMMY_HASH = hashPassword(crypto.randomBytes(16).toString('hex'));

function passwordProblem(password) {
  if (typeof password !== 'string' || password.length < 10) return 'Please choose a password of at least 10 characters.';
  if (password.length > 200) return 'That password is too long.';
  if (/^(.)\1+$/.test(password) || /^(password|1234567890|qwertyuiop)/i.test(password)) return 'Please choose a less predictable password.';
  return null;
}

// ---------------------------------------------------------------- tokens

function randomToken() { return crypto.randomBytes(32).toString('base64url'); }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

// ---------------------------------------------------------------- TOTP (authenticator apps)

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  let bits = 0, value = 0;
  const out = [];
  for (const c of str.replace(/=+$/, '').toUpperCase()) {
    const idx = B32.indexOf(c);
    if (idx < 0) continue;
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

function totpSecret() { return base32Encode(crypto.randomBytes(20)); }

function totpAt(secret, counter) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', base32Decode(secret)).update(buf).digest();
  const o = h[h.length - 1] & 15;
  const code = ((h.readUInt32BE(o) & 0x7fffffff) % 1000000).toString();
  return code.padStart(6, '0');
}

function verifyTotp(secret, code) {
  if (!secret || !/^\d{6}$/.test(String(code || '').trim())) return false;
  const counter = Math.floor(Date.now() / 30000);
  for (const drift of [-1, 0, 1]) {
    const expected = Buffer.from(totpAt(secret, counter + drift));
    if (crypto.timingSafeEqual(expected, Buffer.from(String(code).trim()))) return true;
  }
  return false;
}

module.exports = {
  encryptionReady, encryptJSON, decryptJSON, encryptText, decryptText,
  hashPassword, verifyPassword, DUMMY_HASH, passwordProblem,
  randomToken, sha256, totpSecret, totpAt, verifyTotp,
};
