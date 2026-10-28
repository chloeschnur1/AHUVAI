'use strict';
// All settings come from environment variables (see .env.example).
const fs = require('fs');
const path = require('path');

// Load a local .env file during development. Hosting providers set variables directly.
const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const env = process.env;
const isProduction = env.NODE_ENV === 'production';

// The site's public address. Uses PUBLIC_URL when set; on Render, falls back to the
// address Render assigns (RENDER_EXTERNAL_URL). A bare domain such as
// "portal.ahuvai.com" is treated as https://portal.ahuvai.com.
function resolvePublicUrl() {
  let url = (env.PUBLIC_URL || '').trim() || (env.RENDER_EXTERNAL_URL || '').trim();
  if (!url) return `http://localhost:${env.PORT || 3000}`;
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  // Render always serves over HTTPS, so an http:// address there is a typo.
  if (env.RENDER && /^http:\/\//i.test(url)) url = url.replace(/^http:\/\//i, 'https://');
  return url.replace(/\/+$/, '');
}

module.exports = {
  isProduction,
  port: Number(env.PORT || 3000),
  publicUrl: resolvePublicUrl(),
  databaseUrl: env.DATABASE_URL || '',
  // 'require' (verify certificate), 'no-verify' (encrypted, provider certificate not verified), or 'off'
  databaseSsl: env.DATABASE_SSL || (isProduction ? 'require' : 'off'),
  encryptionKey: env.DATA_ENCRYPTION_KEY || '',
  adminSetupToken: env.ADMIN_SETUP_TOKEN || '',
  trustProxy: env.TRUST_PROXY ? Number(env.TRUST_PROXY) : (isProduction ? 1 : 0),
  smtp: {
    host: env.SMTP_HOST || '',
    port: Number(env.SMTP_PORT || 587),
    user: env.SMTP_USER || '',
    pass: env.SMTP_PASS || '',
    from: env.EMAIL_FROM || '',
  },
  ownerNotificationEmail: env.OWNER_NOTIFICATION_EMAIL || '',
  contactEmail: env.CONTACT_EMAIL || '',
  retentionMonths: Number(env.RETENTION_MONTHS || 24),
  familySessionDays: 7,
  adminSessionHours: 8,
  invitationDays: 14,
};
