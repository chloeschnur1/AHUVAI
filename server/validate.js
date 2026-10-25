'use strict';
// Small input helpers. Each throws a ValidationError with a parent-friendly message.

class ValidationError extends Error {
  constructor(message) { super(message); this.status = 400; this.expose = true; }
}

function text(value, { label, max = 500, required = false } = {}) {
  const v = typeof value === 'string' ? value.trim() : '';
  if (required && !v) throw new ValidationError(`Please provide ${label}.`);
  if (v.length > max) throw new ValidationError(`${label[0].toUpperCase() + label.slice(1)} is too long.`);
  return v;
}

const EMAIL_RE = /^[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]{2,}$/;
function email(value, { required = true } = {}) {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!v && !required) return '';
  if (!EMAIL_RE.test(v) || v.length > 200) throw new ValidationError('Please provide a valid email address.');
  return v;
}

function date(value, { label, required = false } = {}) {
  const v = typeof value === 'string' ? value.trim() : '';
  if (!v) { if (required) throw new ValidationError(`Please provide ${label}.`); return null; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || isNaN(Date.parse(v))) throw new ValidationError(`Please provide a valid ${label}.`);
  return v;
}

function oneOf(value, options, { label, required = false } = {}) {
  if (!value && !required) return '';
  if (!options.includes(value)) throw new ValidationError(`Please choose ${label}.`);
  return value;
}

function int(value, { label, min, max }) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new ValidationError(`Please provide ${label}.`);
  return n;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function uuid(value) {
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    const e = new ValidationError('Not found.'); e.status = 404; throw e;
  }
  return value;
}

module.exports = { ValidationError, text, email, date, oneOf, int, uuid };
