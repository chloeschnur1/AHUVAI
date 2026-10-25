'use strict';
// Second browser pass: every administrator tool and the remaining portal paths,
// run against the fictional demonstration data.
// Usage: npm run test:browser:admin
const path = require('path');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { db, startServer } = require('./helpers');
const { seed } = require('../scripts/seed-demo');
const { totpAt } = require('../server/security');

const OUT = process.env.SCREENSHOT_DIR || path.join(__dirname, '..', 'screenshots');
fs.mkdirSync(OUT, { recursive: true });

function totpFromPage(secret) {
  // Uses the next code if the current one is about to roll over.
  const now = Date.now();
  const counter = Math.floor(now / 30000) + ((now % 30000) > 27000 ? 1 : 0);
  return totpAt(secret, counter);
}

(async () => {
  const { server, base } = await startServer();
  await seed();
  const browser = await chromium.launch();
  const errors = [];
  const watch = (p) => {
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('console', (m) => { if (m.type() === 'error' && !/favicon|404|401|400|403/.test(m.text())) errors.push(m.text()); });
    p.on('dialog', (d) => d.accept());
    return p;
  };
  const shot = async (p, name, full) => { await p.waitForTimeout(700); await p.screenshot({ path: path.join(OUT, name + '.png'), fullPage: !!full }); };
  const step = (m) => console.log('  ✓ ' + m);
  const toast = async (p, re) => {
    const t = await p.waitForSelector('.toast');
    const text = await t.textContent();
    if (re) assert.match(text, re);
    await p.waitForSelector('.toast', { state: 'detached' });
    return text;
  };

  try {
    // ---------------------------------------------------------------- public extras
    const pubCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const pub = watch(await pubCtx.newPage());
    await pub.goto(base + '/');
    await pub.click('[data-menu-toggle]');
    await pub.waitForSelector('#mobile-menu:not([hidden])');
    await shot(pub, '30-mobile-menu');
    await pub.click('#mobile-menu >> text=Contact');
    await pub.waitForURL('**/contact');
    await pub.fill('[name=name]', 'Ruth Adler');
    await pub.fill('[name=email]', 'ruth@example.test');
    await pub.fill('[name=message]', 'Do you arrange care in Tokyo?');
    await pub.click('button[type=submit]');
    await pub.waitForSelector('[data-form-thanks]:not([hidden])');
    await pub.goto(base + '/portal/invite?token=not-a-real-token');
    await pub.waitForFunction(() => /no longer valid/.test(document.querySelector('[data-invite-intro]').textContent));
    await pub.goto(base + '/portal');
    await pub.fill('[name=email]', 'sarah.cohen.demo@example.com');
    await pub.fill('[name=password]', 'wrong-password-1');
    await pub.click('[data-login-form] button');
    await pub.waitForFunction(() => /not recognised/.test(document.querySelector('[data-login-form] [data-form-error]').textContent));
    await pub.goto(base + '/portal/family');
    await pub.waitForURL('**/portal');
    step('mobile menu, contact form, invalid invitation, wrong password, signed-out redirect');

    // ---------------------------------------------------------------- admin setup + 2FA
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    const adm = watch(await ctx.newPage());
    await adm.goto(base + '/admin');
    await adm.fill('[name=token]', 'test-setup-token');
    await adm.fill('[name=name]', 'Owner Demo');
    await adm.fill('[name=email]', 'owner@example.test');
    await adm.fill('[name=password]', 'owner-password-123');
    await adm.click('button[type=submit]');
    await adm.waitForSelector('.stats');
    assert.equal(await adm.textContent('[data-count="inquiries"]'), '2', 'sidebar shows new inquiry count');
    assert.equal(await adm.textContent('[data-count="messages"]'), '2', 'sidebar shows unread messages');

    await adm.click('[data-nav=settings]');
    await adm.click('[data-totp-setup]');
    const secret = (await adm.textContent('[data-totp-area] code')).trim();
    await shot(adm, '31-admin-2fa-setup');
    await adm.fill('[data-totp-enable] [name=code]', '000000');
    await adm.click('[data-totp-enable] button');
    await toast(adm, /did not match/);
    await adm.fill('[data-totp-enable] [name=code]', totpFromPage(secret));
    await adm.click('[data-totp-enable] button');
    await toast(adm, /Two-step verification is on/);
    await adm.click('[data-logout]');
    await adm.waitForSelector('[data-login]');
    await adm.fill('[name=email]', 'owner@example.test');
    await adm.fill('[name=password]', 'owner-password-123');
    await adm.click('[data-login] button');
    await adm.waitForSelector('[data-code]:not([hidden])');
    await adm.fill('[name=code]', totpFromPage(secret));
    await adm.click('[data-login] button');
    await adm.waitForSelector('.stats');
    step('two-step verification set up and required at sign in');

    // ---------------------------------------------------------------- settings
    await adm.click('[data-nav=settings]');
    await adm.waitForSelector('[data-add-admin]');
    await adm.fill('[data-add-admin] [name=name]', 'Assistant Demo');
    await adm.fill('[data-add-admin] [name=email]', 'assistant@example.test');
    await adm.fill('[data-add-admin] [name=password]', 'assistant-password-1');
    await adm.click('[data-add-admin] button');
    await toast(adm, /Administrator added/);
    assert.ok((await adm.textContent('#view')).includes('assistant@example.test'));
    await adm.click('tr:has-text("assistant@example.test") [data-remove-admin]');
    await adm.waitForFunction(() => !document.querySelector('#view').textContent.includes('assistant@example.test'));
    await adm.fill('[data-change-password] [name=current]', 'owner-password-123');
    await adm.fill('[data-change-password] [name=next]', 'owner-password-456');
    await adm.click('[data-change-password] button');
    await toast(adm, /Password changed/);
    await adm.click('[data-load-audit]');
    await adm.waitForSelector('[data-audit] table');
    assert.ok((await adm.textContent('[data-audit]')).includes('admin 2fa enabled'));
    await shot(adm, '32-admin-settings', true);
    step('add/remove administrator, change password, activity log');

    // ---------------------------------------------------------------- inquiries
    await adm.click('[data-nav=inquiries]');
    await adm.waitForSelector('tr[data-href]');
    assert.equal(await adm.locator('tr[data-href]').count(), 2);
    await adm.click('tr:has-text("Rachel Klein")');
    await adm.waitForSelector('.family-hero h1:has-text("Rachel Klein")');
    assert.ok((await adm.textContent('#view')).includes('Shabbat and Yom Tov observant'));
    await adm.click('[data-inq-status=contacted]');
    await toast(adm, /Contacted/);
    await adm.fill('[data-add-note] textarea', 'Spoke by phone — lovely family.');
    await adm.click('[data-add-note] button');
    await adm.waitForSelector('.note-item');
    await adm.click('[data-inq-status=declined]');
    await toast(adm);
    await adm.click('.crumb');
    await adm.click('[data-inq-filter="declined"]');
    await adm.waitForSelector('tr:has-text("Rachel Klein")');
    await adm.click('[data-inq-filter=""]');
    await adm.waitForFunction(() => document.querySelectorAll('tr[data-href]').length === 2);
    step('inquiry review, contacted/declined statuses, filters, private note');

    // ---------------------------------------------------------------- families
    await adm.click('[data-nav=families]');
    await adm.waitForSelector('tr[data-href]');
    await adm.fill('[data-fam-filter] [name=destination]', 'como');
    await adm.click('[data-fam-filter] button[type=submit]');
    await adm.waitForFunction(() => document.querySelectorAll('tr[data-href]').length === 1);
    assert.ok((await adm.textContent('tbody')).includes('Levi'));
    await adm.fill('[data-fam-filter] [name=from]', '2026-12-01');
    await adm.fill('[data-fam-filter] [name=to]', '2026-12-31');
    await adm.fill('[data-fam-filter] [name=destination]', '');
    await adm.click('[data-fam-filter] button[type=submit]');
    await adm.waitForFunction(() => document.querySelectorAll('tr[data-href]').length === 1 && document.querySelector('tbody').textContent.includes('Cohen'));
    await adm.click('[data-clear-filter]');
    await adm.waitForFunction(() => document.querySelectorAll('tr[data-href]').length === 2);

    await adm.click('[data-toggle="add-family"]');
    await adm.fill('[data-add-family] [name=primary_guardian]', 'Hannah Stern');
    await adm.fill('[data-add-family] [name=primary_email]', 'hannah@example.test');
    await adm.click('[data-add-family] button');
    await adm.waitForSelector('.family-hero h1:has-text("The Stern Family")');
    const inviteLink = await (await adm.waitForSelector('[data-invite-result] code')).textContent();
    assert.match(inviteLink, /\/portal\/invite\?token=/);
    step('destination and date filters, manually added family with invitation link');

    await adm.click('[data-nav=families]');
    await adm.click('tr:has-text("The Cohen Family")');
    await adm.waitForSelector('.kid-card');
    await adm.selectOption('[data-family-status]', 'active');
    await toast(adm, /Active/);
    await adm.click('[data-toggle="request-info"]');
    await adm.check('[data-request-info] input[name=child] >> nth=1', { force: true });
    await adm.fill('[data-request-info] [name=message]', 'Could you share more about bedtime routines?');
    await adm.click('[data-request-info] button[type=submit]');
    await toast(adm, /Please contact the family directly/);
    assert.equal(await adm.inputValue('[data-family-status]'), 'more_info_needed');
    await adm.click('[data-reset-link]');
    await adm.waitForSelector('[data-invite-result] code');
    const resetLink = await adm.textContent('[data-invite-result] code');
    const [download] = await Promise.all([adm.waitForEvent('download'), adm.click('text=Export Record')]);
    const exported = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
    assert.equal(exported.children.length, 3);
    await shot(adm, '33-admin-family-tools', true);
    step('family status, request more information, reset link, export download');

    await adm.click('.kid-card:has-text("David")');
    await adm.waitForSelector('[data-review]');
    await adm.click('[data-review="reviewed"]');
    await toast(adm, /Reviewed/);
    await adm.click('.child-tabs a:has-text("Benji")');
    await adm.waitForSelector('.family-hero h1:has-text("Benjamin Cohen")');
    await adm.fill('[data-add-note] textarea', 'Temporary note');
    await adm.click('[data-add-note] button');
    await adm.waitForSelector('.note-item');
    await adm.click('.note-item [data-delete-note]');
    await adm.waitForSelector('.note-item', { state: 'detached' });

    await adm.click('[data-nav=children]');
    await adm.waitForSelector('tr[data-href]');
    assert.ok((await adm.textContent('tbody')).includes('Noam'));
    assert.ok((await adm.textContent('tr:has-text("Noam")')).includes('Food, Allergies & Health'), 'incomplete sections listed');
    await adm.click('tr:has-text("Noam")');
    await adm.waitForSelector('text=Not yet submitted');
    assert.ok(!(await adm.textContent('#view')).includes('Art and crafts'), 'unsubmitted drafts are not shown to the admin');
    await shot(adm, '34-admin-child-not-submitted');
    await adm.click('[data-nav=submissions]');
    await adm.waitForFunction(() => document.querySelectorAll('tr[data-href]').length === 3);
    await adm.click('[data-nav=care]');
    await adm.waitForSelector('tr:has-text("Tree nuts")');
    step('child review status, sibling tabs, notes delete, child lists, unsubmitted privacy, care preferences');

    // ---------------------------------------------------------------- messages
    await adm.click('[data-nav=messages]');
    await adm.waitForSelector('[data-msg-read]');
    assert.equal(await adm.locator('[data-msg-read]').count(), 2);
    await adm.click('[data-msg-read] >> nth=0');
    await adm.waitForFunction(() => document.querySelectorAll('.pill.new').length === 1);
    await adm.click('section:has-text("Ruth Adler") [data-msg-delete]');
    await adm.waitForFunction(() => document.querySelectorAll('[data-msg-read]').length === 1);
    step('messages: mark read, delete');

    // ---------------------------------------------------------------- family portal paths
    const famCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const fam = watch(await famCtx.newPage());
    await fam.goto(resetLink.replace('http://localhost', base));
    await fam.fill('[name=password]', 'cohen-new-password-1');
    await fam.click('button[type=submit]');
    await fam.waitForSelector('[data-reset-done]:not([hidden])');
    await fam.goto(base + '/portal');
    await fam.fill('[name=email]', 'sarah.cohen.demo@example.com');
    await fam.fill('[name=password]', 'cohen-new-password-1');
    await fam.click('[data-login-form] button');
    await fam.waitForSelector('.child-card');
    assert.ok((await fam.textContent('.child-card:has-text("Leah")')).includes('asked for a little more information'));
    assert.ok(!(await fam.textContent('body')).includes('bedtime routines?'), 'the admin message is emailed, not shown with notes');
    await fam.fill('[data-feedback-form] textarea', 'Thank you for checking in!');
    await fam.click('[data-feedback-form] button');
    await fam.waitForSelector('[data-feedback-form] .notice.success');
    step('reset link sets a new password; family sees the request; private note sent');

    // Step 2: choose "4+", which adds profiles; then remove the extra one.
    await fam.goto(base + '/portal/family#/children');
    await fam.waitForSelector('.kid-row');
    await fam.click('[data-count="4+"]');
    await fam.waitForFunction(() => document.querySelectorAll('.kid-row').length === 4);
    assert.equal(await fam.locator('.kid-row .remove[disabled]').count(), 3, 'submitted children cannot be removed');
    await fam.click('.kid-row >> nth=3 >> .remove');
    await fam.waitForFunction(() => document.querySelectorAll('.kid-row').length === 3);
    step('“4+” children option and removing an unsubmitted child');

    // Edit a submitted profile and resubmit from the review step.
    await fam.goto(base + '/portal/family#/');
    await fam.click('.child-card:has-text("Leah") a:has-text("Edit Profile")');
    await fam.waitForSelector('[data-step-form="basic"]');
    await fam.goto(fam.url().replace('/basic', '/routines'));
    await fam.waitForSelector('[data-step-form="routines"]');
    await fam.fill('[data-k="routines.notes"]', 'Bedtime: two songs, then lights out at 7:30.');
    await fam.click('[data-step-go$="/health"]');
    await fam.waitForSelector('[data-step-form="health"]');
    await fam.goto(fam.url().replace('/health', '/review'));
    await fam.waitForSelector('.notice.warning');
    await fam.click('[data-action="submit-child"]');
    await fam.waitForSelector('.thanks');
    await fam.click('[data-logout]');
    await fam.waitForURL('**/portal');
    step('editing a submitted profile and resubmitting');

    await adm.click('[data-nav=families]');
    await adm.click('tr:has-text("The Cohen Family")');
    await adm.click('.kid-card:has-text("Leah")');
    await adm.waitForSelector('text=two songs');
    step('admin sees the resubmitted answer');

    // ---------------------------------------------------------------- deletion & demo removal
    await adm.click('[data-nav=families]');
    await adm.click('tr:has-text("The Stern Family")');
    await adm.click('[data-toggle="delete-family"]');
    await adm.fill('[data-delete-family] [name=confirm]', 'wrong');
    await adm.click('[data-delete-family] button');
    await toast(adm, /exactly/);
    await adm.fill('[data-delete-family] [name=confirm]', 'The Stern Family');
    await adm.click('[data-delete-family] button');
    await toast(adm, /permanently deleted/);
    await adm.waitForURL('**#/families');
    await adm.waitForFunction(() => !document.querySelector('#view').textContent.includes('Stern'));
    await adm.click('[data-nav=settings]');
    await adm.click('[data-remove-demo]');
    await toast(adm, /Removed 2 families/);
    await adm.click('[data-nav=overview]');
    await adm.waitForSelector('.stats');
    assert.equal(await adm.textContent('.stat >> nth=3 >> .n'), '0', 'no child profiles remain after removing demo data');
    await shot(adm, '35-admin-after-demo-removal');
    step('permanent family deletion with confirmation, one-click demo data removal');

    assert.deepEqual(errors, [], 'no browser errors');
    console.log(`\nAdmin browser pass succeeded. Screenshots: ${OUT}`);
  } catch (err) {
    console.error('\nAdmin browser pass FAILED:', err.message);
    if (errors.length) console.error('Browser errors:', errors);
    process.exitCode = 1;
  } finally {
    await browser.close();
    server.close();
    await db.pool.end();
  }
})();
