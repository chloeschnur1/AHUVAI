/* Small helpers shared by every page. */
(function () {
  'use strict';

  async function request(method, url, body) {
    const opts = { method, headers: { 'X-Requested-With': 'ahuvai', Accept: 'application/json' }, credentials: 'same-origin' };
    if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    let res;
    try { res = await fetch(url, opts); }
    catch { const e = new Error('We could not reach AHUVAI. Please check your connection and try again.'); e.status = 0; throw e; }
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    if (!res.ok) {
      const e = new Error((data && data.error) || 'Something went wrong. Please try again.');
      e.status = res.status; e.data = data || {};
      throw e;
    }
    return data;
  }

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function formData(form) {
    const out = {};
    for (const el of form.elements) {
      if (!el.name || el.disabled) continue;
      if (el.type === 'checkbox') out[el.name] = el.checked;
      else if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; else if (!(el.name in out)) out[el.name] = ''; }
      else out[el.name] = el.value;
    }
    return out;
  }

  // Marks empty required fields; returns true when the form is complete.
  function checkRequired(form) {
    let first = null;
    const groups = new Set();
    for (const el of form.querySelectorAll('[required]')) {
      let empty;
      if (el.type === 'radio') {
        if (groups.has(el.name)) continue;
        groups.add(el.name);
        empty = !form.querySelector(`input[name="${el.name}"]:checked`);
      } else if (el.type === 'checkbox') empty = !el.checked;
      else if (el.type === 'email') empty = !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(el.value.trim());
      else empty = !el.value.trim() || (el.minLength > 0 && el.value.length < el.minLength);
      el.setAttribute('aria-invalid', empty ? 'true' : 'false');
      if (empty && !first) first = el;
    }
    if (first) first.focus();
    return !first;
  }

  function fmtDate(value, opts) {
    if (!value) return '';
    const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(value + 'T00:00:00') : new Date(value);
    if (isNaN(d)) return '';
    return d.toLocaleDateString(undefined, opts || { day: 'numeric', month: 'long', year: 'numeric' });
  }

  function fmtRange(a, b) {
    if (!a && !b) return '';
    if (a && b) {
      const da = new Date(a + 'T00:00:00'), db = new Date(b + 'T00:00:00');
      if (da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth()) {
        return `${da.toLocaleDateString(undefined, { month: 'long' })} ${da.getDate()}–${db.getDate()}, ${da.getFullYear()}`;
      }
      return `${fmtDate(a, { day: 'numeric', month: 'short' })} – ${fmtDate(b, { day: 'numeric', month: 'short', year: 'numeric' })}`;
    }
    return fmtDate(a || b);
  }

  window.Ahuvai = {
    get: (u) => request('GET', u),
    post: (u, b) => request('POST', u, b || {}),
    put: (u, b) => request('PUT', u, b || {}),
    patch: (u, b) => request('PATCH', u, b || {}),
    del: (u, b) => request('DELETE', u, b),
    esc, formData, checkRequired, fmtDate, fmtRange,
    star: '<svg class="star" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 0C13 9 15 11 24 12C15 13 13 15 12 24C11 15 9 13 0 12C9 11 11 9 12 0Z" fill="currentColor"/></svg>',
    arrow: '<svg class="arrow" viewBox="0 0 18 10" aria-hidden="true"><path d="M0 5h16M12 1l4 4-4 4" fill="none" stroke="currentColor"/></svg>',
  };
})();
