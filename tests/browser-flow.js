'use strict';
// Drives the real website in a browser: inquiry -> admin invite -> parent completes
// three children through the 13-step questionnaire -> admin reviews each child.
// Usage: npm run test:browser   (screenshots are written to SCREENSHOT_DIR or ./screenshots)
const path = require('path');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { db, startServer } = require('./helpers');

const OUT = process.env.SCREENSHOT_DIR || path.join(__dirname, '..', 'screenshots');
fs.mkdirSync(OUT, { recursive: true });

const CHILDREN = [
  { first: 'David', full: 'David Cohen', dob: '2021-03-14', lang: 'Hebrew', traits: ['Outgoing', 'Curious'], interests: ['Sports', 'Building and LEGO'],
    wake: '06:45', bed: '19:30', allergy: 'Tree nuts — carries an EpiPen', comfort: ['Hugs', 'Talking'], sensory: ['Loud noises'],
    traditions: ['Shabbat observance'], arrangement: 'Travels with the nanny', notes: 'Prefers calm redirection.' },
  { first: 'Leah', full: 'Leah Cohen', dob: '2023-01-09', lang: 'English', traits: ['Sensitive', 'Loves routines'], interests: ['Books', 'Music'],
    wake: '07:15', bed: '19:00', allergy: null, comfort: ['Favorite toy', 'Quiet time'], sensory: ['Certain textures'],
    traditions: ['Kosher food requirements'], arrangement: 'Travels with the nanny', notes: 'Needs her bunny to sleep.' },
  { first: 'Benjamin', full: 'Benjamin Cohen', dob: '2025-02-02', lang: 'English', traits: ['Calm'], interests: ['Water activities'],
    wake: '06:30', bed: '18:30', allergy: 'Dairy intolerance', comfort: ['Music'], sensory: ['None that we know of'],
    traditions: ['Shabbat observance'], arrangement: 'Meets the nanny at the destination', notes: 'Two naps a day.' },
];

