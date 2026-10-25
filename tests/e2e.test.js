'use strict';
// End-to-end scenario and access-control tests against a real PostgreSQL database.
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, startServer, client } = require('./helpers');
const demo = require('../scripts/demo-data');
const schema = require('../public/js/questionnaire-schema');

let server, base, admin, cohen, levi;
const ids = {};

const inquiry = {
  parent_name: 'Sarah Cohen', email: 'sarah.cohen@example.test', preferred_contact: 'WhatsApp', phone: '+1 555 0101',
  destination: 'Paris, France', travel_start: '2026-12-12', travel_end: '2026-12-22', num_children: 3,
  children_ages: '5, 3 and 1', nanny_type: 'Traveling nanny', care_duration: 'Ten days', preferences: 'Calm, warm caregiver',
  cultural_considerations: 'Shabbat observant', consent: true,
};

test.before(async () => {
  ({ server, base } = await startServer());
  admin = client(base);
  cohen = client(base);
  levi = client(base);
});
test.after(async () => { server.close(); await db.pool.end(); });

test('public pages render and the secure storage self-check passes', async () => {
  for (const p of ['/', '/our-story', '/services', '/approach', '/begin', '/contact', '/privacy', '/portal', '/admin']) {
    const r = await fetch(base + p);
    assert.equal(r.status, 200, p);
    assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
  }
  const s = await client(base).get('/api/status');
  assert.equal(s.body.secureStorageReady, true);
});

test('inquiry form validates and saves; the public cannot read inquiries back', async () => {
  const pub = client(base);
  assert.equal((await pub.post('/api/inquiries', { ...inquiry, consent: false })).status, 400);
  assert.equal((await pub.post('/api/inquiries', { ...inquiry, email: 'not-an-email' })).status, 400);
  assert.equal((await pub.post('/api/inquiries', { ...inquiry, travel_end: '2026-12-01' })).status, 400);
  const noCsrf = await pub.post('/api/inquiries', inquiry, { 'X-Requested-With': '' });
  assert.equal(noCsrf.status, 403, 'requests without the same-site header are blocked');
  const ok = await pub.post('/api/inquiries', inquiry);
  assert.equal(ok.status, 201);
  assert.equal((await pub.get('/api/admin/inquiries')).status, 401);
});

