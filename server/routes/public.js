'use strict';
// Public endpoints: the contact form. The public role may only INSERT messages;
// it can never read them back.
const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const config = require('../config');
const mailer = require('../mailer');
const v = require('../validate');
const status = require('../status');

const router = express.Router();
const formLimit = rateLimit({ windowMs: 60 * 60e3, limit: 10, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Thank you — we have received several messages from you. Please try again a little later.' } });

function notifyOwner(subject) {
  if (!config.ownerNotificationEmail) return;
  // Deliberately contains no family details.
  mailer.send({
    to: config.ownerNotificationEmail,
    subject,
    paragraphs: ['A new message has arrived in your AHUVAI dashboard.', 'Please sign in to review it.'],
    button: { label: 'Open Dashboard', url: `${config.publicUrl}/admin` },
  }).catch(() => {});
}

router.post('/contact', formLimit, async (req, res, next) => {
  try {
    const b = req.body || {};
    if (b.website) return res.status(201).json({ ok: true });
    const name = v.text(b.name, { label: 'your name', max: 120, required: true });
    const email = v.email(b.email);
    const subject = v.text(b.subject, { label: 'a subject', max: 200 });
    const body = v.text(b.message, { label: 'a message', max: 4000, required: true });
    await db.withContext({ role: 'public' }, (c) => c.query(
      `INSERT INTO messages (source, name, email, subject, body) VALUES ('contact_form', $1, $2, $3, $4)`,
      [name, email, subject, body]));
    notifyOwner('A new AHUVAI contact message');
    res.status(201).json({ ok: true });
  } catch (err) { next(err); }
});

router.get('/status', (req, res) => {
  res.json({ secureStorageReady: status.get().ready, contactEmail: config.contactEmail || null });
});

module.exports = router;
module.exports.notifyOwner = notifyOwner;
