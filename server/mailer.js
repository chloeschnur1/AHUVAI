'use strict';
// Outgoing email. Messages never contain questionnaire content — only a short
// note and a link to sign in.
const nodemailer = require('nodemailer');
const config = require('./config');

const configured = !!(config.smtp.host && config.smtp.from);
const transport = configured ? nodemailer.createTransport({
  host: config.smtp.host,
  port: config.smtp.port,
  secure: config.smtp.port === 465,
  requireTLS: config.smtp.port !== 465,
  auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
}) : null;

function isConfigured() { return configured; }

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function layout(paragraphs, button) {
  const body = paragraphs.map((p) => `<p style="margin:0 0 16px;line-height:1.7">${escapeHtml(p)}</p>`).join('');
  const btn = button ? `<p style="margin:28px 0"><a href="${escapeHtml(button.url)}" style="background:#496779;color:#F7F3EC;padding:14px 28px;text-decoration:none;letter-spacing:.12em;font-size:12px;text-transform:uppercase">${escapeHtml(button.label)}</a></p>` : '';
  return `<div style="background:#F7F3EC;padding:40px 20px;font-family:Georgia,serif;color:#30383C">
    <div style="max-width:520px;margin:0 auto;background:#fff;padding:40px;border-top:2px solid #B9A078">
      <p style="font-size:22px;letter-spacing:.3em;color:#0B2346;margin:0 0 4px">AHUVAI</p>
      <p style="font-size:10px;letter-spacing:.3em;color:#B9A078;margin:0 0 32px">PRIVATE FAMILY CONCIERGE</p>
      ${body}${btn}
    </div></div>`;
}

async function send({ to, subject, paragraphs, button }) {
  if (!configured) return { sent: false, reason: 'Email is not configured yet.' };
  try {
    const text = paragraphs.join('\n\n') + (button ? `\n\n${button.label}: ${button.url}` : '');
    await transport.sendMail({ from: config.smtp.from, to, subject, text, html: layout(paragraphs, button) });
    return { sent: true };
  } catch (err) {
    console.error('Email delivery failed:', err.code || err.message);
    return { sent: false, reason: 'The email could not be delivered. Please check the email settings.' };
  }
}

module.exports = { isConfigured, send };
