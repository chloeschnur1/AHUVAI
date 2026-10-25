'use strict';
// Public endpoints: the initial concierge inquiry and the contact form.
// The public role may only INSERT into these tables; it can never read them back.
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

const CONTACT_METHODS = ['Email', 'Phone call', 'WhatsApp', 'Text message'];
const NANNY_TYPES = ['Traveling nanny', 'Destination nanny', 'Extended-stay care', 'Not sure yet'];

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

router.post('/inquiries', formLimit, async (req, res, next) => {
  try {
    const b = req.body || {};
    if (b.website) return res.status(201).json({ ok: true }); // spam trap field
    if (b.consent !== true) throw new v.ValidationError('Please confirm that you have read our privacy notice.');
    const row = {
      parent_name: v.text(b.parent_name, { label: 'your name', max: 120, required: true }),
      email: v.email(b.email),
      phone: v.text(b.phone, { label: 'phone number', max: 40 }),
      preferred_contact: v.oneOf(b.preferred_contact, CONTACT_METHODS, { label: 'a preferred contact method', required: true }),
      destination: v.text(b.destination, { label: 'your travel destination', max: 200, required: true }),
      travel_start: v.date(b.travel_start, { label: 'travel start date' }),
      travel_end: v.date(b.travel_end, { label: 'travel end date' }),
      num_children: v.int(b.num_children, { label: 'the number of children (1–12)', min: 1, max: 12 }),
      children_ages: v.text(b.children_ages, { label: "your children's ages", max: 200, required: true }),
      nanny_type: v.oneOf(b.nanny_type, NANNY_TYPES, { label: 'the type of care', required: true }),
      care_duration: v.text(b.care_duration, { label: 'the approximate duration', max: 200 }),
      preferences: v.text(b.preferences, { label: 'your preferences', max: 3000 }),
      cultural_considerations: v.text(b.cultural_considerations, { label: 'cultural considerations', max: 3000 }),
    };
    if (row.travel_start && row.travel_end && row.travel_end < row.travel_start) {
      throw new v.ValidationError('The travel end date is before the start date.');
    }
    await db.withContext({ role: 'public' }, (c) => c.query(
      `INSERT INTO inquiries (parent_name, email, phone, preferred_contact, destination, travel_start, travel_end,
         num_children, children_ages, nanny_type, care_duration, preferences, cultural_considerations, consent_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, now())`,
      [row.parent_name, row.email, row.phone, row.preferred_contact, row.destination, row.travel_start, row.travel_end,
        row.num_children, row.children_ages, row.nanny_type, row.care_duration, row.preferences, row.cultural_considerations]));
    notifyOwner('A new AHUVAI family inquiry');
    res.status(201).json({ ok: true });
  } catch (err) { next(err); }
});

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
module.exports.CONTACT_METHODS = CONTACT_METHODS;
module.exports.NANNY_TYPES = NANNY_TYPES;