(async () => {
  const { server, base } = await startServer();
  const browser = await chromium.launch();
  const errors = [];
  const newPage = async (ctx) => {
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('console', (m) => { if (m.type() === 'error' && !/favicon|404|401/.test(m.text())) errors.push(m.text()); });
    return p;
  };
  const shot = async (p, name, full) => { await p.waitForTimeout(700); return p.screenshot({ path: path.join(OUT, name + '.png'), fullPage: !!full }); };
  const step = (msg) => console.log('  ✓ ' + msg);

  try {
    // ---------------------------------------------------------------- 1. family signs up
    const parentCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const par = await newPage(parentCtx);
    await par.goto(base + '/');
    await shot(par, '01-home');
    await par.click('.hero-actions >> text=Begin Your Family Experience');
    await par.waitForURL('**/begin');
    await par.fill('[name=name]', 'Sarah Cohen');
    await par.fill('[name=email]', 'sarah.cohen@example.test');
    await par.fill('[name=phone]', '+1 555 0101');
    await par.fill('[name=password]', 'family-password-123');
    await par.click('button[type=submit]');
    assert.match(await par.textContent('[data-form-error]'), /highlighted/, 'consent is required');
    await par.check('[name=consent]', { force: true });
    await shot(par, '02-create-account');
    await par.click('button[type=submit]');
    await par.waitForURL('**/portal/family#/start');
    step('family created their own account from the website');

    // ---------------------------------------------------------------- 2. steps 1–2
    await par.waitForSelector('text=Getting to Know Your Most Cherished Ones.');
    await shot(par, '06-step01-welcome');
    await par.click('text=Begin Profile');
    await par.click('[data-count="3"]');
    await par.waitForSelector('.kid-row >> nth=2');
    const nameInputs = par.locator('[data-kid-name]');
    for (let i = 0; i < 3; i++) {
      await nameInputs.nth(i).fill(CHILDREN[i].first);
      await nameInputs.nth(i).press('Tab');
      await par.waitForFunction((n) => document.querySelectorAll('[data-kid-name]')[n]?.value !== undefined, i);
      await par.waitForTimeout(500);
    }
    await par.waitForTimeout(500);
    await shot(par, '07-step02-children');
    step('three separate child profiles created');

    // ---------------------------------------------------------------- 5. questionnaire
    const next = async (key) => {
      await par.click('[data-next]');
      await par.waitForSelector(`[data-step-form="${key}"], .submit-zone`);
    };
    const tile = (path, v) => par.click(`[data-tile="${path}"][data-v="${v}"]`);

    async function completeChild(c, idx) {
      await par.waitForSelector('[data-step-form="basic"]');
      await par.fill('[data-k="basic.full_name"]', c.full);
      await par.fill('[data-k="basic.dob"]', c.dob);
      await tile('basic.languages', c.lang);
      if (idx === 0) await shot(par, '08-step03-basic');
      await next('temperament');
      for (const t of c.traits) await tile('temperament.traits', t);
      await par.fill('[data-k="temperament.notes"]', `${c.first} is wonderful.`);
      if (idx === 0) await shot(par, '09-step04-temperament');
      await next('interests');
      for (const t of c.interests) await tile('interests.picks', t);
      if (idx === 0) await shot(par, '10-step05-interests', true);
      await next('routines');
      await par.fill('[data-k="routines.wake"]', c.wake);
      await par.fill('[data-k="routines.bedtime"]', c.bed);
      await next('health');
      await tile('health.has_allergies', c.allergy ? 'Yes' : 'No');
      if (c.allergy) await par.fill('[data-k="health.allergy_details"]', c.allergy);
      await tile('health.diet', 'Kosher');
      await par.check('[data-k-bool="health.consent"]', { force: true });
      if (idx === 0) await shot(par, '11-step07-health', true);
      await next('comfort');
      for (const t of c.comfort) await tile('comfort.picks', t);
      await next('sensory');
      for (const t of c.sensory) await tile('sensory.picks', t);
      await next('traditions');
      for (const t of c.traditions) await tile('traditions.picks', t);
      if (idx === 0) await shot(par, '12-step10-traditions');
      await next('travel');
      if (idx === 0) {
        await par.fill('[data-k="family.destination"]', 'Paris, France');
        await par.fill('[data-k="family.start_date"]', '2026-12-12');
        await par.fill('[data-k="family.end_date"]', '2026-12-22');
        await tile('family.modes', 'Plane');
      } else {
        assert.equal(await par.inputValue('[data-k="family.destination"]'), 'Paris, France', 'family travel shared across children');
      }
      await tile('travel.arrangement', c.arrangement);
      if (idx === 0) await shot(par, '13-step11-travel', true);
      await next('additional');
      await par.fill('[data-k="additional.notes"]', c.notes);
      await next('review');
      if (idx === 0) await shot(par, '14-step13-review', true);
      const counter = await par.textContent('[data-step-count]');
      assert.match(counter, /13\s*\/\s*13/);
      assert.equal(await par.locator('.flag:has-text("Needs attention")').count(), 0, `${c.first}: all sections complete`);
    }

    // David: begin, switch to Leah mid-way, then return — answers must persist.
    await par.click('[data-action="children-next"]');
    await par.waitForSelector('[data-step-form="basic"]');
    await par.fill('[data-k="basic.full_name"]', 'David Cohen');
    await par.click('[data-switch-child] >> text=Leah');
    await par.waitForSelector('[data-chip-pct]');
    await par.waitForFunction(() => document.querySelector('[aria-current="true"]')?.textContent.includes('Leah'));
    assert.equal(await par.inputValue('[data-k="basic.full_name"]'), '', "Leah's profile is separate");
    await par.click('[data-switch-child] >> text=David');
    await par.waitForFunction(() => document.querySelector('[aria-current="true"]')?.textContent.includes('David'));
    assert.equal(await par.inputValue('[data-k="basic.full_name"]'), 'David Cohen', 'answers kept when switching children');
    step('switching between children keeps each child’s answers');

    await completeChild(CHILDREN[0], 0);
    await par.click('[data-action="submit-child"]');
    await par.waitForSelector('.thanks');
    await shot(par, '15-thank-you');
    step('David completed all 13 steps and was submitted individually');

    // Leah from the thank-you page; Benjamin from the My Family dashboard.
    await par.click('.thanks a:has-text("Continue with Leah")');
    await completeChild(CHILDREN[1], 1);
    await par.click('text=Save & return to My Family');
    await par.waitForSelector('.child-card');
    await par.click('.child-card:has-text("Benjamin") a:has-text("Begin Profile")');
    await completeChild(CHILDREN[2], 2);
    await par.click('text=Save & return to My Family');
    await par.waitForSelector('.child-card');
    await shot(par, '16-my-family-ready', true);
    await par.click('[data-action="submit-all"]');
    await par.waitForSelector('.thanks');
    assert.equal(await par.locator('.thanks-list li').count(), 2, 'Leah and Benjamin submitted together');
    await par.click('text=Return to My Family');
    await par.waitForSelector('.child-card');
    assert.equal(await par.locator('.status-pill.submitted').count(), 3);
    await shot(par, '17-my-family-submitted', true);
    step('remaining profiles submitted together; all three show Submitted');

    // ---------------------------------------------------------------- 6. admin review
    const adminCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const adm = await newPage(adminCtx);
    await adm.goto(base + '/admin');
    await adm.fill('[name=token]', 'test-setup-token');
    await adm.fill('[name=name]', 'Owner Demo');
    await adm.fill('[name=email]', 'owner@example.test');
    await adm.fill('[name=password]', 'owner-password-123');
    await adm.click('button[type=submit]');
    await adm.waitForSelector('.stats');
    assert.equal(await adm.textContent('[data-count="review"]'), '1', 'sidebar shows one family awaiting review');
    await shot(adm, '03-admin-overview');
    await adm.click('[data-nav=review]');
    await adm.waitForSelector('tr:has-text("The Cohen Family")');
    await shot(adm, '04-admin-awaiting-review');
    await adm.click('[data-nav=families]');
    await adm.waitForSelector('tr[data-href]');
    await shot(adm, '18-admin-families');
    await adm.click('tr[data-href] >> text=The Cohen Family');
    await adm.waitForSelector('.kid-card');
    assert.equal(await adm.locator('.kid-card').count(), 3);
    await shot(adm, '19-admin-family-record', true);
    for (const c of CHILDREN) {
      await adm.click(`.kid-card:has-text("${c.first}"), .child-tabs a:has-text("${c.first}")`);
      await adm.waitForSelector(`.family-hero h1:has-text("${c.full}")`);
      const body = await adm.textContent('#view');
      assert.ok(body.includes(c.notes), `${c.first}: parent notes visible`);
      assert.ok(body.includes(c.interests[0]), `${c.first}: interests visible`);
      if (c.allergy) assert.ok(body.includes(c.allergy), `${c.first}: allergy visible`);
      await shot(adm, `20-admin-child-${c.first.toLowerCase()}`, true);
    }
    await adm.click('[data-review="ready_for_review"]');
    await adm.waitForSelector('.toast');
    await adm.fill('[data-add-note] textarea', 'Lovely family — match with a calm caregiver.');
    await adm.click('[data-add-note] button');
    await adm.waitForSelector('.note-item');
    await adm.click('[data-nav=care]');
    await adm.waitForSelector('table.data');
    await shot(adm, '21-admin-care-preferences', true);
    step('admin opened the family and reviewed all three children individually');

    // ---------------------------------------------------------------- 7. mobile views
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    const mob = await newPage(phone);
    await mob.goto(base + '/');
    await shot(mob, '22-mobile-home');
    await phone.addCookies(await parentCtx.cookies());
    await mob.goto(base + '/portal/family#/');
    await mob.waitForSelector('.child-card');
    await mob.click('.child-card >> nth=0 >> a:has-text("Edit Profile")');
    await mob.waitForSelector('[data-step-form="basic"]');
    await shot(mob, '23-mobile-questionnaire', true);
    const overflow = await mob.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    assert.equal(overflow, false, 'no horizontal scrolling on phones');
    step('mobile layouts render without horizontal scrolling');

    assert.deepEqual(errors, [], 'no browser errors');
    console.log(`\nBrowser flow passed. Screenshots: ${OUT}`);
  } catch (err) {
    console.error('\nBrowser flow FAILED:', err.message);
    if (errors.length) console.error('Browser errors:', errors);
    process.exitCode = 1;
  } finally {
    await browser.close();
    server.close();
    await db.pool.end();
  }
})();
