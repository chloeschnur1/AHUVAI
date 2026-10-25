/* AHUVAI private administrator dashboard. */
(function () {
  'use strict';
  const A = window.Ahuvai;
  const S = window.AhuvaiSchema;
  const F = window.AhuvaiFormat;
  const esc = A.esc;
  const root = document.getElementById('admin-root');
  let me = null;
  let counts = {};

  const INQ_STATUS = { new: 'New', reviewed: 'Reviewed', contacted: 'Contacted', invited: 'Invited', declined: 'Declined', archived: 'Archived' };
  const FAM_STATUS = { contacted: 'Contacted', invited: 'Invited', onboarding: 'Onboarding', profiles_submitted: 'Profiles Submitted',
    ready_for_review: 'Ready for Review', more_info_needed: 'More Information Needed', active: 'Active', archived: 'Archived' };
  const REVIEW = { pending: 'Awaiting Review', ready_for_review: 'Ready for Review', more_info_needed: 'More Information Needed', reviewed: 'Reviewed' };
  const COMPLETION = { not_started: 'Not Started', in_progress: 'In Progress', complete: 'Complete — Not Submitted', submitted: 'Submitted', editing_after_submit: 'Parent Editing' };
  const SECTION_TITLE = Object.fromEntries(S.SECTIONS.map((s) => [s.key, s.title]));

  const pill = (status, labels) => `<span class="pill ${esc(status)}">${esc((labels || {})[status] || status)}</span>`;
  const date = (d) => (d ? esc(A.fmtDate(d, { day: 'numeric', month: 'short', year: 'numeric' })) : '—');
  const range = (a, b) => esc(A.fmtRange(a, b)) || '—';
  const meter = (p) => `<span class="meter-sm"><span data-w="${Number(p) || 0}"></span></span>${Number(p) || 0}%`;

  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3500);
  }

  function fail(err) {
    if (err.status === 401) { me = null; boot(); return; }
    toast(err.message);
  }

  // ------------------------------------------------------------------ sign in / setup

  async function boot() {
    try {
      const r = await A.get('/api/admin/me');
      me = r.me;
      me.storage = r.storage; me.emailConfigured = r.emailConfigured;
      shell();
      route();
    } catch (err) {
      if (err.status !== 401) { root.innerHTML = `<div class="app-loading">${esc(err.message)}</div>`; return; }
      const s = await A.get('/api/admin/setup-status').catch(() => ({ needsSetup: false }));
      s.needsSetup ? renderSetup(s.setupEnabled) : renderLogin();
    }
  }

  function authCard(inner) {
    root.innerHTML = `<div class="admin-auth"><div class="auth-card"><img src="/img/ahuvai-logo.png" class="logo" alt="AHUVAI — Private Family Concierge" width="2172" height="724">${inner}</div></div>`;
  }

  function renderLogin() {
    authCard(`<span class="eyebrow center-block">Administration</span><h1>Private sign in</h1>
      <p class="lede">For AHUVAI administrators only.</p>
      <form data-login novalidate><div class="notice error" role="alert" data-err></div>
        <label class="field"><span class="label">Email</span><input class="input" type="email" name="email" autocomplete="username" required></label>
        <label class="field"><span class="label">Password</span><input class="input" type="password" name="password" autocomplete="current-password" required></label>
        <label class="field" data-code hidden><span class="label">Authenticator code</span><input class="input" type="text" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6"></label>
        <button class="btn btn-primary" type="submit">Sign In</button></form>`);
    const form = root.querySelector('[data-login]');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = form.querySelector('[data-err]');
      err.textContent = '';
      if (!A.checkRequired(form)) return;
      const d = A.formData(form);
      try { await A.post('/api/admin/login', d); boot(); }
      catch (x) {
        if (x.data && x.data.needCode) { form.querySelector('[data-code]').hidden = false; form.elements.code.focus(); }
        err.textContent = x.message;
      }
    });
  }

  function renderSetup(enabled) {
    if (!enabled) {
      authCard(`<h1>Setup required</h1><p class="lede">No administrator account exists yet. Set the <strong>ADMIN_SETUP_TOKEN</strong> setting on your hosting service, restart, then return to this page. See the setup guide for step-by-step instructions.</p>`);
      return;
    }
    authCard(`<span class="eyebrow center-block">First-Time Setup</span><h1>Create the owner account</h1>
      <p class="lede">This page works only once — before any administrator exists.</p>
      <form data-setup novalidate><div class="notice error" role="alert" data-err></div>
        <label class="field"><span class="label">Setup code</span><input class="input" type="password" name="token" required><span class="hint">The ADMIN_SETUP_TOKEN value from your hosting settings.</span></label>
        <label class="field"><span class="label">Your name</span><input class="input" type="text" name="name" required></label>
        <label class="field"><span class="label">Email</span><input class="input" type="email" name="email" autocomplete="username" required></label>
        <label class="field"><span class="label">Password</span><input class="input" type="password" name="password" autocomplete="new-password" minlength="10" required><span class="hint">At least 10 characters.</span></label>
        <button class="btn btn-primary" type="submit">Create Account</button></form>`);
    const form = root.querySelector('[data-setup]');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!A.checkRequired(form)) return;
      try { await A.post('/api/admin/setup', A.formData(form)); boot(); }
      catch (x) { form.querySelector('[data-err]').textContent = x.message; }
    });
  }

  // ------------------------------------------------------------------ shell & routing

  const NAV = [
    ['overview', 'Overview'], ['inquiries', 'New Inquiries'], ['families', 'Families'], ['children', 'Child Profiles'],
    ['submissions', 'Submitted Questionnaires'], ['care', 'Care Preferences'], ['messages', 'Private Feedback'], ['settings', 'Settings'],
  ];

  function shell() {
    root.innerHTML = `<div class="admin-shell">
      <aside class="sidebar">
        <img src="/img/ahuvai-logo.png" class="logo" alt="AHUVAI" width="2172" height="724">
        <span class="tag">Administration</span>
        <button class="menu-btn link-btn" type="button" data-menu aria-expanded="false">Menu</button>
        <nav class="side-nav" data-sidenav>${NAV.map(([k, l]) => `<a href="#/${k}" data-nav="${k}">${l}<span data-count="${k}"></span></a>`).join('')}</nav>
        <div class="sidebar-foot"><span class="who">${esc(me.name)}</span><button class="link-btn" type="button" data-logout>Sign out</button></div>
      </aside>
      <main class="main" id="view" tabindex="-1"></main>
    </div>`;
    root.querySelector('[data-logout]').addEventListener('click', async () => { await A.post('/api/admin/logout').catch(() => {}); location.hash = ''; me = null; boot(); });
    root.querySelector('[data-menu]').addEventListener('click', (e) => {
      const nav = root.querySelector('[data-sidenav]');
      nav.classList.toggle('open');
      e.target.setAttribute('aria-expanded', String(nav.classList.contains('open')));
    });
  }

  function setCounts() {
    const set = (k, n) => { const el = root.querySelector(`[data-count="${k}"]`); if (el) { el.className = n ? 'count' : ''; el.textContent = n || ''; } };
    set('inquiries', counts.new_inquiries); set('messages', counts.unread_messages);
  }

  const view = () => document.getElementById('view');
  function render(html) {
    const v = view();
    v.innerHTML = html;
    v.querySelectorAll('.meter-sm span').forEach((el) => { el.style.width = el.dataset.w + '%'; });
    window.scrollTo(0, 0);
  }

  async function route() {
    if (!me) return;
    const [page, id] = location.hash.replace(/^#\/?/, '').split('/');
    const key = NAV.some(([k]) => k === page) ? page : 'overview';
    root.querySelectorAll('[data-nav]').forEach((a) => {
      if (a.dataset.nav === key) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    root.querySelector('[data-sidenav]').classList.remove('open');
    render('<div class="app-loading">Loading…</div>');
    try {
      const pages = { overview, inquiries: id ? inquiryDetail : inquiries, families: id ? familyDetail : families, children: id ? childDetail : children,
        submissions, care, messages, settings };
      await pages[key](id);
      view().focus({ preventScroll: true });
    } catch (err) { fail(err); if (err.status !== 401) render(`<div class="empty">${esc(err.message)}</div>`); }
  }

  // ------------------------------------------------------------------ overview

  async function overview() {
    const d = await A.get('/api/admin/overview');
    counts = d.stats; setCounts();
    const s = d.stats;
    const stat = (n, l, href, hl) => `<a class="stat ${hl ? 'hl' : ''}" href="${href}"><span class="n">${n}</span><span class="l">${l}</span></a>`;
    render(`<div class="page-title"><div><span class="eyebrow">Welcome, ${esc(me.name.split(' ')[0])}</span><h1>Overview</h1></div></div>
      ${me.storage && !me.storage.ready ? `<div class="notice warning"><strong>Secure storage not ready.</strong> Families cannot save profiles until this is resolved: ${esc(me.storage.problems.join(' '))}</div>` : ''}
      <div class="stats">
        ${stat(s.total_inquiries, 'Family inquiries', '#/inquiries')}
        ${stat(s.new_inquiries, 'Awaiting review', '#/inquiries', s.new_inquiries > 0)}
        ${stat(s.active_families, 'Active families', '#/families')}
        ${stat(s.child_profiles, 'Child profiles', '#/children')}
        ${stat(s.completed_profiles, 'Submitted profiles', '#/submissions')}
        ${stat(s.incomplete_profiles, 'Incomplete profiles', '#/children')}
      </div>
      <div class="grid-main">
        <section class="panel"><h2>Recent submissions</h2>
          ${d.recent.length ? `<div class="table-wrap"><table class="data"><thead><tr><th>Child</th><th>Family</th><th>Destination</th><th>Submitted</th><th>Review</th></tr></thead><tbody>
            ${d.recent.map((r) => `<tr class="clickable" data-href="#/children/${r.id}"><td><span class="name">${esc(r.preferred_name || r.full_name)}</span><span class="sub">${esc(r.age_label)}</span></td>
              <td>${esc(r.family_name)}</td><td>${esc(r.destination || '—')}</td><td>${date(r.submitted_at)}</td><td>${pill(r.review_status, REVIEW)}</td></tr>`).join('')}
          </tbody></table></div>` : '<div class="empty">No profiles have been submitted yet.</div>'}
        </section>
        <section class="panel"><h2>New inquiries</h2>
          ${d.inquiries.length ? d.inquiries.map((i) => `<a class="kid-card" href="#/inquiries/${i.id}"><span class="ord">${date(i.created_at)}</span><h3>${esc(i.parent_name)}</h3>
            <span class="muted">${esc(i.destination)} · ${i.num_children} ${i.num_children === 1 ? 'child' : 'children'}</span></a>`).join('<div class="q-block"></div>') : '<div class="empty">No new inquiries.</div>'}
        </section>
      </div>`);
  }

  // ------------------------------------------------------------------ inquiries

  let inqFilter = 'new';
  async function inquiries() {
    const d = await A.get('/api/admin/inquiries' + (inqFilter ? `?status=${inqFilter}` : ''));
    render(`<div class="page-title"><div><span class="eyebrow">Concierge Inquiries</span><h1>New Inquiries</h1></div></div>
      <div class="tabs" role="group" aria-label="Filter by status">
        ${[['new', 'New'], ['reviewed', 'Reviewed'], ['contacted', 'Contacted'], ['invited', 'Invited'], ['declined', 'Declined'], ['archived', 'Archived'], ['', 'All']]
          .map(([k, l]) => `<button type="button" data-inq-filter="${k}" aria-pressed="${inqFilter === k}">${l}</button>`).join('')}
      </div>
      <section class="panel">${d.inquiries.length ? `<div class="table-wrap"><table class="data"><thead><tr><th>Parent</th><th>Destination</th><th>Dates</th><th>Children</th><th>Care</th><th>Received</th><th>Status</th></tr></thead><tbody>
        ${d.inquiries.map((i) => `<tr class="clickable" data-href="#/inquiries/${i.id}"><td><span class="name">${esc(i.parent_name)}</span><span class="sub">${esc(i.email)}</span></td>
          <td>${esc(i.destination)}</td><td>${range(i.travel_start, i.travel_end)}</td><td>${i.num_children}<span class="sub">Ages ${esc(i.children_ages)}</span></td>
          <td>${esc(i.nanny_type)}</td><td>${date(i.created_at)}</td><td>${pill(i.status, INQ_STATUS)}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty">No inquiries in this list.</div>'}</section>`);
  }

  async function inquiryDetail(id) {
    const { inquiry: i, notes } = await A.get(`/api/admin/inquiries/${id}`);
    render(`<a class="crumb" href="#/inquiries">← New Inquiries</a>
      <div class="family-hero"><span class="eyebrow">Inquiry · ${date(i.created_at)}</span><h1>${esc(i.parent_name)}</h1>
        <dl class="info">
          <div><dt>Email</dt><dd><a href="mailto:${esc(i.email)}">${esc(i.email)}</a></dd></div>
          <div><dt>Phone</dt><dd>${esc(i.phone || '—')}</dd></div>
          <div><dt>Preferred contact</dt><dd>${esc(i.preferred_contact)}</dd></div>
          <div><dt>Status</dt><dd>${pill(i.status, INQ_STATUS)}</dd></div>
          <div><dt>Destination</dt><dd>${esc(i.destination)}</dd></div>
          <div><dt>Travel dates</dt><dd>${range(i.travel_start, i.travel_end)}</dd></div>
          <div><dt>Children</dt><dd>${i.num_children} · Ages ${esc(i.children_ages)}</dd></div>
          <div><dt>Type of care</dt><dd>${esc(i.nanny_type)}</dd></div>
          <div><dt>Duration</dt><dd>${esc(i.care_duration || '—')}</dd></div>
          <div class="wide"><dt>Childcare preferences</dt><dd>${esc(i.preferences || '—')}</dd></div>
          <div class="wide"><dt>Cultural or religious considerations</dt><dd>${esc(i.cultural_considerations || '—')}</dd></div>
        </dl>
        <div class="actions-row">
          <button class="btn btn-small" data-inq-status="reviewed">Mark Reviewed</button>
          <button class="btn btn-small" data-inq-status="contacted">Mark Contacted</button>
          <button class="btn btn-small btn-primary" data-invite-inquiry="${i.id}">${i.family_id ? 'Send New Invitation' : 'Invite to Family Portal'}</button>
          ${i.family_id ? `<a class="btn btn-small btn-quiet" href="#/families/${i.family_id}">Open Family Record</a>` : ''}
          <button class="btn btn-small btn-quiet" data-inq-status="declined">Decline</button>
          <button class="btn btn-small btn-quiet" data-inq-status="archived">Archive</button>
        </div>
        <div data-invite-result></div>
      </div>
      ${notesPanel(notes, { inquiry_id: i.id })}`);
    view().dataset.inquiry = i.id;
  }

  function inviteResult(r) {
    const box = view().querySelector('[data-invite-result]');
    if (!box) return;
    box.innerHTML = r.emailSent
      ? '<div class="callout">The invitation email has been sent.</div>'
      : `<div class="callout"><strong>${esc(r.emailNote || 'The email was not sent.')}</strong> Please copy this private link and send it to the family yourself. It works once.${r.inviteUrl ? `<code>${esc(r.inviteUrl)}</code>` : ''}</div>`;
  }

  // ------------------------------------------------------------------ families

  const famFilter = { q: '', status: '', destination: '', from: '', to: '' };
  async function families() {
    const qs = new URLSearchParams(Object.entries(famFilter).filter(([, v]) => v)).toString();
    const d = await A.get('/api/admin/families' + (qs ? '?' + qs : ''));
    render(`<div class="page-title"><div><span class="eyebrow">Family Directory</span><h1>Families</h1></div>
        <button class="btn btn-small" data-toggle="add-family">Add a Family</button></div>
      <section class="panel inline-form" data-panel="add-family" hidden><h2>Add a family directly</h2>
        <p class="muted">For families introduced personally rather than through the website. An invitation to the portal will be created.</p>
        <form data-add-family class="filters" novalidate>
          <label class="field"><span class="label">Parent name</span><input class="input" name="primary_guardian" required></label>
          <label class="field"><span class="label">Email</span><input class="input" type="email" name="primary_email" required></label>
          <label class="field"><span class="label">Family name <span class="optional">optional</span></span><input class="input" name="family_name" placeholder="The Cohen Family"></label>
          <button class="btn btn-primary btn-small" type="submit">Create &amp; Invite</button>
        </form><div data-invite-result></div></section>
      <form class="filters" data-fam-filter>
        <label class="field search"><span class="label">Search</span><input class="input" type="search" name="q" value="${esc(famFilter.q)}" placeholder="Name or email"></label>
        <label class="field"><span class="label">Status</span><select class="input" name="status"><option value="">All statuses</option>${Object.entries(FAM_STATUS).map(([k, l]) => `<option value="${k}" ${famFilter.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="field"><span class="label">Destination</span><input class="input" name="destination" value="${esc(famFilter.destination)}" placeholder="e.g. Paris"></label>
        <label class="field"><span class="label">Traveling from</span><input class="input" type="date" name="from" value="${esc(famFilter.from)}"></label>
        <label class="field"><span class="label">Traveling until</span><input class="input" type="date" name="to" value="${esc(famFilter.to)}"></label>
        <button class="btn btn-small" type="submit">Filter</button>
        <button class="btn btn-small btn-quiet" type="button" data-clear-filter>Clear</button>
      </form>
      <section class="panel">${d.families.length ? `<div class="table-wrap"><table class="data"><thead><tr><th>Family</th><th>Email</th><th>Children</th><th>Destination</th><th>Travel dates</th><th>Submitted</th><th>Status</th></tr></thead><tbody>
        ${d.families.map((f) => `<tr class="clickable" data-href="#/families/${f.id}"><td><span class="name">${esc(f.family_name)}</span><span class="sub">${esc(f.primary_guardian)}</span></td>
          <td>${esc(f.primary_email)}</td><td>${f.children}<span class="sub">${f.submitted} submitted</span></td><td>${esc(f.destination || '—')}</td>
          <td>${range(f.start_date, f.end_date)}</td><td>${date(f.submitted_at)}</td><td>${pill(f.status, FAM_STATUS)} ${f.is_demo ? '<span class="pill demo">Demo</span>' : ''}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty">No families match.</div>'}</section>`);
  }

  async function familyDetail(id) {
    const d = await A.get(`/api/admin/families/${id}`);
    const f = d.family;
    const t = f.travel || {};
    render(`<a class="crumb" href="#/families">← Families</a>
      <div class="family-hero">
        <span class="eyebrow">Family Record ${f.is_demo ? '· <span class="pill demo">Demonstration data</span>' : ''}</span>
        <h1>${esc(f.family_name)}</h1>
        <dl class="info">
          <div><dt>Parent</dt><dd>${esc(f.primary_guardian)}</dd></div>
          <div><dt>Email</dt><dd><a href="mailto:${esc(f.primary_email)}">${esc(f.primary_email)}</a></dd></div>
          <div><dt>Phone</dt><dd>${esc(f.phone || '—')}</dd></div>
          <div><dt>Preferred contact</dt><dd>${esc(f.preferred_contact || '—')}</dd></div>
          <div><dt>Destination</dt><dd>${esc(t.destination || '—')}</dd></div>
          <div><dt>Travel dates</dt><dd>${range(t.start_date, t.end_date)}</dd></div>
          <div><dt>Travel by</dt><dd>${esc((t.modes || []).join(', ') || '—')}${t.modes_other ? ` (${esc(t.modes_other)})` : ''}</dd></div>
          <div><dt>Children</dt><dd>${d.children.length}</dd></div>
          <div><dt>Privacy consent</dt><dd>${f.privacy_consent_at ? date(f.privacy_consent_at) : 'Not yet'}</dd></div>
          <div><dt>Status</dt><dd><select class="input" data-family-status aria-label="Family status">${Object.entries(FAM_STATUS).map(([k, l]) => `<option value="${k}" ${f.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select></dd></div>
          ${t.security ? `<div class="wide"><dt>Security or transportation considerations</dt><dd>${esc(t.security)}</dd></div>` : ''}
        </dl>
        <div class="actions-row">
          <button class="btn btn-small" data-family-invite>${d.users.length ? 'Send Reminder' : 'Send / Renew Invitation'}</button>
          ${d.users.length ? '<button class="btn btn-small btn-quiet" data-reset-link>Password Reset Link</button>' : ''}
          <button class="btn btn-small" data-toggle="request-info">Request More Information</button>
          <a class="btn btn-small btn-quiet" href="/api/admin/families/${f.id}/export" download>Export Record</a>
          <button class="btn btn-small btn-quiet danger" data-toggle="delete-family">Delete Family</button>
        </div>
        <div data-invite-result></div>
        <form class="inline-form" data-panel="request-info" data-request-info hidden novalidate>
          <span class="fieldset-label">Which profiles need more information?</span>
          <div class="choice-row">${d.children.map((c) => `<label class="chip"><input type="checkbox" name="child" value="${c.id}"><span>${esc(c.name)}</span></label>`).join('')}</div>
          <label class="field"><span class="label">Message to the family <span class="optional">optional</span></span><textarea class="input" name="message" maxlength="2000"></textarea>
            <span class="hint">This is emailed to the family. Please don't include medical or other sensitive details — ask them to update the portal instead.</span></label>
          <div><button class="btn btn-primary btn-small" type="submit">Send Request</button></div>
        </form>
        <form class="inline-form" data-panel="delete-family" data-delete-family hidden novalidate>
          <p class="notice error">This permanently deletes the family, every child profile, their account and original inquiry. Export the record first if you need a copy. This cannot be undone.</p>
          <label class="field"><span class="label">Type <strong>${esc(f.family_name)}</strong> to confirm</span><input class="input" name="confirm" autocomplete="off"></label>
          <div><button class="btn btn-small danger" type="submit">Permanently Delete</button></div>
        </form>
      </div>
      <div class="grid-main">
        <div>
          <section class="panel"><h2>Children <small>Select a child to open their full profile</small></h2>
            ${d.children.length ? `<div class="kid-grid">${d.children.map((c, i) => `<a class="kid-card" href="#/children/${c.id}">
              <span class="ord">Child ${i + 1}</span><h3>${esc(c.name)}${c.age_label ? `, ${esc(c.age_label)}` : ''}</h3>
              <span>${pill(c.completion_status, COMPLETION)} ${c.submitted_at ? pill(c.review_status, REVIEW) : ''}</span>
              <span>${meter(c.percent)}</span>
              ${c.missing.length ? `<span class="missing">Incomplete: ${c.missing.map((k) => esc(SECTION_TITLE[k])).join(', ')}</span>` : ''}
              <span class="open">View Full Profile →</span></a>`).join('')}</div>` : '<div class="empty">The family has not added any children yet.</div>'}
          </section>
          ${d.inquiry ? `<section class="panel"><h2>Original inquiry <small>${date(d.inquiry.created_at)}</small></h2><dl class="info">
            <div><dt>Type of care</dt><dd>${esc(d.inquiry.nanny_type)}</dd></div><div><dt>Duration</dt><dd>${esc(d.inquiry.care_duration || '—')}</dd></div>
            <div><dt>Ages</dt><dd>${esc(d.inquiry.children_ages)}</dd></div>
            <div class="wide"><dt>Preferences</dt><dd>${esc(d.inquiry.preferences || '—')}</dd></div>
            <div class="wide"><dt>Cultural considerations</dt><dd>${esc(d.inquiry.cultural_considerations || '—')}</dd></div></dl></section>` : ''}
          <section class="panel"><h2>Portal access</h2>
            ${d.users.length ? d.users.map((u) => `<p>${esc(u.name)} · ${esc(u.email)}<span class="sub muted"> Account created ${date(u.created_at)} · Last sign-in ${date(u.last_login_at)}</span></p>`).join('')
              : `<p class="muted">No account yet. ${d.invites[0] ? `Latest invitation sent ${date(d.invites[0].created_at)}, expires ${date(d.invites[0].expires_at)}.` : ''}</p>`}
          </section>
        </div>
        ${notesPanel(d.notes, { family_id: f.id })}
      </div>`);
  }

  function notesPanel(notes, target) {
    return `<section class="panel" data-notes='${esc(JSON.stringify(target))}'><h2>Private notes</h2>
      <span class="private-tag">Visible only to AHUVAI administrators</span>
      <form data-add-note novalidate><label class="field"><span class="sr-only">New note</span><textarea class="input" name="body" placeholder="Add a private note…" maxlength="5000" required></textarea></label>
        <button class="btn btn-small" type="submit">Save Note</button></form>
      <div class="notes-list">${notes.map(noteHtml).join('')}</div></section>`;
  }
  const noteHtml = (n) => `<div class="note-item"><div class="meta"><span>${esc(n.author_name)} · ${date(n.created_at)}</span><button type="button" data-delete-note="${n.id}">Delete</button></div>${esc(n.body)}</div>`;

  // ------------------------------------------------------------------ children

  async function children() {
    const d = await A.get('/api/admin/children');
    render(`<div class="page-title"><div><span class="eyebrow">All Children</span><h1>Child Profiles</h1></div></div>
      ${childTable(d.children, true)}`);
  }

  async function submissions() {
    const d = await A.get('/api/admin/children?submitted=1');
    render(`<div class="page-title"><div><span class="eyebrow">Ready to Read</span><h1>Submitted Questionnaires</h1></div></div>
      ${childTable(d.children, false)}`);
  }

  function childTable(rows, showMissing) {
    return `<section class="panel">${rows.length ? `<div class="table-wrap"><table class="data"><thead><tr><th>Child</th><th>Family</th><th>Destination</th><th>Progress</th>${showMissing ? '<th>Incomplete sections</th>' : '<th>Submitted</th>'}<th>Status</th></tr></thead><tbody>
      ${rows.map((c) => `<tr class="clickable" data-href="#/children/${c.id}"><td><span class="name">${esc(c.preferred_name || c.full_name || 'Unnamed')}</span><span class="sub">${esc(c.age_label)}</span></td>
        <td>${esc(c.family_name)}</td><td>${esc(c.destination || '—')}</td><td>${meter(c.percent_complete)}</td>
        <td>${showMissing ? (c.missing.length ? esc(c.missing.map((k) => SECTION_TITLE[k]).join(', ')) : '—') : date(c.submitted_at)}</td>
        <td>${pill(c.completion_status, COMPLETION)}${c.submitted_at ? ' ' + pill(c.review_status, REVIEW) : ''}</td></tr>`).join('')}
    </tbody></table></div>` : '<div class="empty">Nothing here yet.</div>'}</section>`;
  }

  async function childDetail(id) {
    const d = await A.get(`/api/admin/children/${id}`);
    const c = d.child;
    const a = d.answers;
    const tabs = d.siblings.length > 1 ? `<nav class="child-tabs" aria-label="Children in this family">${d.siblings.map((s, i) => `<a href="#/children/${s.id}" ${s.id === c.id ? 'aria-current="page"' : ''}>Child ${i + 1} — ${esc(s.name)}</a>`).join('')}</nav>` : '';
    let body;
    if (!a) {
      body = `<section class="panel"><h2>Not yet submitted</h2>
        <p class="muted">The parent has not submitted this profile yet, so its answers are not shown. Progress so far: ${c.percent}%.</p>
        ${c.missing.length ? `<p>Sections still to complete: ${c.missing.map((k) => `<span class="badge">${esc(SECTION_TITLE[k])}</span>`).join(' ')}</p>` : ''}</section>`;
    } else {
      const sec = F.sections(a, d.family.travel || {});
      const comp = d.submittedCompletion;
      body = S.SECTIONS.map((s, i) => `<section class="profile-section ${s.key === 'health' ? 'health' : ''}">
        <header><h2><span class="num">${i + 1}.</span>${esc(s.title)}</h2>${comp.sections[s.key] ? '<span class="flag ok">Complete</span>' : `<span class="flag">${s.required ? 'Incomplete' : 'Optional — not answered'}</span>`}</header>
        <div class="body">${sec[s.key] ? `<dl>${sec[s.key]}</dl>` : '<p class="muted">No answers given.</p>'}</div></section>`).join('');
    }
    render(`<a class="crumb" href="#/families/${d.family.id}">← ${esc(d.family.family_name)}</a>
      ${tabs}
      <div class="family-hero">
        <span class="eyebrow">${esc(d.family.family_name)} · Child Profile</span>
        <h1>${esc(c.full_name || c.name)}${c.age_label ? `, ${esc(c.age_label)}` : ''}</h1>
        <dl class="info">
          <div><dt>Preferred name</dt><dd>${esc(c.preferred_name || '—')}</dd></div>
          <div><dt>Originally submitted</dt><dd>${date(c.first_submitted_at)}</dd></div>
          <div><dt>Last submitted</dt><dd>${date(c.submitted_at)}</dd></div>
          <div><dt>Last updated by parent</dt><dd>${date(c.updated_at)}</dd></div>
          <div><dt>Profile</dt><dd>${pill(c.completion_status, COMPLETION)}</dd></div>
          <div><dt>Health consent</dt><dd>${d.health_consent_at ? date(d.health_consent_at) : '—'}</dd></div>
        </dl>
        ${d.parentEditing ? '<div class="notice warning">The parent is editing this profile. You are seeing the version they last submitted; changes appear once they resubmit.</div>' : ''}
        ${a ? `<div class="actions-row"><span class="readonly-tag">Your review:</span><div class="review-buttons">
          ${['ready_for_review', 'more_info_needed', 'reviewed'].map((k) => `<button class="btn btn-small" data-review="${k}" aria-pressed="${c.review_status === k}">${REVIEW[k]}</button>`).join('')}
        </div></div>` : ''}
        <p class="readonly-tag">Parent answers are read-only — they cannot be changed from this dashboard.</p>
      </div>
      <div class="grid-main"><div>${body}</div>${notesPanel(d.notes, { family_id: d.family.id, child_id: c.id })}</div>`);
    view().dataset.child = c.id;
  }

  // ------------------------------------------------------------------ care preferences

  async function care() {
    const d = await A.get('/api/admin/care-preferences');
    const list = (xs) => (xs && xs.length ? F.badges(xs) : '—');
    render(`<div class="page-title"><div><span class="eyebrow">At a Glance</span><h1>Care Preferences</h1></div></div>
      <p class="muted">Key care details from every submitted profile, for planning and caregiver preparation. Open a child for full details.</p>
      <section class="panel">${d.children.length ? `<div class="table-wrap"><table class="data"><thead><tr><th>Child</th><th>Food allergies</th><th>Diet</th><th>Traditions</th><th>Sensory</th><th>Comfort</th><th>Travel</th></tr></thead><tbody>
        ${d.children.map((c) => `<tr class="clickable" data-href="#/children/${c.id}"><td><span class="name">${esc(c.name)}</span><span class="sub">${esc(c.age_label)} · ${esc(c.family_name)}</span>${c.medical ? '<span class="flag">Medical notes</span>' : ''}</td>
          <td>${c.allergies === 'Yes' ? `<span class="flag">Yes</span><span class="sub">${esc(c.allergy_details)}</span>` : esc(c.allergies || '—')}</td>
          <td>${list(c.diet)}</td><td>${list(c.traditions)}</td><td>${list(c.sensory)}</td><td>${list(c.comfort)}</td>
          <td>${esc(c.destination || '—')}<span class="sub">${esc(c.arrangement)}</span></td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty">No submitted profiles yet.</div>'}</section>`);
  }

  // ------------------------------------------------------------------ messages

  async function messages() {
    const d = await A.get('/api/admin/messages');
    render(`<div class="page-title"><div><span class="eyebrow">Messages</span><h1>Private Feedback</h1></div></div>
      <p class="muted">Private notes from families in the portal, and messages sent through the website contact form.</p>
      ${d.messages.length ? d.messages.map((m) => `<section class="panel"><div class="page-title">
          <div><span class="eyebrow">${m.source === 'family_feedback' ? 'Family note' : 'Contact form'} · ${date(m.created_at)}</span>
            <h2>${esc(m.subject || (m.family_name || m.name))}</h2>
            <span class="muted">${esc(m.name)} · <a href="mailto:${esc(m.email)}">${esc(m.email)}</a>${m.family_id ? ` · <a href="#/families/${m.family_id}">${esc(m.family_name)}</a>` : ''}</span></div>
          <div>${m.is_read ? '' : '<span class="pill new">Unread</span>'}</div></div>
          <p class="note-item">${esc(m.body)}</p>
          <div class="actions-row"><button class="btn btn-small btn-quiet" data-msg-read="${m.id}" data-v="${!m.is_read}">${m.is_read ? 'Mark Unread' : 'Mark Read'}</button>
            <button class="btn btn-small btn-quiet danger" data-msg-delete="${m.id}">Delete</button></div></section>`).join('') : '<section class="panel"><div class="empty">No messages yet.</div></section>'}`);
  }

  // ------------------------------------------------------------------ settings

  async function settings() {
    const d = await A.get('/api/admin/settings');
    const st = d.storage;
    render(`<div class="page-title"><div><span class="eyebrow">Administration</span><h1>Settings</h1></div></div>
      <div class="grid-2">
        <section class="panel"><h2>System status</h2>
          <dl class="info">
            <div class="wide"><dt>Secure storage</dt><dd>${st.ready ? 'Verified — encryption key loaded, row-level security active' : `<span class="flag">Not ready</span> ${esc(st.problems.join(' '))}`}</dd></div>
            <div class="wide"><dt>Email</dt><dd>${d.emailConfigured ? 'Configured' : 'Not configured — invitations will show a link for you to send yourself'}</dd></div>
            <div class="wide"><dt>Portal address</dt><dd>${esc(d.publicUrl)}</dd></div>
          </dl></section>
        <section class="panel"><h2>Your account</h2>
          <form data-change-password novalidate>
            <label class="field"><span class="label">Current password</span><input class="input" type="password" name="current" autocomplete="current-password" required></label>
            <label class="field"><span class="label">New password</span><input class="input" type="password" name="next" autocomplete="new-password" minlength="10" required></label>
            <button class="btn btn-small" type="submit">Change Password</button></form>
          <div class="inline-form"><span class="fieldset-label">Two-step verification</span>
            ${me.totp_enabled ? `<p>On — an authenticator code is required at sign in.</p>
              <form data-totp-disable class="filters" novalidate><label class="field"><span class="label">Password to turn off</span><input class="input" type="password" name="password" required></label><button class="btn btn-small btn-quiet" type="submit">Turn Off</button></form>`
              : `<p class="muted">Strongly recommended. Uses an authenticator app such as Google Authenticator or 1Password.</p><button class="btn btn-small btn-primary" data-totp-setup>Set Up</button><div data-totp-area></div>`}
          </div></section>
      </div>
      <section class="panel"><h2>Administrators</h2>
        <table class="data"><thead><tr><th>Name</th><th>Email</th><th>Two-step</th><th>Last sign-in</th><th></th></tr></thead><tbody>
        ${d.admins.map((x) => `<tr><td>${esc(x.name)}</td><td>${esc(x.email)}</td><td>${x.totp_enabled ? 'On' : 'Off'}</td><td>${date(x.last_login_at)}</td>
          <td>${x.id === d.meId ? '<span class="muted">You</span>' : `<button class="link-btn" data-remove-admin="${x.id}">Remove</button>`}</td></tr>`).join('')}
        </tbody></table>
        <form class="filters inline-form" data-add-admin novalidate>
          <label class="field"><span class="label">Name</span><input class="input" name="name" required></label>
          <label class="field"><span class="label">Email</span><input class="input" type="email" name="email" required></label>
          <label class="field"><span class="label">Temporary password</span><input class="input" type="password" name="password" minlength="10" required></label>
          <button class="btn btn-small" type="submit">Add Administrator</button></form></section>
      <div class="grid-2">
        <section class="panel"><h2>Data retention</h2>
          <p class="muted">Families archived, or inactive for more than ${d.retentionMonths} months. Review each and delete those you no longer need (open the family, export if required, then delete).</p>
          ${d.retention.length ? `<ul>${d.retention.map((r) => `<li><a href="#/families/${r.id}">${esc(r.family_name)}</a> · ${esc(FAM_STATUS[r.status])} · last activity ${date(r.updated_at)}</li>`).join('')}</ul>` : '<p>None at the moment.</p>'}
          <p>${d.oldInquiries} declined or archived ${d.oldInquiries === 1 ? 'inquiry is' : 'inquiries are'} older than ${d.retentionMonths} months.</p>
          ${d.oldInquiries ? '<button class="btn btn-small btn-quiet danger" data-purge-inquiries>Delete Old Inquiries</button>' : ''}</section>
        <section class="panel"><h2>Demonstration data</h2>
          <p class="muted">Fictional families created for testing are marked “Demo”. Remove them all before welcoming real clients.</p>
          <p>${d.demo.families} demo families · ${d.demo.inquiries} demo inquiries · ${d.demo.messages} demo messages</p>
          ${d.demo.families + d.demo.inquiries + d.demo.messages ? '<button class="btn btn-small danger" data-remove-demo>Remove All Demonstration Data</button>' : ''}</section>
      </div>
      <section class="panel"><h2>Recent activity <small>Sign-ins, views and changes — never questionnaire content</small></h2><div data-audit><button class="btn btn-small btn-quiet" data-load-audit>Show Activity Log</button></div></section>`);
  }

  // ------------------------------------------------------------------ events

  root.addEventListener('click', async (e) => {
    const row = e.target.closest('tr[data-href]');
    if (row && !e.target.closest('a, button')) { location.hash = row.dataset.href; return; }
    const t = e.target.closest('button');
    if (!t) return;
    try {
      if (t.dataset.inqFilter !== undefined) { inqFilter = t.dataset.inqFilter; await inquiries(); return; }
      if (t.dataset.inqStatus) {
        await A.patch(`/api/admin/inquiries/${view().dataset.inquiry}`, { status: t.dataset.inqStatus });
        toast(`Marked ${INQ_STATUS[t.dataset.inqStatus]}.`); await inquiryDetail(view().dataset.inquiry); refreshCounts(); return;
      }
      if (t.dataset.inviteInquiry) {
        t.disabled = true;
        const r = await A.post(`/api/admin/inquiries/${t.dataset.inviteInquiry}/invite`);
        await inquiryDetail(t.dataset.inviteInquiry); inviteResult(r); refreshCounts(); return;
      }
      if (t.dataset.toggle) { const p = view().querySelector(`[data-panel="${t.dataset.toggle}"]`); p.hidden = !p.hidden; return; }
      if (t.dataset.clearFilter !== undefined) { Object.keys(famFilter).forEach((k) => { famFilter[k] = ''; }); await families(); return; }
      if (t.dataset.familyInvite !== undefined) {
        t.disabled = true;
        const r = await A.post(`/api/admin/families/${currentId()}/invite`);
        if (r.hasAccount) toast(r.emailSent ? 'Reminder sent.' : (r.emailNote || 'Email is not configured.')); else inviteResult(r);
        t.disabled = false; return;
      }
      if (t.dataset.resetLink !== undefined) {
        inviteResult(await A.post(`/api/admin/families/${currentId()}/reset-link`));
        return;
      }
      if (t.dataset.review) {
        await A.patch(`/api/admin/children/${view().dataset.child}/review`, { review_status: t.dataset.review });
        view().querySelectorAll('[data-review]').forEach((b) => b.setAttribute('aria-pressed', String(b === t)));
        toast(`Marked ${REVIEW[t.dataset.review]}.`); return;
      }
      if (t.dataset.deleteNote) { await A.del(`/api/admin/notes/${t.dataset.deleteNote}`); t.closest('.note-item').remove(); return; }
      if (t.dataset.msgRead) { await A.patch(`/api/admin/messages/${t.dataset.msgRead}`, { is_read: t.dataset.v === 'true' }); await messages(); refreshCounts(); return; }
      if (t.dataset.msgDelete) { if (!confirm('Delete this message permanently?')) return; await A.del(`/api/admin/messages/${t.dataset.msgDelete}`); await messages(); refreshCounts(); return; }
      if (t.dataset.removeAdmin) { if (!confirm('Remove this administrator? They will be signed out immediately.')) return; await A.del(`/api/admin/admins/${t.dataset.removeAdmin}`); await settings(); return; }
      if (t.dataset.removeDemo !== undefined) {
        if (!confirm('Permanently remove all demonstration families, inquiries and messages?')) return;
        const r = await A.del('/api/admin/demo-data');
        toast(`Removed ${r.removed.families} families, ${r.removed.inquiries} inquiries, ${r.removed.messages} messages.`); await settings(); return;
      }
      if (t.dataset.purgeInquiries !== undefined) {
        if (!confirm('Permanently delete old declined and archived inquiries?')) return;
        const r = await A.del('/api/admin/old-inquiries'); toast(`Deleted ${r.removed} inquiries.`); await settings(); return;
      }
      if (t.dataset.totpSetup !== undefined) {
        const r = await A.post('/api/admin/me/totp/setup');
        view().querySelector('[data-totp-area]').innerHTML = `<p>Scan this code with your authenticator app, then enter the 6-digit code it shows.</p>
          <div class="qr">${r.qrSvg}</div><p class="muted">Or enter this key manually: <code>${esc(r.secret)}</code></p>
          <form data-totp-enable class="filters" novalidate><label class="field"><span class="label">Code</span><input class="input" name="code" inputmode="numeric" maxlength="6" required></label><button class="btn btn-small btn-primary" type="submit">Turn On</button></form>`;
        return;
      }
      if (t.dataset.loadAudit !== undefined) {
        const r = await A.get('/api/admin/audit');
        view().querySelector('[data-audit]').innerHTML = `<div class="table-wrap"><table class="data"><thead><tr><th>When</th><th>Who</th><th>Action</th></tr></thead><tbody>
          ${r.entries.map((x) => `<tr><td>${esc(new Date(x.created_at).toLocaleString())}</td><td>${esc(x.actor_name || x.actor_kind)}</td><td>${esc(x.action.replace(/[._]/g, ' '))}</td></tr>`).join('')}</tbody></table></div>`;
      }
    } catch (err) { t.disabled = false; fail(err); }
  });

  const currentId = () => location.hash.split('/')[2];

  root.addEventListener('change', async (e) => {
    if (e.target.matches('[data-family-status]')) {
      try { await A.patch(`/api/admin/families/${currentId()}`, { status: e.target.value }); toast(`Family marked ${FAM_STATUS[e.target.value]}.`); }
      catch (err) { fail(err); }
    }
  });

  root.addEventListener('submit', async (e) => {
    const form = e.target;
    if (!root.contains(form) || form.matches('[data-login], [data-setup]')) return;
    e.preventDefault();
    if (!A.checkRequired(form)) return;
    const d = A.formData(form);
    try {
      if (form.matches('[data-fam-filter]')) { Object.assign(famFilter, { q: d.q, status: d.status, destination: d.destination, from: d.from, to: d.to }); await families(); }
      else if (form.matches('[data-add-family]')) {
        const r = await A.post('/api/admin/families', d);
        location.hash = `#/families/${r.familyId}`;
        setTimeout(() => inviteResult(r), 400);
      } else if (form.matches('[data-add-note]')) {
        const target = JSON.parse(form.closest('[data-notes]').dataset.notes);
        const r = await A.post('/api/admin/notes', { ...target, body: d.body });
        form.reset();
        form.parentElement.querySelector('.notes-list').insertAdjacentHTML('afterbegin', noteHtml(r.note));
      } else if (form.matches('[data-request-info]')) {
        const ids = [...form.querySelectorAll('input[name=child]:checked')].map((x) => x.value);
        const r = await A.post(`/api/admin/families/${currentId()}/request-info`, { message: d.message, child_ids: ids });
        toast(r.emailSent ? 'Request sent to the family.' : `Marked as needing more information. ${r.emailNote || ''} Please contact the family directly.`);
        await familyDetail(currentId());
      } else if (form.matches('[data-delete-family]')) {
        await A.del(`/api/admin/families/${currentId()}`, { confirm: d.confirm });
        toast('The family record has been permanently deleted.');
        location.hash = '#/families';
      } else if (form.matches('[data-change-password]')) {
        await A.post('/api/admin/me/password', d); form.reset(); toast('Password changed.');
      } else if (form.matches('[data-totp-enable]')) {
        await A.post('/api/admin/me/totp/enable', d); me.totp_enabled = true; toast('Two-step verification is on.'); await settings();
      } else if (form.matches('[data-totp-disable]')) {
        await A.post('/api/admin/me/totp/disable', d); me.totp_enabled = false; toast('Two-step verification is off.'); await settings();
      } else if (form.matches('[data-add-admin]')) {
        await A.post('/api/admin/admins', d); toast('Administrator added.'); await settings();
      }
    } catch (err) { fail(err); }
  });

  async function refreshCounts() {
    try { counts = (await A.get('/api/admin/overview')).stats; setCounts(); } catch { /* ignore */ }
  }

  window.addEventListener('hashchange', route);
  boot().then(refreshCounts);
})();