test('administrator setup works exactly once and requires the setup code', async () => {
  assert.equal((await admin.get('/api/admin/setup-status')).body.needsSetup, true);
  const creds = { name: 'AHUVAI Owner', email: 'owner@example.test', password: 'a-long-owner-password' };
  assert.equal((await admin.post('/api/admin/setup', { ...creds, token: 'wrong' })).status, 403);
  assert.equal((await admin.post('/api/admin/setup', { ...creds, token: 'test-setup-token' })).status, 201);
  assert.equal((await client(base).post('/api/admin/setup', { ...creds, email: 'x@example.test', token: 'test-setup-token' })).status, 403);
  assert.equal((await client(base).post('/api/admin/login', { email: creds.email, password: 'wrong-password' })).status, 401);
  const me = await admin.get('/api/admin/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.me.email, 'owner@example.test');
});

test('admin reviews the inquiry and invites the family (email not configured -> secure link)', async () => {
  const list = await admin.get('/api/admin/inquiries?status=new');
  assert.equal(list.body.inquiries.length, 1);
  ids.inquiry = list.body.inquiries[0].id;
  assert.equal((await admin.patch(`/api/admin/inquiries/${ids.inquiry}`, { status: 'reviewed' })).status, 200);
  assert.equal((await admin.patch(`/api/admin/inquiries/${ids.inquiry}`, { status: 'contacted' })).status, 200);
  const inv = await admin.post(`/api/admin/inquiries/${ids.inquiry}/invite`);
  assert.equal(inv.status, 200);
  assert.equal(inv.body.emailSent, false, 'email is honestly reported as not sent');
  assert.match(inv.body.inviteUrl, /\/portal\/invite\?token=/);
  ids.cohenFamily = inv.body.familyId;
  ids.cohenToken = new URL(inv.body.inviteUrl).searchParams.get('token');
  const fam = await admin.get(`/api/admin/families/${ids.cohenFamily}`);
  assert.equal(fam.body.family.family_name, 'The Cohen Family');
  assert.equal(fam.body.family.travel.destination, 'Paris, France');
});

test('parent accepts the invitation and creates an account', async () => {
  const info = await cohen.get(`/api/family/invitation?token=${ids.cohenToken}`);
  assert.equal(info.status, 200);
  assert.equal(info.body.email, 'sarah.cohen@example.test');
  assert.equal((await cohen.post('/api/family/invitation/accept', { token: ids.cohenToken, name: 'Sarah Cohen', password: 'short', consent: true })).status, 400);
  assert.equal((await cohen.post('/api/family/invitation/accept', { token: ids.cohenToken, name: 'Sarah Cohen', password: 'a-good-family-password', consent: false })).status, 400);
  const ok = await cohen.post('/api/family/invitation/accept', { token: ids.cohenToken, name: 'Sarah Cohen', password: 'a-good-family-password', consent: true });
  assert.equal(ok.status, 201);
  assert.equal((await client(base).post('/api/family/invitation/accept', { token: ids.cohenToken, name: 'X', password: 'another-password-1', consent: true })).status, 400, 'invitation links work once');
  const me = await cohen.get('/api/family/me');
  assert.equal(me.body.family.status, 'onboarding');
  assert.deepEqual(me.body.children, []);
});

test('parent creates three separate child profiles and completes each one', async () => {
  assert.equal((await cohen.post('/api/family/children/ensure-count', { count: 3 })).status, 200);
  let me = await cohen.get('/api/family/me');
  assert.equal(me.body.children.length, 3);
  [ids.david, ids.leah, ids.benjamin] = me.body.children.map((c) => c.id);

  // Partially complete David first, then check that an incomplete profile cannot be submitted.
  const partial = await cohen.put(`/api/family/children/${ids.david}`, { answers: { basic: demo.samples.davidAnswers.basic } });
  assert.equal(partial.body.child.completion_status, 'in_progress');
  const early = await cohen.post(`/api/family/children/${ids.david}/submit`);
  assert.equal(early.status, 400);
  assert.ok(early.body.incomplete[0].missing.includes('temperament'));

  // Travel is saved once for the family.
  const travel = await cohen.put('/api/family/travel', { travel: { destination: 'Paris, France', start_date: '2026-12-12', end_date: '2026-12-22', modes: ['Plane', 'Not a real option'] } });
  assert.deepEqual(travel.body.travel.modes, ['Plane'], 'unknown options are discarded');

  const answers = { [ids.david]: demo.samples.davidAnswers, [ids.leah]: demo.samples.leahAnswers, [ids.benjamin]: demo.samples.benjaminAnswers };
  for (const [id, a] of Object.entries(answers)) {
    const r = await cohen.put(`/api/family/children/${id}`, { answers: a });
    assert.equal(r.status, 200);
    assert.equal(r.body.completion.percent, 100, `child ${a.basic.preferred_name} complete`);
    assert.equal(r.body.child.completion_status, 'complete');
  }
  // Switching between children keeps each child's answers separate.
  const david = await cohen.get(`/api/family/children/${ids.david}`);
  const leah = await cohen.get(`/api/family/children/${ids.leah}`);
  assert.equal(david.body.answers.routines.wake, '06:45');
  assert.equal(leah.body.answers.routines.wake, '07:15');
  assert.deepEqual(leah.body.answers.interests.picks, ['Books', 'Music', 'Pretend play']);
  assert.equal(david.body.child.age_label, `Age ${schema.ageFromDob('2021-03-14')}`);
  me = await cohen.get('/api/family/me');
  assert.ok(me.body.children.every((c) => c.percent === 100));
});

test('answers are encrypted in the database', async () => {
  const raw = await db.pool.query('SELECT answers_enc FROM child_profiles');
  assert.equal(raw.rowCount, 0, 'the database owner connection sees nothing either: row-level security is forced');
  const viaSystem = await db.withContext({ role: 'system' }, (c) => c.query('SELECT answers_enc FROM child_profiles WHERE child_id = $1', [ids.david]));
  const stored = viaSystem.rows[0].answers_enc;
  assert.match(stored, /^v1:/);
  assert.ok(!stored.includes('cashew') && !stored.includes('David'));
});

test('parent submits all profiles; success is reported only after saving', async () => {
  const r = await cohen.post('/api/family/submit-all');
  assert.equal(r.status, 200);
  assert.equal(r.body.submitted.length, 3);
  const again = await cohen.post('/api/family/submit-all');
  assert.equal(again.status, 200);
  assert.equal(again.body.submitted.length, 0, 'nothing is re-submitted');
  const me = await cohen.get('/api/family/me');
  assert.ok(me.body.children.every((c) => c.completion_status === 'submitted' && c.submitted_at));
  assert.equal(me.body.family.status, 'profiles_submitted');
});

test('admin sees the family and reviews each of the three children individually', async () => {
  const list = await admin.get('/api/admin/families?destination=paris');
  const row = list.body.families.find((f) => f.id === ids.cohenFamily);
  assert.ok(row);
  assert.equal(row.children, 3);
  assert.equal(row.submitted, 3);
  assert.equal(row.status, 'profiles_submitted');
  assert.equal((await admin.get('/api/admin/families?destination=tokyo')).body.families.length, 0, 'destination filter');
  assert.equal((await admin.get('/api/admin/families?from=2027-01-01')).body.families.length, 0, 'date filter');
  assert.equal((await admin.get('/api/admin/families?q=cohen')).body.families.length, 1, 'search');

  const record = await admin.get(`/api/admin/families/${ids.cohenFamily}`);
  assert.deepEqual(record.body.children.map((c) => c.name), ['David', 'Leah', 'Benji']);

  const david = await admin.get(`/api/admin/children/${ids.david}`);
  const leah = await admin.get(`/api/admin/children/${ids.leah}`);
  const benji = await admin.get(`/api/admin/children/${ids.benjamin}`);
  assert.equal(david.body.answers.health.allergy_details.includes('Tree nuts'), true);
  assert.deepEqual(leah.body.answers.temperament.traits, ['Sensitive', 'Needs reassurance', 'Loves routines']);
  assert.equal(benji.body.answers.routines.toileting, 'Diapers');
  assert.equal(benji.body.answers.travel.arrangement, 'Meets the nanny at the destination');
  assert.equal(david.body.siblings.length, 3);
  assert.equal(david.body.family.travel.destination, 'Paris, France');
  assert.ok(david.body.child.submitted_at && david.body.child.updated_at);

  const overview = await admin.get('/api/admin/overview');
  assert.equal(overview.body.stats.completed_profiles, 3);
  assert.equal(overview.body.recent.length, 3);
  const care = await admin.get('/api/admin/care-preferences');
  assert.equal(care.body.children.length, 3);
});

test('admin review tools: statuses, private notes, request for information', async () => {
  assert.equal((await admin.patch(`/api/admin/children/${ids.david}/review`, { review_status: 'ready_for_review' })).status, 200);
  assert.equal((await admin.patch(`/api/admin/families/${ids.cohenFamily}`, { status: 'ready_for_review' })).status, 200);
  assert.equal((await admin.patch(`/api/admin/families/${ids.cohenFamily}`, { status: 'not-a-status' })).status, 400);
  const note = await admin.post('/api/admin/notes', { family_id: ids.cohenFamily, child_id: ids.leah, body: 'PRIVATE-NOTE: pair with a calm caregiver' });
  assert.equal(note.status, 201);
  const req = await admin.post(`/api/admin/families/${ids.cohenFamily}/request-info`, { child_ids: [ids.leah], message: 'Could you tell us more about bedtime?' });
  assert.equal(req.status, 200);
  assert.equal(req.body.emailSent, false);

  // Families never see administrator notes or internal review statuses.
  const me = await cohen.get('/api/family/me');
  const leah = await cohen.get(`/api/family/children/${ids.leah}`);
  const david = await cohen.get(`/api/family/children/${ids.david}`);
  for (const r of [me, leah, david]) assert.ok(!r.text.includes('PRIVATE-NOTE'));
  assert.ok(!david.text.includes('ready_for_review'));
  assert.equal(leah.body.child.review_status, 'more_info_needed', 'parents are told more information is needed');
});

test('editing after submission: admin keeps seeing the submitted version until resubmitted', async () => {
  const cur = (await cohen.get(`/api/family/children/${ids.leah}`)).body.answers;
  cur.routines.bedtime = '19:30';
  const saved = await cohen.put(`/api/family/children/${ids.leah}`, { answers: cur });
  assert.equal(saved.body.child.completion_status, 'editing_after_submit');
  let view = await admin.get(`/api/admin/children/${ids.leah}`);
  assert.equal(view.body.answers.routines.bedtime, '19:00');
  assert.equal(view.body.parentEditing, true);
  assert.equal((await cohen.post(`/api/family/children/${ids.leah}/submit`)).status, 200);
  view = await admin.get(`/api/admin/children/${ids.leah}`);
  assert.equal(view.body.answers.routines.bedtime, '19:30');
  assert.equal(view.body.parentEditing, false);
});

test('another family cannot see or change the Cohen records', async () => {
  const created = await admin.post('/api/admin/families', { primary_guardian: 'Miriam Levi', primary_email: 'miriam@example.test' });
  assert.equal(created.status, 201);
  ids.leviFamily = created.body.familyId;
  const token = new URL(created.body.inviteUrl).searchParams.get('token');
  assert.equal((await levi.post('/api/family/invitation/accept', { token, name: 'Miriam Levi', password: 'levi-family-password', consent: true })).status, 201);
  await levi.post('/api/family/children', { preferred_name: 'Noam' });

  const me = await levi.get('/api/family/me');
  assert.equal(me.body.children.length, 1);
  assert.ok(!me.text.includes('Cohen'));
  for (const id of [ids.david, ids.leah, ids.benjamin]) {
    assert.equal((await levi.get(`/api/family/children/${id}`)).status, 404);
    assert.equal((await levi.put(`/api/family/children/${id}`, { answers: { basic: { full_name: 'Hacked' } } })).status, 404);
    assert.equal((await levi.post(`/api/family/children/${id}/submit`)).status, 404);
    assert.equal((await levi.del(`/api/family/children/${id}`)).status, 404);
  }
  const david = await admin.get(`/api/admin/children/${ids.david}`);
  assert.equal(david.body.answers.basic.full_name, 'David Cohen');
});

test('family and administrator sessions are kept separate', async () => {
  // A family's cookie, even renamed to the admin cookie name, is not an admin session.
  const famCookie = cohen.jar.get('ahuvai_family');
  const forged = client(base);
  forged.jar.set('ahuvai_admin', famCookie);
  assert.equal((await forged.get('/api/admin/families')).status, 401);
  assert.equal((await cohen.get('/api/admin/families')).status, 401);
  assert.equal((await cohen.get(`/api/admin/children/${ids.david}`)).status, 401);
  const adminOnly = client(base);
  adminOnly.jar.set('ahuvai_family', admin.jar.get('ahuvai_admin'));
  assert.equal((await adminOnly.get('/api/family/me')).status, 401);
  assert.equal((await client(base).get('/api/family/me')).status, 401);
});

test('database row-level security blocks cross-family access even if application code were bypassed', async () => {
  const leviCtx = { role: 'family', familyId: ids.leviFamily };
  const rows = await db.withContext(leviCtx, (c) => c.query('SELECT id FROM children WHERE family_id = $1', [ids.cohenFamily]));
  assert.equal(rows.rowCount, 0);
  const all = await db.withContext(leviCtx, (c) => c.query('SELECT family_id FROM child_profiles'));
  assert.ok(all.rows.every((r) => r.family_id === ids.leviFamily));
  const notes = await db.withContext({ role: 'family', familyId: ids.cohenFamily }, (c) => c.query('SELECT * FROM admin_notes'));
  assert.equal(notes.rowCount, 0, 'families can never read admin notes');
  const upd = await db.withContext(leviCtx, (c) => c.query(`UPDATE child_profiles SET review_status = 'pending' WHERE family_id = $1`, [ids.cohenFamily]));
  assert.equal(upd.rowCount, 0);
  await assert.rejects(db.withContext({ role: 'family', familyId: ids.cohenFamily },
    (c) => c.query(`UPDATE child_profiles SET review_status = 'reviewed' WHERE child_id = $1`, [ids.david])), /review status/);
  await assert.rejects(db.withContext({ role: 'family', familyId: ids.cohenFamily },
    (c) => c.query(`UPDATE families SET status = 'active' WHERE id = $1`, [ids.cohenFamily])), /may not set status/);
  await assert.rejects(db.withContext({ role: 'admin' },
    (c) => c.query(`UPDATE child_profiles SET answers_enc = 'x' WHERE child_id = $1`, [ids.david])), /may not modify parent answers/);
  const anon = await db.withContext({ role: 'public' }, (c) => c.query('SELECT * FROM inquiries'));
  assert.equal(anon.rowCount, 0);
  assert.deepEqual(await db.verifyRowLevelSecurity(), []);
});

test('family can remove an unsubmitted child but not a submitted one', async () => {
  const me = await levi.get('/api/family/me');
  const noam = me.body.children[0].id;
  assert.equal((await cohen.del(`/api/family/children/${ids.benjamin}`)).status, 400);
  assert.equal((await levi.del(`/api/family/children/${noam}`)).status, 200);
});

test('private feedback reaches the admin; export and permanent deletion work', async () => {
  assert.equal((await cohen.post('/api/family/feedback', { message: 'Thank you for the lovely process.' })).status, 201);
  const msgs = await admin.get('/api/admin/messages');
  assert.ok(msgs.body.messages.some((m) => m.source === 'family_feedback' && m.family_name === 'The Cohen Family'));

  const exp = await admin.get(`/api/admin/families/${ids.cohenFamily}/export`);
  assert.equal(exp.status, 200);
  assert.match(exp.headers.get('content-disposition'), /attachment/);
  assert.equal(exp.body.children.length, 3);
  assert.ok(!exp.text.includes('PRIVATE-NOTE'), 'export holds family data, not internal notes');

  assert.equal((await admin.del(`/api/admin/families/${ids.cohenFamily}`, { confirm: 'wrong' })).status, 400);
  assert.equal((await admin.del(`/api/admin/families/${ids.cohenFamily}`, { confirm: 'The Cohen Family' })).status, 200);
  assert.equal((await admin.get(`/api/admin/families/${ids.cohenFamily}`)).status, 404);
  const left = await db.withContext({ role: 'system' }, (c) => c.query('SELECT count(*)::int n FROM children WHERE family_id = $1', [ids.cohenFamily]));
  assert.equal(left.rows[0].n, 0);
  assert.equal((await cohen.get('/api/family/me')).status, 401, 'deleted family is signed out');
});

test('logging out ends the session on the server', async () => {
  const cookie = levi.jar.get('ahuvai_family');
  await levi.post('/api/family/logout');
  const replay = client(base);
  replay.jar.set('ahuvai_family', cookie);
  assert.equal((await replay.get('/api/family/me')).status, 401);
});

test('admin can create a password reset link for a family', async () => {
  const r = await admin.post(`/api/admin/families/${ids.leviFamily}/reset-link`);
  assert.equal(r.status, 200);
  const token = new URL(r.body.inviteUrl).searchParams.get('token');
  const pub = client(base);
  assert.equal((await pub.post('/api/family/password-reset/complete', { token, password: 'brand-new-password-9' })).status, 200);
  assert.equal((await pub.post('/api/family/password-reset/complete', { token, password: 'another-password-99' })).status, 400, 'reset links work once');
  assert.equal((await pub.post('/api/family/login', { email: 'miriam@example.test', password: 'brand-new-password-9' })).status, 200);
});
