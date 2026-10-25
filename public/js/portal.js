/* AHUVAI family portal: "My Family" dashboard and the 13-step child profile questionnaire.
 * Answers are saved to the server as parents type (never to browser storage). */
(function () {
  'use strict';
  const A = window.Ahuvai;
  const S = window.AhuvaiSchema;
  const esc = A.esc;
  const O = S.OPTIONS;
  const app = document.getElementById('app');
  const stepCountEl = document.querySelector('[data-step-count]');
  const saveStateEl = document.querySelector('[data-save-state]');
  const progressEl = document.querySelector('[data-progress-fill]');
  const banner = document.querySelector('[data-storage-banner]');
  // Available photography, e.g. "journey.jpg" -> journey
  const photos = new Map((document.body.dataset.photos || '').split(',').filter(Boolean).map((f) => [f.replace(/\.[^.]+$/, ''), f]));

  const state = {
    me: null,
    child: null,        // { id, answers, summary }
    travel: {},
    timers: {},
    pending: {},        // scope -> promise of an in-flight save
    lastError: null,
  };

  const STEP_KEYS = S.STEPS.map((s) => s.key);
  const stepNo = (key) => STEP_KEYS.indexOf(key) + 1;

  const PANEL = {
    welcome: { photos: ['portal', 'hero'], quote: 'Getting to know your most cherished ones.' },
    children: { photos: ['family', 'hero'], quote: 'A separate, private profile for every child.' },
    basic: { photos: ['story'], quote: 'Every introduction begins with a name.' },
    temperament: { photos: ['care'], quote: 'Understanding temperament allows us to pace each new experience gently.' },
    interests: { photos: ['play', 'care'], quote: 'Children engage most deeply with what they already love.' },
    routines: { photos: ['residence'], quote: 'Familiar rhythms help children feel at home anywhere.' },
    health: { photos: ['kitchen', 'residence'], quote: 'Shared privately. Held carefully.' },
    comfort: { photos: ['comfort', 'care'], quote: 'Knowing what soothes your child means comfort comes quickly.' },
    sensory: { photos: ['garden', 'villa'], quote: 'Small details can make a world of difference.' },
    traditions: { photos: ['tradition'], quote: "Your family's traditions, respected as you observe them." },
    travel: { photos: ['journey'], quote: 'Every journey, thoughtfully prepared.' },
    additional: { photos: ['villa'], quote: 'Anything that matters to you matters to us.' },
    review: { photos: ['hero'], quote: 'Every child is unique. Every family is different. Every journey matters.' },
  };

  const ICONS = {
    'Art and crafts': '<path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.5-.8 1.2-1.6-.4-1 .2-2.4 1.6-2.4H17a4 4 0 0 0 4-4c0-5.5-4-10-9-10z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="14.5" cy="7" r="1"/>',
    Music: '<path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
    Books: '<path d="M3 5c3-1 6-1 9 1 3-2 6-2 9-1v14c-3-1-6-1-9 1-3-2-6-2-9-1zM12 6v14"/>',
    Sports: '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6c3 3 3 9.8 0 12.8M18.4 5.6c-3 3-3 9.8 0 12.8"/>',
    'Nature and outdoors': '<path d="M5 19C5 10 10 5 20 4c-1 10-6 15-15 15zM5 19l8-8"/>',
    Animals: '<circle cx="7" cy="9" r="1.8"/><circle cx="11" cy="6" r="1.8"/><circle cx="15.5" cy="7" r="1.8"/><circle cx="18" cy="11" r="1.8"/><path d="M12 12c-3 0-6 3.5-6 6 0 1.5 1.2 2.5 3 2 1.5-.4 2.2-.8 3-.8s1.5.4 3 .8c1.8.5 3-.5 3-2 0-2.5-3-6-6-6z"/>',
    'Building and LEGO': '<rect x="3" y="10" width="18" height="10"/><rect x="6" y="6" width="4" height="4"/><rect x="14" y="6" width="4" height="4"/>',
    'Cooking and baking': '<path d="M7 14a4 4 0 0 1-1-7.9A5 5 0 0 1 15.5 5 4 4 0 1 1 17 14zM7 14v6h10v-6M7 17h10"/>',
    'Water activities': '<path d="M2 9c2.5-2 4.5-2 7 0s4.5 2 7 0 4.5-2 6 0M2 14c2.5-2 4.5-2 7 0s4.5 2 7 0 4.5-2 6 0M2 19c2.5-2 4.5-2 7 0s4.5 2 7 0 4.5-2 6 0"/>',
    'Pretend play': '<path d="M3 18h18M4 18 3 7l5 4 4-6 4 6 5-4-1 11"/>',
    Technology: '<rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M11 18h2"/>',
    Other: '<path d="M12 3c.6 5 3.4 7.4 8 9-4.6 1.6-7.4 4-8 9-.6-5-3.4-7.4-8-9 4.6-1.6 7.4-4 8-9z"/>',
  };
  const icon = (name) => `<svg class="tile-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.Other}</svg>`;

  const FALLBACK = '<div class="photo-fallback" aria-hidden="true"><svg viewBox="0 0 400 500" preserveAspectRatio="xMidYMid slice"><rect width="400" height="500" fill="#E9DFCF"/><path d="M110 470V230a90 90 0 0 1 180 0v240" fill="#F4EEE4" stroke="#B9A078" stroke-width="1.2"/><path d="M128 470V236a72 72 0 0 1 144 0v234" fill="none" stroke="#B9A078" stroke-width=".6" opacity=".7"/><line x1="200" y1="164" x2="200" y2="470" stroke="#B9A078" stroke-width=".6" opacity=".5"/><path d="M128 360q36-10 72-4t72-4" fill="none" stroke="#496779" stroke-width=".8" opacity=".45"/><path d="M200 196c1.4 9 3.6 11.6 12 13-8.4 1.4-10.6 4-12 13-1.4-9-3.6-11.6-12-13 8.4-1.4 10.6-4 12-13z" fill="#B9A078"/><line x1="60" y1="470" x2="340" y2="470" stroke="#B9A078"/></svg></div>';

  // ------------------------------------------------------------------ data helpers

  function getPath(path) {
    const [scope, ...rest] = path.split('.');
    let obj = scope === 'family' ? state.travel : state.child.answers[scope];
    for (const k of rest.slice(0, -1)) obj = obj[k];
    return obj[rest[rest.length - 1]];
  }
  function setPath(path, value) {
    const [scope, ...rest] = path.split('.');
    const obj = scope === 'family' ? state.travel : state.child.answers[scope];
    obj[rest[rest.length - 1]] = value;
    scheduleSave(scope === 'family' ? 'family' : 'child');
  }

  function childName(c) { return c.name || 'Your child'; }
  const STATUS_LABEL = {
    not_started: 'Not Started', in_progress: 'In Progress', complete: 'Complete — Ready to Submit',
    submitted: 'Submitted', editing_after_submit: 'Edited — Not Yet Resubmitted',
  };

  function setSaveState(text, isError) {
    saveStateEl.textContent = text;
    saveStateEl.classList.toggle('error', !!isError);
  }

  function setHeader(stepKey) {
    if (!stepKey) { stepCountEl.innerHTML = ''; progressEl.style.width = '0%'; return; }
    const n = stepNo(stepKey);
    stepCountEl.innerHTML = `${String(n).padStart(2, '0')}<span class="of">/</span>${S.STEPS.length}`;
    stepCountEl.setAttribute('aria-label', `Step ${n} of ${S.STEPS.length}`);
    progressEl.style.width = `${(n / S.STEPS.length) * 100}%`;
  }

  function handleAuthError(err) {
    if (err.status === 401) { location.href = '/portal'; return true; }
    if (err.data && err.data.code === 'storage_not_ready') banner.hidden = false;
    return false;
  }

  // ------------------------------------------------------------------ saving

  function scheduleSave(scope) {
    setSaveState('Saving…');
    clearTimeout(state.timers[scope]);
    state.timers[scope] = setTimeout(() => runSave(scope), 800);
  }

  async function runSave(scope) {
    clearTimeout(state.timers[scope]);
    delete state.timers[scope];
    if (state.pending[scope]) await state.pending[scope].catch(() => {});
    const task = (async () => {
      if (scope === 'family') {
        await A.put('/api/family/travel', { travel: state.travel });
        if (state.child) state.child.summary = (await A.get(`/api/family/children/${state.child.id}`)).child;
      } else if (state.child) {
        const r = await A.put(`/api/family/children/${state.child.id}`, { answers: state.child.answers });
        state.child.summary = r.child;
        updateChildChip(r.child);
      }
    })();
    state.pending[scope] = task;
    try {
      await task;
      state.lastError = null;
      if (!Object.keys(state.timers).length) setSaveState('Saved');
    } catch (err) {
      state.lastError = err;
      if (!handleAuthError(err)) setSaveState('Not saved', true);
      throw err;
    } finally {
      if (state.pending[scope] === task) delete state.pending[scope];
    }
  }

  // Saves anything outstanding. Resolves false when saving failed.
  async function flush() {
    const scopes = new Set([...Object.keys(state.timers), ...Object.keys(state.pending)]);
    let ok = true;
    for (const scope of scopes) {
      try {
        if (state.timers[scope]) await runSave(scope);
        else await state.pending[scope];
      } catch { ok = false; }
    }
    return ok;
  }

  window.addEventListener('beforeunload', (e) => {
    if (Object.keys(state.timers).length || Object.keys(state.pending).length) { flush(); e.preventDefault(); e.returnValue = ''; }
  });

  // ------------------------------------------------------------------ loading

  async function loadMe() {
    try { state.me = await A.get('/api/family/me'); }
    catch (err) { if (!handleAuthError(err)) app.innerHTML = `<div class="app-loading">${esc(err.message)}</div>`; throw err; }
    banner.hidden = state.me.storageReady;
    state.travel = Object.assign({}, state.me.family.travel || {});
    return state.me;
  }

  async function loadChild(id) {
    if (state.child && state.child.id === id) return state.child;
    const r = await A.get(`/api/family/children/${id}`);
    state.child = { id, answers: r.answers, summary: r.child };
    state.travel = Object.assign({}, r.travel || {});
    return state.child;
  }

  // ------------------------------------------------------------------ routing

  function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }

  async function route() {
    const ok = await flush();
    if (!ok && state.lastError && state.lastError.data && state.lastError.data.code !== 'storage_not_ready') {
      if (!confirm('Your latest answers could not be saved. Leave this page anyway?')) return;
    }
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    try {
      await loadMe();
      if (parts[0] === 'start') return renderWelcome();
      if (parts[0] === 'children') return renderChildren();
      if (parts[0] === 'child' && parts[1]) {
        const key = STEP_KEYS.includes(parts[2]) && STEP_KEYS.indexOf(parts[2]) >= 2 ? parts[2] : 'basic';
        if (!state.me.children.some((c) => c.id === parts[1])) return go('#/');
        state.child = state.child && state.child.id === parts[1] ? state.child : null;
        await loadChild(parts[1]);
        return key === 'review' ? renderReview() : renderStep(key);
      }
      if (parts[0] === 'thanks') return renderThanks((parts[1] || '').split(','));
      state.child = null;
      return renderDashboard();
    } catch (err) {
      if (!handleAuthError(err)) app.innerHTML = `<div class="app-loading">${esc(err.message)}</div>`;
    }
  }

  function show(html, focus) {
    app.innerHTML = html;
    app.firstElementChild && app.firstElementChild.classList.add('fade-in');
    window.scrollTo(0, 0);
    if (focus !== false) app.focus({ preventScroll: true });
  }

  // ------------------------------------------------------------------ dashboard

  function firstOpenStep(c) {
    if (c.completion_status === 'not_started') return 'basic';
    const missing = (c.missing || []).filter((k) => S.SECTIONS.find((s) => s.key === k).required);
    return missing[0] || 'review';
  }

  function childActions(c) {
    const href = (k) => `#/child/${c.id}/${k}`;
    const b = (label, k, primary) => `<a class="btn btn-small ${primary ? 'btn-primary' : 'btn-quiet'}" href="${href(k)}">${label}</a>`;
    switch (c.completion_status) {
      case 'not_started': return b('Begin Profile', 'basic', true);
      case 'in_progress': return b('Continue Profile', firstOpenStep(c), true) + b('View Profile', 'review');
      case 'complete': return b('Review &amp; Submit', 'review', true) + b('Edit Profile', 'basic');
      case 'editing_after_submit': return b('Review &amp; Resubmit', 'review', true) + b('Edit Profile', 'basic');
      default: return b('View Profile', 'review', true) + b('Edit Profile', 'basic');
    }
  }

  function renderDashboard() {
    setHeader(null);
    setSaveState('');
    const { family, user, children } = state.me;
    const t = family.travel || {};
    const ready = children.filter((c) => c.completion_status === 'complete' || c.completion_status === 'editing_after_submit');
    const firstName = (user.name || '').split(' ')[0];
    const cards = children.map((c, i) => `
      <article class="child-card">
        <div>
          <span class="ordinal">Child ${i + 1}</span>
          <h2>${esc(childName(c))}${c.age_label ? `<span class="age">${esc(c.age_label)}</span>` : ''}</h2>
          <div class="child-status">
            <span class="status-pill ${c.completion_status}">${STATUS_LABEL[c.completion_status]}</span>
            <span class="meter" aria-hidden="true"><span data-w="${c.percent}"></span></span>
            <span>${c.percent}% Complete</span>
          </div>
        </div>
        <div class="child-actions">${childActions(c)}</div>
        ${c.review_status === 'more_info_needed' ? '<p class="note">AHUVAI has asked for a little more information. Please review this profile and resubmit when ready.</p>' : ''}
        ${c.completion_status === 'submitted' && c.submitted_at ? `<p class="note received">Received by AHUVAI on ${esc(A.fmtDate(c.submitted_at))}.</p>` : ''}
      </article>`).join('');

    show(`<div class="dash">
      <div class="dash-head">
        <div>
          <span class="eyebrow">Private Family Portal</span>
          <h1>My Family</h1>
          <p class="lede">Welcome${firstName ? ', ' + esc(firstName) : ''}. Each child has a private profile — complete them at your own pace; your answers are saved as you go.</p>
        </div>
        ${t.destination ? `<div class="trip-card"><span class="label">Your Journey</span><div class="dest">${esc(t.destination)}</div><div class="dates">${esc(A.fmtRange(t.start_date, t.end_date))}</div></div>` : ''}
      </div>
      <h2 class="section-label">${esc(family.family_name)}</h2>
      ${children.length ? `<div class="child-cards">${cards}</div>
        <div class="dash-actions">
          <button class="add-child" type="button" data-action="add-child">+ Add Another Child</button>
          <button class="btn btn-primary" type="button" data-action="submit-all" ${ready.length ? '' : 'disabled'}>Submit Family Profiles ${A.arrow}</button>
        </div>
        <div class="notice error" role="alert" data-dash-error></div>`
        : `<div class="empty-state"><span class="eyebrow">Let's Begin</span><h2>Getting to know your most cherished ones</h2>
            <p class="lede center">Create a profile for each child who will be in AHUVAI's care.</p>
            <a class="btn btn-primary" href="#/start">Begin ${A.arrow}</a></div>`}
      <section class="dash-note">
        <div><h3>A private note to AHUVAI</h3><p class="muted">Questions, thoughts, or feedback about your experience. Only the AHUVAI team can read this.</p></div>
        <form data-feedback-form novalidate>
          <div class="notice" role="status" data-form-error></div>
          <label class="field"><span class="label">Message</span><textarea class="input" name="message" required maxlength="4000"></textarea></label>
          <button class="btn btn-quiet" type="submit" data-submit>Send Note</button>
        </form>
      </section>
    </div>`);
    app.querySelectorAll('.meter span').forEach((el) => { el.style.width = el.dataset.w + '%'; });
  }

  // ------------------------------------------------------------------ step 1 & 2

  function layout(stepKey, content, opts = {}) {
    const p = PANEL[stepKey];
    const photo = p.photos.find((n) => photos.has(n));
    const n = String(stepNo(stepKey)).padStart(2, '0');
    const title = S.STEPS[stepNo(stepKey) - 1].title;
    return `<div class="q-layout">
      <aside class="q-panel ${photo ? '' : 'no-photo'}" aria-hidden="true">
        ${photo ? `<img src="/images/${esc(photos.get(photo))}" alt="" data-photo>` : FALLBACK}
        <div class="q-panel-text"><span class="q-panel-num">${n}</span><span class="q-panel-title">${esc(title)}</span><p class="q-panel-quote">${esc(p.quote)}</p></div>
      </aside>
      <section class="q-content ${opts.centered ? 'centered' : ''}">${content}</section>
    </div>`;
  }

  function renderWelcome() {
    setHeader('welcome');
    show(layout('welcome', `
      <span class="q-step-label">Child Profiles</span>
      <h1>Getting to Know Your Most Cherished Ones.</h1>
      <div class="divider left">${A.star}</div>
      <p class="q-intro">Every child is unique. By understanding their personality, routines, interests, and individual needs, we can prepare a childcare experience thoughtfully tailored to them.</p>
      <p class="q-intro muted">You'll complete a separate profile for each child. It takes about fifteen minutes per child, your answers are saved automatically, and you can return at any time.</p>
      <div class="q-nav"><a class="btn btn-back" href="#/">${A.arrow} My Family</a><a class="btn btn-primary" href="#/children">Begin Profile ${A.arrow}</a></div>`));
  }

  function renderChildren() {
    setHeader('children');
    const kids = state.me.children;
    const count = kids.length;
    const sel = (n) => (n === '4+' ? count >= 4 : count === Number(n));
    const rows = kids.map((c, i) => `
      <div class="kid-row">
        <span class="n">${i + 1}</span>
        <label><span class="sr-only">Child ${i + 1} first name</span><input class="input" type="text" value="${esc(c.preferred_name || (c.full_name || '').split(' ')[0])}" placeholder="Child ${i + 1}'s first name" data-kid-name="${c.id}" maxlength="60"></label>
        <span class="status-pill ${c.completion_status}">${c.percent}%</span>
        <button class="remove" type="button" data-remove-kid="${c.id}" ${c.first_submitted_at ? 'disabled title="Already shared with AHUVAI"' : ''}>Remove</button>
      </div>`).join('');
    show(layout('children', `
      <span class="q-step-label">Create Child Profiles</span>
      <h1>How many children will require care?</h1>
      <p class="q-intro">We'll create an individual profile for each child. You can add or remove a child at any time.</p>
      <div class="tiles four" role="radiogroup" aria-label="Number of children">
        ${['1', '2', '3', '4+'].map((n) => `<button type="button" class="tile big" role="radio" aria-checked="${sel(n)}" data-count="${n}">${n}</button>`).join('')}
      </div>
      <div class="count-other" data-count-other ${count >= 4 ? '' : 'hidden'}>
        <label class="field"><span class="label">Number of children</span><input class="input" type="number" min="4" max="12" value="${count >= 4 ? count : 4}" data-count-input></label>
      </div>
      <div class="notice error" role="alert" data-step-error></div>
      ${count ? `<h2 class="q-question">Your children</h2><p class="q-sub">Add each child's first name — you'll complete their full profile next.</p><div class="kid-rows">${rows}</div>
        <div class="dash-actions"><button class="add-child" type="button" data-action="add-child-inline">+ Add Another Child</button></div>` : ''}
      <div class="q-nav"><a class="btn btn-back" href="#/start">${A.arrow} Back</a>
        <button class="btn btn-primary" type="button" data-action="children-next" ${count ? '' : 'disabled'}>Next ${A.arrow}</button></div>`));
  }

  async function setChildCount(n) {
    const err = app.querySelector('[data-step-error]');
    err.textContent = '';
    const count = state.me.children.length;
    if (n < count) {
      err.textContent = `You currently have ${count} profiles. To remove one, use "Remove" beside that child below.`;
      return;
    }
    try {
      if (n > count) await A.post('/api/family/children/ensure-count', { count: n });
      await loadMe();
      renderChildren();
    } catch (e) { if (!handleAuthError(e)) err.textContent = e.message; }
  }

  // ------------------------------------------------------------------ field builders

  const req = (s) => (s ? '' : ' <span class="optional">optional</span>');

  function input(path, label, o = {}) {
    const v = getPath(path) || '';
    const id = 'f-' + path.replace(/\./g, '-');
    const ctl = o.rows
      ? `<textarea class="input" id="${id}" data-k="${path}" rows="${o.rows}" maxlength="${o.max || 4000}" placeholder="${esc(o.placeholder || '')}">${esc(v)}</textarea>`
      : `<input class="input" id="${id}" type="${o.type || 'text'}" data-k="${path}" value="${esc(v)}" maxlength="${o.max || 300}" placeholder="${esc(o.placeholder || '')}" ${o.autocomplete ? `autocomplete="${o.autocomplete}"` : ''}>`;
    return `<div class="field ${o.full ? 'full' : ''}" ${o.showWhen ? `data-show-when="${o.showWhen}"` : ''}><label class="label" for="${id}">${esc(label)}${req(o.required)}</label>${ctl}${o.hint ? `<span class="hint">${esc(o.hint)}</span>` : ''}${o.after || ''}</div>`;
  }

  function tiles(path, options, o = {}) {
    const val = getPath(path);
    const multi = Array.isArray(val);
    const on = (opt) => (multi ? val.includes(opt) : val === opt);
    const role = multi ? '' : 'role="radio"';
    const attr = (opt) => (multi ? `aria-pressed="${on(opt)}"` : `aria-checked="${on(opt)}"`);
    return `<div class="tiles ${o.cls || ''}" ${multi ? 'role="group"' : 'role="radiogroup"'} aria-label="${esc(o.label || '')}">
      ${options.map((opt) => `<button type="button" class="tile ${o.icons ? 'icon-tile' : ''}" ${role} ${attr(opt)} data-tile="${path}" data-v="${esc(opt)}">${o.icons ? icon(opt) : ''}<span>${esc(opt)}</span></button>`).join('')}
    </div>`;
  }

  function question(text, sub) { return `<h2 class="q-question">${esc(text)}</h2>${sub ? `<p class="q-sub">${esc(sub)}</p>` : ''}`; }

  function childSwitch() {
    const kids = state.me.children;
    if (kids.length < 2) return '';
    return `<nav class="child-switch" aria-label="Switch child"><span class="lbl">Profile for</span>
      ${kids.map((c) => `<button type="button" class="child-chip" data-switch-child="${c.id}" aria-current="${c.id === state.child.id}">${esc(childName(c))} <span class="pct" data-chip-pct="${c.id}">${c.completion_status === 'submitted' ? 'Submitted' : c.percent + '%'}</span></button>`).join('')}
    </nav>`;
  }

  function updateChildChip(summary) {
    const idx = state.me.children.findIndex((c) => c.id === summary.id);
    if (idx >= 0) state.me.children[idx] = summary;
    const pct = app.querySelector(`[data-chip-pct="${summary.id}"]`);
    if (pct) pct.textContent = summary.completion_status === 'submitted' ? 'Submitted' : summary.percent + '%';
  }

  function nav(prev, next, nextLabel) {
    return `<div class="notice error q-error" role="alert" data-step-error></div>
      <div class="q-nav"><button type="button" class="btn btn-back" data-step-go="${prev}">${A.arrow} Back</button>
      <button type="button" class="btn btn-primary" data-step-go="${next}" data-next>${nextLabel || 'Next'} ${A.arrow}</button></div>`;
  }

  // ------------------------------------------------------------------ steps 3–12

  const STEP_CONTENT = {
    basic: () => {
      const dob = getPath('basic.dob');
      return `${question('About your child')}
        <div class="q-fields">
          ${input('basic.full_name', "Child's full name", { required: true, full: true, max: 120 })}
          ${input('basic.preferred_name', 'Preferred name or nickname', { max: 60 })}
          ${input('basic.dob', 'Date of birth', { type: 'date', required: true, after: `<span class="age-readout" data-age>${esc(S.ageLabel(dob))}</span>` })}
        </div>
        ${question('Gender', 'Optional.')}
        ${tiles('basic.gender', O.gender, { cls: '', label: 'Gender' })}
        ${question('Primary languages', 'Select all that apply.')}
        ${tiles('basic.languages', O.languages, { label: 'Primary languages' })}
        <div class="reveal-field" data-show-when="basic.languages~Other">${input('basic.other_languages', 'Other languages', { max: 200 })}</div>`;
    },
    temperament: () => `${question('How would you describe your child?', 'Select all that feel true.')}
      ${tiles('temperament.traits', O.temperament, { label: 'Temperament' })}
      <div class="reveal-field" data-show-when="temperament.traits~Other">${input('temperament.other', 'Other qualities', { max: 200 })}</div>
      <div class="q-block"></div>
      ${input('temperament.notes', "Tell us a little more about your child's personality and what makes them unique.", { rows: 5, max: 4000 })}`,
    interests: () => `${question('What does your child love?', 'Select all that apply.')}
      ${tiles('interests.picks', O.interests, { icons: true, cls: 'icons', label: 'Interests' })}
      <div class="reveal-field" data-show-when="interests.picks~Other">${input('interests.other', 'Other interests', { max: 200 })}</div>
      <div class="q-block"></div>
      ${input('interests.favorites', 'Favorite characters, shows, books, or themes', { rows: 3, max: 2000 })}`,
    routines: () => `${question('A typical day', 'Approximate times are perfect.')}
      <div class="q-fields">
        ${input('routines.wake', 'Wake-up time', { type: 'time', required: true })}
        ${input('routines.bedtime', 'Bedtime', { type: 'time', required: true })}
        ${input('routines.naps', 'Nap times', { placeholder: 'e.g. 1:00–2:30 pm', full: true })}
        ${input('routines.meals', 'Meal and snack schedule', { rows: 3, full: true, max: 1000 })}
        ${input('routines.bath', 'Bath routine', { rows: 2, full: true, max: 500 })}
      </div>
      ${question('Toileting', 'Where age-appropriate.')}
      ${tiles('routines.toileting', O.toileting, { label: 'Toileting' })}
      <div class="q-block"></div>
      ${input('routines.toileting_notes', 'Diaper or potty-training needs', { rows: 2, max: 500 })}
      ${input('routines.habits', 'Important daily habits', { rows: 2, max: 1000, placeholder: 'e.g. a story before nap, a favourite cup at breakfast' })}
      ${input('routines.notes', "Is there anything important we should know about your child's routine?", { rows: 3, max: 4000 })}`,
    health: () => `<div class="privacy-card"><h3>Private &amp; protected</h3>
        <p>Health information is encrypted and visible only to you and authorized AHUVAI administrators. Relevant details are shared only with caregivers arranged for your family, so they can keep your child safe. Please share only what is genuinely helpful for their care.</p></div>
      ${question('Does your child have any food allergies or intolerances?')}
      ${tiles('health.has_allergies', O.yesNo, { cls: 'two', label: 'Food allergies' })}
      <div class="reveal-field" data-show-when="health.has_allergies=Yes">${input('health.allergy_details', 'Please describe the allergies or intolerances, and how they should be managed', { rows: 4, max: 2000 })}</div>
      ${question('Dietary preferences', 'Select any that apply.')}
      ${tiles('health.diet', O.diet, { label: 'Dietary preferences' })}
      <div class="reveal-field" data-show-when="health.diet~Other">${input('health.diet_other', 'Other dietary preferences', { max: 300 })}</div>
      ${question('Health & care information', 'Only where genuinely necessary.')}
      ${input('health.medical_conditions', 'Relevant medical conditions', { rows: 2, max: 2000 })}
      ${input('health.medications', 'Medications or care instructions', { rows: 2, max: 2000 })}
      ${input('health.emergency', 'Emergency care considerations', { rows: 2, max: 2000 })}
      <label class="check field"><input type="checkbox" data-k-bool="health.consent" ${getPath('health.consent') ? 'checked' : ''}>
        <span>I am this child's parent or legal guardian, and I consent to AHUVAI securely storing this health information and sharing it only with caregivers arranged for my family.</span></label>`,
    comfort: () => `${question('What usually helps your child when they are upset or overwhelmed?', 'Select all that apply.')}
      ${tiles('comfort.picks', O.comfort, { cls: 'two', label: 'Comfort' })}
      <div class="q-block"></div>
      ${input('comfort.techniques', 'Are there any specific calming techniques that work particularly well for your child?', { rows: 4, max: 3000 })}`,
    sensory: () => `${question('Does your child have any sensory sensitivities?', 'Select all that apply.')}
      ${tiles('sensory.picks', O.sensory, { cls: 'two', label: 'Sensory sensitivities' })}
      <div class="reveal-field" data-show-when="sensory.picks~Other">${input('sensory.other', 'Other sensitivities', { max: 200 })}</div>
      <div class="q-block"></div>
      ${input('sensory.details', 'Additional details', { rows: 3, max: 3000 })}`,
    traditions: () => `<p class="q-intro">This section is entirely optional. Every family observes in its own way, and we would rather ask than assume.</p>
      ${question('Are there any religious, cultural, or family practices you would like us to respect?', 'Select any that apply.')}
      ${tiles('traditions.picks', O.traditions, { cls: 'two', label: 'Traditions' })}
      <div class="reveal-field" data-show-when="traditions.picks~Other cultural or religious practices">${input('traditions.other', 'Other practices', { max: 300 })}</div>
      <div class="q-block"></div>
      ${input('traditions.details', 'Additional details', { rows: 4, max: 3000, placeholder: 'For example, how your family observes Shabbat, or kashrut practices in your household' })}`,
    travel: () => `<div class="shared-card"><span class="tag">Shared by all your children</span>
        <p class="q-sub">These journey details are saved once for your family and appear in each child's profile.</p>
        <div class="q-fields">
          ${input('family.destination', 'Destination', { required: true, full: true, max: 200 })}
          ${input('family.start_date', 'Arrival', { type: 'date' })}
          ${input('family.end_date', 'Departure', { type: 'date' })}
        </div>
        <span class="fieldset-label">Mode of travel</span>
        ${tiles('family.modes', O.travelModes, { cls: 'four', label: 'Mode of travel' })}
        <div class="reveal-field" data-show-when="family.modes~Other">${input('family.modes_other', 'Other mode of travel', { max: 200 })}</div>
        <div class="q-block"></div>
        ${input('family.security', 'Security or transportation considerations', { rows: 2, max: 2000 })}
      </div>
      ${question(`Will ${childName(state.child.summary)} travel with the nanny, or meet them at the destination?`)}
      ${tiles('travel.arrangement', O.arrangement, { label: 'Travel arrangement' })}
      ${question('Motion sickness')}
      ${tiles('travel.motion_sickness', O.yesNoUnsure, { label: 'Motion sickness' })}
      <div class="q-block"></div>
      ${input('travel.sensitivities', 'Travel-related sensitivities', { rows: 2, max: 2000, placeholder: 'e.g. ear discomfort on flights, unease in crowded terminals' })}
      ${input('travel.routines', 'Familiar travel routines', { rows: 2, max: 2000, placeholder: 'e.g. a favourite blanket on the plane, a snack at take-off' })}
      ${input('travel.other_needs', 'Any other relevant needs', { rows: 2, max: 2000 })}`,
    additional: () => `${question('Is there anything else we should know to provide the best possible experience for your child?')}
      <p class="q-sub">You might describe boundaries, discipline preferences, how you'd like caregivers to communicate with you, additional emotional needs, personal requests, or important family expectations.</p>
      ${input('additional.notes', 'Additional information', { rows: 10, max: 8000 })}`,
  };

  const INTROS = {
    basic: 'A few essentials, so we can greet your child by the name they love.',
    temperament: 'Every child meets the world in their own way. This helps us pace introductions and new experiences.',
    interests: "Children engage most deeply when activities connect with what they already love.",
    routines: 'Familiar routines help children feel secure — especially when travelling across time zones.',
    health: 'This information helps caregivers keep your child safe and comfortable.',
    comfort: "Knowing what already soothes your child means comfort can come quickly and gently.",
    sensory: 'Some children are more sensitive to noise, light, textures or change. Knowing this helps us anticipate and ease overwhelm.',
    traditions: '',
    travel: 'Help us prepare for the journey itself.',
    additional: '',
  };

  function renderStep(key) {
    setHeader(key);
    const idx = STEP_KEYS.indexOf(key);
    const prev = idx === 2 ? '#/children' : `#/child/${state.child.id}/${STEP_KEYS[idx - 1]}`;
    const next = `#/child/${state.child.id}/${STEP_KEYS[idx + 1]}`;
    const title = S.STEPS[idx].title;
    show(layout(key, `${childSwitch()}
      <span class="q-step-label">${esc(childName(state.child.summary))} · ${esc(title)}</span>
      <h1>${esc(title)}</h1>
      ${INTROS[key] ? `<p class="q-intro">${esc(INTROS[key])}</p>` : ''}
      <form data-step-form="${key}" novalidate>${STEP_CONTENT[key]()}</form>
      ${nav(prev, next, key === 'additional' ? 'Review' : 'Next')}`));
    updateConditionals();
  }

  function updateConditionals() {
    app.querySelectorAll('[data-show-when]').forEach((el) => {
      const rule = el.dataset.showWhen;
      const [path, val] = rule.includes('~') ? rule.split('~') : rule.split('=');
      const cur = getPath(path);
      el.hidden = !(rule.includes('~') ? Array.isArray(cur) && cur.includes(val) : cur === val);
    });
  }

  // ------------------------------------------------------------------ step 13: review

  function renderReview() {
    setHeader('review');
    const c = state.child;
    const comp = S.completion(c.answers, state.travel);
    const sections = window.AhuvaiFormat.sections(S.sanitizeAnswers(c.answers), state.travel);
    const name = childName(c.summary);
    const already = c.summary.completion_status === 'submitted';
    const others = state.me.children.filter((k) => k.id !== c.id && ['complete', 'editing_after_submit'].includes(k.completion_status));
    const blocks = S.SECTIONS.map((s) => {
      const done = comp.sections[s.key];
      const flag = done ? '<span class="flag ok">Complete</span>' : (s.required ? '<span class="flag">Needs attention</span>' : '<span class="flag ok">Optional</span>');
      return `<div class="review-section"><h3>${esc(s.title)} ${flag}</h3>
        <a class="text-link edit" href="#/child/${c.id}/${s.key}">Edit</a>
        <div class="review-body"><dl>${sections[s.key] || ''}</dl>${sections[s.key] ? '' : '<p class="muted">No answers yet.</p>'}</div></div>`;
    }).join('');
    show(layout('review', `${childSwitch()}
      <span class="q-step-label">${esc(name)} · Review &amp; Submit</span>
      <h1>Review ${esc(name)}'s profile</h1>
      <p class="q-intro">Please look over each section. Select “Edit” to change any answer before submitting.</p>
      ${c.summary.completion_status === 'editing_after_submit' ? '<div class="notice warning">You have made changes since this profile was submitted. AHUVAI will see your changes once you resubmit.</div>' : ''}
      ${already ? `<div class="notice success">This profile was received by AHUVAI on ${esc(A.fmtDate(c.summary.submitted_at))}. You can still edit and resubmit it.</div>` : ''}
      ${blocks}
      <p class="motto">Every child is unique. Every family is different. Every journey matters.</p>
      <div class="notice error" role="alert" data-step-error></div>
      <div class="submit-zone">
        ${already ? `<a class="btn btn-primary" href="#/">Return to My Family ${A.arrow}</a>`
          : `<button class="btn btn-primary" type="button" data-action="submit-child" ${comp.complete ? '' : 'disabled'}>Submit Child Profile ${A.arrow}</button>
             ${comp.complete ? '' : '<p class="muted">Please complete the sections marked “Needs attention” to submit.</p>'}
             ${comp.complete && others.length ? `<button class="link-btn" type="button" data-action="submit-all">Submit all completed profiles together (${others.length + 1})</button>` : ''}`}
      </div>
      <div class="q-nav"><a class="btn btn-back" href="#/child/${c.id}/additional">${A.arrow} Back</a><a class="link-btn" href="#/">Save &amp; return to My Family</a></div>`));
  }

  // ------------------------------------------------------------------ submission

  async function submitChild() {
    const err = app.querySelector('[data-step-error]');
    const id = state.child.id;
    err.textContent = '';
    if (!(await flush())) { err.textContent = 'Your latest answers could not be saved, so the profile was not submitted. Please try again.'; return; }
    try {
      await A.post(`/api/family/children/${id}/submit`);
      state.child = null;
      go(`#/thanks/${id}`);
    } catch (e) {
      if (!handleAuthError(e)) err.textContent = e.message;
    }
  }

  async function submitAll(errBox) {
    errBox.textContent = '';
    if (!(await flush())) { errBox.textContent = 'Your latest answers could not be saved. Please try again.'; return; }
    try {
      const r = await A.post('/api/family/submit-all');
      state.child = null;
      go(`#/thanks/${r.submitted.join(',')}`);
    } catch (e) {
      if (!handleAuthError(e)) errBox.textContent = e.message;
    }
  }

  function renderThanks(ids) {
    setHeader(null);
    const kids = state.me.children;
    const received = kids.filter((c) => ids.includes(c.id) && c.completion_status === 'submitted');
    const nextKid = kids.find((c) => c.completion_status !== 'submitted');
    show(`<div class="thanks">
      <span class="eyebrow">Thank You</span>
      <h1>${received.length > 1 ? 'Your profiles have been received.' : 'Your profile has been received.'}</h1>
      <div class="divider">${A.star}</div>
      ${received.length ? `<ul class="thanks-list">${received.map((c) => `<li>${esc(childName(c))}</li>`).join('')}</ul>` : ''}
      <p class="lede center">Thank you for helping us get to know your family. AHUVAI will review every detail personally.</p>
      <div class="actions">
        ${nextKid ? `<a class="btn btn-primary" href="#/child/${nextKid.id}/${firstOpenStep(nextKid)}">Continue with ${esc(childName(nextKid))}'s profile ${A.arrow}</a>` : ''}
        <a class="btn ${nextKid ? 'btn-quiet' : 'btn-primary'}" href="#/">Return to My Family</a>
      </div>
    </div>`);
  }

  // ------------------------------------------------------------------ events (delegated once)

  app.addEventListener('input', (e) => {
    const el = e.target;
    if (el.dataset.k) {
      setPath(el.dataset.k, el.value);
      el.removeAttribute('aria-invalid');
      if (el.dataset.k === 'basic.dob') { const out = app.querySelector('[data-age]'); if (out) out.textContent = S.ageLabel(el.value); }
    }
  });

  app.addEventListener('change', async (e) => {
    const el = e.target;
    if (el.dataset.kBool) setPath(el.dataset.kBool, el.checked);
    if (el.dataset.countInput !== undefined) {
      const n = Number(el.value);
      if (n >= 4 && n <= 12) setChildCount(n);
    }
    if (el.dataset.kidName) {
      const id = el.dataset.kidName;
      try {
        const r = await A.get(`/api/family/children/${id}`);
        r.answers.basic.preferred_name = el.value.trim();
        await A.put(`/api/family/children/${id}`, { answers: r.answers });
        await loadMe();
        setSaveState('Saved');
      } catch (err) { if (!handleAuthError(err)) setSaveState('Not saved', true); }
    }
  });

  app.addEventListener('click', async (e) => {
    const t = e.target.closest('button, a');
    if (!t) return;

    if (t.dataset.tile) {
      const path = t.dataset.tile;
      const v = t.dataset.v;
      const cur = getPath(path);
      if (Array.isArray(cur)) {
        let next = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
        // "None" style answers cannot be combined with other choices.
        const exclusive = ['None that we know of', 'None', 'Prefer to discuss privately'];
        if (exclusive.includes(v) && next.includes(v)) next = [v];
        else if (!exclusive.includes(v)) next = next.filter((x) => !exclusive.includes(x));
        setPath(path, next);
        t.parentElement.querySelectorAll('[data-tile]').forEach((b) => b.setAttribute('aria-pressed', String(next.includes(b.dataset.v))));
      } else {
        const next = cur === v ? '' : v;
        setPath(path, next);
        t.parentElement.querySelectorAll('[data-tile]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.v === next)));
      }
      updateConditionals();
      return;
    }

    if (t.dataset.count) {
      const box = app.querySelector('[data-count-other]');
      if (t.dataset.count === '4+') { box.hidden = false; const inp = box.querySelector('input'); inp.focus(); setChildCount(Math.max(4, Number(inp.value) || 4)); }
      else { box.hidden = true; setChildCount(Number(t.dataset.count)); }
      return;
    }

    if (t.dataset.removeKid) {
      const kid = state.me.children.find((c) => c.id === t.dataset.removeKid);
      if (!confirm(`Remove ${childName(kid)}'s profile? Any answers entered for this child will be permanently deleted.`)) return;
      try { await A.del(`/api/family/children/${kid.id}`); if (state.child && state.child.id === kid.id) state.child = null; await loadMe(); renderChildren(); }
      catch (err) { if (!handleAuthError(err)) app.querySelector('[data-step-error]').textContent = err.message; }
      return;
    }

    if (t.dataset.switchChild) {
      const key = location.hash.split('/')[3] || 'basic';
      if (!(await flush())) { setSaveState('Not saved', true); }
      state.child = null;
      go(`#/child/${t.dataset.switchChild}/${key}`);
      return;
    }

    if (t.dataset.stepGo) {
      const key = location.hash.split('/')[3];
      if (t.dataset.next !== undefined && key) {
        if (key === 'basic' && !state.child.answers.basic.full_name.trim()) {
          const f = app.querySelector('[data-k="basic.full_name"]');
          f.setAttribute('aria-invalid', 'true'); f.focus();
          app.querySelector('[data-step-error]').textContent = "Please add your child's name to continue.";
          return;
        }
        const visited = state.child.answers._visited;
        if (!visited.includes(key)) { visited.push(key); scheduleSave('child'); }
      }
      if (!(await flush()) && state.lastError && state.lastError.data && state.lastError.data.code === 'storage_not_ready') {
        app.querySelector('[data-step-error]').textContent = state.lastError.message;
        return;
      }
      go(t.dataset.stepGo);
      return;
    }

    switch (t.dataset.action) {
      case 'add-child':
      case 'add-child-inline':
        try {
          const r = await A.post('/api/family/children', {});
          await loadMe();
          if (t.dataset.action === 'add-child-inline') renderChildren();
          else go(`#/child/${r.id}/basic`);
        } catch (err) {
          const box = app.querySelector('[data-dash-error], [data-step-error]');
          if (!handleAuthError(err) && box) box.textContent = err.message;
        }
        break;
      case 'children-next': {
        const target = state.me.children.find((c) => c.completion_status !== 'submitted') || state.me.children[0];
        go(`#/child/${target.id}/${firstOpenStep(target)}`);
        break;
      }
      case 'submit-child':
        t.disabled = true;
        await submitChild();
        t.disabled = false;
        break;
      case 'submit-all':
        t.disabled = true;
        await submitAll(app.querySelector('[data-dash-error], [data-step-error]'));
        t.disabled = false;
        break;
      default:
    }
  });

  app.addEventListener('submit', async (e) => {
    const form = e.target;
    e.preventDefault();
    if (!form.matches('[data-feedback-form]')) return;
    const box = form.querySelector('[data-form-error]');
    box.className = 'notice';
    if (!A.checkRequired(form)) { box.textContent = 'Please write a message first.'; return; }
    try {
      await A.post('/api/family/feedback', { message: form.elements.message.value });
      form.reset();
      box.className = 'notice success';
      box.textContent = 'Thank you — your note has been sent privately to AHUVAI.';
    } catch (err) { if (!handleAuthError(err)) { box.className = 'notice error'; box.textContent = err.message; } }
  });

  document.querySelector('[data-logout]').addEventListener('click', async () => {
    await flush();
    try { await A.post('/api/family/logout'); } finally { location.href = '/portal'; }
  });

  // Photo panels fall back to the illustration if an image fails to load.
  app.addEventListener('error', (e) => {
    if (e.target.matches && e.target.matches('img[data-photo]')) {
      const panel = e.target.closest('.q-panel');
      e.target.outerHTML = FALLBACK;
      panel.classList.add('no-photo');
    }
  }, true);

  window.addEventListener('hashchange', route);
  route();
})();
