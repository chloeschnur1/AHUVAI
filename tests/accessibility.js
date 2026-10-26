'use strict';
// Runs the axe-core accessibility checker on every main screen.
// Usage: npm run test:a11y  (fails on "serious" or "critical" issues)
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { db, startServer } = require('./helpers');
const { seed } = require('../scripts/seed-demo');

(async () => {
  const { server, base } = await startServer();
  await seed();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ bypassCSP: true, viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const problems = [];

  async function audit(label) {
    await page.waitForTimeout(800);
    await page.addScriptTag({ path: require.resolve('axe-core') });
    const r = await page.evaluate(() => window.axe.run(document, { resultTypes: ['violations'] }));
    const bad = r.violations.filter((v) => ['serious', 'critical'].includes(v.impact));
    for (const v of r.violations) {
      console.log(`  ${bad.includes(v) ? '✗' : '·'} ${label}: [${v.impact}] ${v.id} — ${v.help} (${v.nodes.length}) ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`);
    }
    if (!r.violations.length) console.log(`  ✓ ${label}`);
    problems.push(...bad.map((v) => `${label}: ${v.id}`));
  }

  try {
    for (const p of ['/', '/our-story', '/services', '/approach', '/begin', '/contact', '/privacy', '/portal', '/portal/invite?token=x']) {
      await page.goto(base + p);
      await page.evaluate(() => document.querySelectorAll('.reveal').forEach((e) => e.classList.add('in')));
      await audit(p);
    }
    await page.goto(base + '/portal');
    await page.fill('[name=email]', 'sarah.cohen.demo@example.com');
    await page.fill('[name=password]', 'demo-password-cohen');
    await page.click('[data-login-form] button');
    await page.waitForSelector('.child-card');
    await audit('My Family');
    const childId = await page.getAttribute('.child-card a', 'href');
    const id = childId.split('/')[2];
    for (const step of ['basic', 'temperament', 'interests', 'routines', 'health', 'comfort', 'sensory', 'traditions', 'travel', 'additional', 'review']) {
      await page.goto(`${base}/portal/family#/child/${id}/${step}`);
      await page.waitForSelector(step === 'review' ? '.submit-zone' : `[data-step-form="${step}"]`);
      await audit(`questionnaire ${step}`);
    }
    await page.goto(`${base}/portal/family#/start`); await page.waitForSelector('.q-content'); await audit('questionnaire welcome');
    await page.goto(`${base}/portal/family#/children`); await page.waitForSelector('.kid-row'); await audit('questionnaire children');

    await page.goto(base + '/admin');
    await page.waitForSelector('[data-setup]');
    await audit('admin setup');
    await page.fill('[name=token]', 'test-setup-token');
    await page.fill('[name=name]', 'Owner');
    await page.fill('[name=email]', 'owner@example.test');
    await page.fill('[name=password]', 'owner-password-123');
    await page.click('button[type=submit]');
    await page.waitForSelector('.stats');
    await audit('admin overview');
    for (const [hash, sel] of [['#/review', '.page-title'], ['#/families', 'tr[data-href]'], ['#/children', 'tr[data-href]'],
      ['#/submissions', 'tr[data-href]'], ['#/care', 'tr[data-href]'], ['#/messages', '[data-msg-read]'], ['#/settings', '[data-add-admin]']]) {
      await page.goto(base + '/admin' + hash); await page.waitForSelector(sel); await audit('admin ' + hash);
    }
    await page.goto(base + '/admin#/families'); await page.click('tr:has-text("Cohen")'); await page.waitForSelector('.kid-card'); await audit('admin family record');
    await page.click('.kid-card >> nth=0'); await page.waitForSelector('.profile-section'); await audit('admin child profile');

    assert.deepEqual(problems, [], 'serious accessibility problems found');
    console.log('\nAccessibility check passed (no serious or critical issues).');
  } catch (err) {
    console.error('\nAccessibility check FAILED:', err.message);
    process.exitCode = 1;
  } finally {
    await browser.close(); server.close(); await db.pool.end();
  }
})();
