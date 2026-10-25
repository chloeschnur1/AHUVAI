'use strict';
// Reading and writing child profiles. Answers are encrypted before storage and
// validated against the shared questionnaire schema.
const schema = require('../public/js/questionnaire-schema');
const { encryptJSON, decryptJSON } = require('./security');

const PROFILE_COLUMNS = `c.id, c.family_id, c.position, c.full_name, c.preferred_name,
  to_char(c.date_of_birth, 'YYYY-MM-DD') AS dob, c.created_at,
  p.answers_enc, p.submitted_answers_enc, p.completion, p.percent_complete, p.completion_status,
  p.review_status, p.health_consent_at, p.first_submitted_at, p.submitted_at, p.updated_at`;

async function listChildren(client, familyId) {
  const r = await client.query(
    `SELECT ${PROFILE_COLUMNS} FROM children c JOIN child_profiles p ON p.child_id = c.id
      WHERE c.family_id = $1 ORDER BY c.position, c.created_at`, [familyId]);
  return r.rows;
}

async function getChild(client, childId) {
  const r = await client.query(
    `SELECT ${PROFILE_COLUMNS} FROM children c JOIN child_profiles p ON p.child_id = c.id WHERE c.id = $1`, [childId]);
  return r.rows[0] || null;
}

function displayName(row) {
  return row.preferred_name || (row.full_name || '').split(' ')[0] || `Child ${row.position + 1}`;
}

function missingSections(row) {
  const comp = row.completion || {};
  return schema.SECTIONS.filter((s) => !comp[s.key]).map((s) => s.key);
}

// Summary safe to show in lists (no questionnaire content).
function summary(row) {
  return {
    id: row.id,
    position: row.position,
    name: displayName(row),
    full_name: row.full_name,
    preferred_name: row.preferred_name,
    dob: row.dob,
    age_label: schema.ageLabel(row.dob),
    completion_status: row.completion_status,
    percent: row.percent_complete,
    completion: row.completion,
    missing: missingSections(row),
    review_status: row.review_status,
    first_submitted_at: row.first_submitted_at,
    submitted_at: row.submitted_at,
    updated_at: row.updated_at,
  };
}

function statusFor(answers, comp, submittedAnswers) {
  if (submittedAnswers) {
    return JSON.stringify(schema.sanitizeAnswers(submittedAnswers)) === JSON.stringify(answers)
      ? 'submitted' : 'editing_after_submit';
  }
  if (comp.complete) return 'complete';
  if (comp.started) return 'in_progress';
  return 'not_started';
}

async function createChild(client, familyId, preferredName) {
  const pos = await client.query('SELECT coalesce(max(position) + 1, 0) AS n, count(*)::int AS total FROM children WHERE family_id = $1', [familyId]);
  if (pos.rows[0].total >= 12) {
    const e = new Error('A family may have up to 12 child profiles. Please contact AHUVAI for more.'); e.status = 400; e.expose = true; throw e;
  }
  const answers = schema.emptyAnswers();
  if (preferredName) answers.basic.preferred_name = preferredName;
  const child = await client.query(
    `INSERT INTO children (family_id, position, preferred_name) VALUES ($1, $2, $3) RETURNING id`,
    [familyId, pos.rows[0].n, answers.basic.preferred_name]);
  const id = child.rows[0].id;
  const comp = schema.completion(answers, null);
  await client.query(
    `INSERT INTO child_profiles (child_id, family_id, answers_enc, completion, percent_complete, completion_status)
     VALUES ($1, $2, $3, $4, 0, 'not_started')`,
    [id, familyId, encryptJSON(answers), comp.sections]);
  return id;
}

async function saveAnswers(client, row, rawAnswers, familyTravel) {
  const answers = schema.sanitizeAnswers(rawAnswers);
  const comp = schema.completion(answers, familyTravel);
  const submitted = row.submitted_answers_enc ? decryptJSON(row.submitted_answers_enc) : null;
  const status = statusFor(answers, comp, submitted);
  await client.query(
    `UPDATE children SET full_name = $2, preferred_name = $3, date_of_birth = $4, updated_at = now() WHERE id = $1`,
    [row.id, answers.basic.full_name, answers.basic.preferred_name, answers.basic.dob || null]);
  await client.query(
    `UPDATE child_profiles SET answers_enc = $2, completion = $3, percent_complete = $4, completion_status = $5,
       health_consent_at = CASE WHEN $6 THEN coalesce(health_consent_at, now()) ELSE NULL END,
       updated_at = now()
     WHERE child_id = $1`,
    [row.id, encryptJSON(answers), comp.sections, comp.percent, status, answers.health.consent]);
  return { answers, comp, status };
}

// Recomputes completion after shared family travel details change.
async function recomputeFamily(client, familyId, familyTravel) {
  for (const row of await listChildren(client, familyId)) {
    const answers = schema.sanitizeAnswers(decryptJSON(row.answers_enc));
    const comp = schema.completion(answers, familyTravel);
    await client.query(
      `UPDATE child_profiles SET completion = $2, percent_complete = $3,
         completion_status = CASE WHEN completion_status IN ('submitted','editing_after_submit') THEN completion_status
                                  WHEN $4 THEN 'complete' WHEN $5 THEN 'in_progress' ELSE 'not_started' END
       WHERE child_id = $1`,
      [row.id, comp.sections, comp.percent, comp.complete, comp.started]);
  }
}

module.exports = { listChildren, getChild, summary, displayName, createChild, saveAnswers, recomputeFamily, missingSections };
