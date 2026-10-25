'use strict';
// Creates fictional demonstration families, children, inquiries and messages.
// Usage: npm run seed:demo
const db = require('../server/db');
const profiles = require('../server/profiles');
const { hashPassword } = require('../server/security');
const schema = require('../public/js/questionnaire-schema');
const demo = require('./demo-data');

async function seed() {
  await db.migrate();
  await db.withContext({ role: 'system' }, async (c) => {
    const existing = await c.query('SELECT count(*)::int AS n FROM families WHERE is_demo');
    if (existing.rows[0].n > 0) { console.log('Demonstration data already exists — nothing to do.'); return; }
    for (const f of demo.families) {
      const travel = schema.sanitizeFamilyTravel(f.travel);
      const fam = await c.query(`INSERT INTO families (family_name, primary_guardian, primary_email, preferred_contact, travel, status, privacy_consent_at, is_demo)
        VALUES ($1,$2,$3,$4,$5,'onboarding', now(), true) RETURNING id`, [f.family_name, f.primary_guardian, f.primary_email, f.preferred_contact, travel]);
      const familyId = fam.rows[0].id;
      await c.query('INSERT INTO family_users (family_id, email, name, password_hash) VALUES ($1,$2,$3,$4)',
        [familyId, f.primary_email, f.primary_guardian, hashPassword(f.login_password)]);
      for (const answers of f.children) {
        const id = await profiles.createChild(c, familyId, '');
        const row = await profiles.getChild(c, id);
        await profiles.saveAnswers(c, row, answers, travel);
        if (f.submit) {
          await c.query(`UPDATE child_profiles SET submitted_answers_enc = answers_enc, submitted_at = now(), first_submitted_at = now(),
            completion_status = 'submitted' WHERE child_id = $1 AND percent_complete = 100`, [id]);
        }
      }
      await c.query('UPDATE families SET status = $2, submitted_at = CASE WHEN $3 THEN now() END WHERE id = $1', [familyId, f.status, f.submit]);
      console.log(`Created ${f.family_name} — portal sign in: ${f.primary_email} / ${f.login_password}`);
    }
    for (const i of demo.inquiries) {
      await c.query(`INSERT INTO inquiries (parent_name, email, phone, preferred_contact, destination, travel_start, travel_end, num_children,
          children_ages, nanny_type, care_duration, preferences, cultural_considerations, consent_at, is_demo)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, now(), true)`,
        [i.parent_name, i.email, i.phone || null, i.preferred_contact, i.destination, i.travel_start, i.travel_end, i.num_children,
          i.children_ages, i.nanny_type, i.care_duration, i.preferences, i.cultural_considerations || null]);
    }
    for (const m of demo.messages) {
      await c.query(`INSERT INTO messages (source, name, email, subject, body, is_demo) VALUES ('contact_form',$1,$2,$3,$4,true)`, [m.name, m.email, m.subject, m.body]);
    }
    console.log(`Created ${demo.inquiries.length} demo inquiries and ${demo.messages.length} demo message.`);
  });
}

seed().then(() => db.pool.end()).catch((err) => { console.error(err.message); process.exit(1); });
