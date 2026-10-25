'use strict';
const path = require('path');
const fs = require('fs');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const config = require('./config');
const db = require('./db');
const auth = require('./auth');
const status = require('./status');

const ROOT = path.join(__dirname, '..');
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', config.trustProxy);

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'default-src': ["'self'"],
      'script-src': ["'self'"],
      'style-src': ["'self'"],
      'img-src': ["'self'", 'data:'],
      'font-src': ["'self'"],
      'connect-src': ["'self'"],
      'frame-ancestors': ["'none'"],
      'form-action': ["'self'"],
      'upgrade-insecure-requests': config.isProduction ? [] : null,
    },
  },
  strictTransportSecurity: config.isProduction ? { maxAge: 31536000, includeSubDomains: false } : false,
  referrerPolicy: { policy: 'same-origin' },
}));

// Redirect plain HTTP to HTTPS in production (hosting providers set x-forwarded-proto).
if (config.isProduction) {
  app.use((req, res, next) => (req.secure ? next() : res.redirect(301, `https://${req.get('host')}${req.originalUrl}`)));
}

app.use(cookieParser());
app.use(express.json({ limit: '200kb' }));

// ---------------------------------------------------------------- API

app.use('/api', auth.csrfGuard, (req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
app.use('/api', require('./routes/public'));
app.use('/api/family', require('./routes/family'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

// ---------------------------------------------------------------- pages

const PAGES = {
  '/': { file: 'home', title: 'AHUVAI — Private Family Concierge', nav: 'home',
    description: 'Luxury travel childcare thoughtfully tailored to your family, your traditions, and your journey.' },
  '/our-story': { file: 'story', title: 'Our Story — AHUVAI', nav: 'story',
    description: 'The philosophy behind AHUVAI: personal attention, cultural understanding, discretion and emotional wellbeing.' },
  '/services': { file: 'services', title: 'Our Services — AHUVAI', nav: 'services',
    description: 'Traveling nannies, destination nannies, Jewish family childcare and extended-stay care.' },
  '/approach': { file: 'approach', title: 'The AHUVAI Approach', nav: 'approach',
    description: "How understanding each child's temperament, routines and emotional needs shapes personalized care." },
  '/begin': { file: 'begin', title: 'Begin Your Family Experience — AHUVAI', nav: 'begin',
    description: 'Share a few details about your journey and the AHUVAI concierge team will be in touch personally.' },
  '/contact': { file: 'contact', title: 'Contact — AHUVAI', nav: 'contact', description: 'Contact AHUVAI Private Family Concierge.' },
  '/privacy': { file: 'privacy', title: 'Privacy Notice — AHUVAI', nav: '', description: 'How AHUVAI protects family and child information.' },
  '/portal': { file: 'portal-login', title: 'Private Family Portal — AHUVAI', nav: 'portal', layout: 'portal', noindex: true },
  '/portal/invite': { file: 'portal-invite', title: 'Create Your Account — AHUVAI', nav: 'portal', layout: 'portal', noindex: true },
  '/portal/reset': { file: 'portal-reset', title: 'Reset Password — AHUVAI', nav: 'portal', layout: 'portal', noindex: true },
  '/portal/family': { file: 'portal-app', title: 'My Family — AHUVAI', nav: 'portal', layout: 'app', script: 'portal', noindex: true },
  '/admin': { file: 'admin-app', title: 'AHUVAI Administration', layout: 'admin', script: 'admin', noindex: true },
};

const read = (p) => fs.readFileSync(path.join(ROOT, 'views', p), 'utf8');
const cache = new Map();
const escapeAttr = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Photography lives in public/images. A missing photo shows an elegant illustrated panel instead.
function photoFile(name) {
  for (const ext of ['webp', 'jpg', 'jpeg', 'png']) {
    if (fs.existsSync(path.join(ROOT, 'public', 'images', `${name}.${ext}`))) return `/images/${name}.${ext}`;
  }
  return null;
}
function availablePhotos() {
  try { return fs.readdirSync(path.join(ROOT, 'public', 'images')).filter((f) => /\.(webp|jpe?g|png)$/i.test(f)); }
  catch { return []; }
}

function renderPage(def) {
  if (config.isProduction && cache.has(def.file)) return cache.get(def.file);
  const layout = read(`layouts/${def.layout || 'site'}.html`);
  const partials = { header: read('partials/header.html'), footer: read('partials/footer.html') };
  let html = layout
    .replace('{{> header}}', () => partials.header)
    .replace('{{> footer}}', () => partials.footer)
    .replace('{{body}}', () => read(`pages/${def.file}.html`))
    .replace(/{{title}}/g, def.title)
    .replace(/{{description}}/g, def.description || '')
    .replace('{{robots}}', def.noindex ? '<meta name="robots" content="noindex, nofollow">' : '')
    .replace('{{script}}', def.script ? `<script src="/js/${def.script}.js" defer></script>` : '')
    .replace(/{{year}}/g, String(new Date().getFullYear()))
    .replace(/{{contactEmail}}/g, escapeAttr(config.contactEmail))
    .replace('{{photos}}', escapeAttr(availablePhotos().join(',')))
    .replace(/{{photo:([a-z0-9-]+)\|([^}|]*)(\|eager)?}}/g, (m, name, alt, eager) => {
      const src = photoFile(name);
      if (!src) return read('partials/photo-fallback.html');
      const small = photoFile(`${name}-960`);
      const srcset = small ? ` srcset="${small} 960w, ${src} 1672w" sizes="(max-width: 1000px) 100vw, 1360px"` : '';
      const loading = eager ? 'fetchpriority="high"' : 'loading="lazy"';
      return `<img src="${src}"${srcset} alt="${escapeAttr(alt)}" ${loading} decoding="async">`;
    });
  html = html.replace(/<!--if-contact-email-->([\s\S]*?)<!--end-->/g, config.contactEmail ? '$1' : '');
  html = html.replace(/data-nav="([a-z]+)"/g, (m, key) => (key === def.nav ? `${m} aria-current="page"` : m));
  if (config.isProduction) cache.set(def.file, html);
  return html;
}

for (const [route, def] of Object.entries(PAGES)) {
  app.get(route, (req, res) => {
    if (def.noindex) res.setHeader('Cache-Control', 'no-store');
    res.type('html').send(renderPage(def));
  });
}

app.get('/healthz', (req, res) => res.json({ ok: true, secureStorageReady: status.get().ready }));
app.use(express.static(path.join(ROOT, 'public'), { maxAge: config.isProduction ? '1d' : 0, index: false }));
app.use((req, res) => res.status(404).type('html').send(renderPage({ file: 'not-found', title: 'Page Not Found — AHUVAI', noindex: true })));

// ---------------------------------------------------------------- errors

// Error details are never sent to the browser or written with request bodies.
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  const code = err.status || err.statusCode || 500;
  if (code >= 500) console.error(`[${new Date().toISOString()}] ${req.method} ${req.path} failed:`, err.code || '', err.message);
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'That submission is too large.' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'The request could not be read.' });
  res.status(code).json({ error: err.expose ? err.message : 'Something went wrong on our side. Your information has not been lost — please try again.' });
});

async function start() {
  if (!config.databaseUrl) {
    console.error('DATABASE_URL is not set. See SETUP-GUIDE.md.');
    process.exit(1);
  }
  await db.migrate();
  const s = await status.check();
  if (s.ready) console.log('Secure storage verified: row-level security active, encryption key loaded.');
  else console.warn('SECURE STORAGE NOT READY — child profile saving is disabled:\n  - ' + s.problems.join('\n  - '));
  setInterval(() => auth.purgeExpiredSessions().catch(() => {}), 3600e3).unref();
  setInterval(() => status.check().catch(() => {}), 10 * 60e3).unref();
  return new Promise((resolve) => {
    const server = app.listen(config.port, () => {
      console.log(`AHUVAI is running at ${config.publicUrl}`);
      resolve(server);
    });
  });
}

if (require.main === module) start().catch((err) => { console.error(err); process.exit(1); });

module.exports = { app, start };
