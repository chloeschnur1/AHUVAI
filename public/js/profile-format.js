/* Formats a child's answers for reading — shared by the parent review step and the admin profile view. */
(function () {
  'use strict';
  const A = window.Ahuvai;
  const S = window.AhuvaiSchema;
  const esc = A.esc;
  function badges(list) { return list && list.length ? `<div class="badges">${list.map((x) => `<span class="badge">${esc(x)}</span>`).join('')}</div>` : '—'; }
  function row(label, value) { return value && (typeof value !== 'string' || value.trim()) ? `<dt>${esc(label)}</dt><dd>${value}</dd>` : ''; }
  const txt = (s) => (s ? esc(s) : '');
  const time = (t) => (t ? new Date(`1970-01-01T${t}:00`).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '');

  function sections(a, travel) {
    return {
      basic: row('Full name', txt(a.basic.full_name)) + row('Preferred name', txt(a.basic.preferred_name)) +
        row('Date of birth', a.basic.dob ? `${esc(A.fmtDate(a.basic.dob))} · ${esc(S.ageLabel(a.basic.dob))}` : '') +
        row('Gender', txt(a.basic.gender)) + row('Languages', a.basic.languages.length ? badges(a.basic.languages) : '') + row('Other languages', txt(a.basic.other_languages)),
      temperament: row('Qualities', a.temperament.traits.length ? badges(a.temperament.traits) : '') + row('Other', txt(a.temperament.other)) + row('In your words', txt(a.temperament.notes)),
      interests: row('Loves', a.interests.picks.length ? badges(a.interests.picks) : '') + row('Other', txt(a.interests.other)) + row('Favorites', txt(a.interests.favorites)),
      routines: row('Wake-up', time(a.routines.wake)) + row('Bedtime', time(a.routines.bedtime)) + row('Naps', txt(a.routines.naps)) +
        row('Meals & snacks', txt(a.routines.meals)) + row('Bath', txt(a.routines.bath)) + row('Toileting', txt(a.routines.toileting)) +
        row('Diaper / potty notes', txt(a.routines.toileting_notes)) + row('Daily habits', txt(a.routines.habits)) + row('Routine notes', txt(a.routines.notes)),
      health: row('Food allergies', txt(a.health.has_allergies)) + row('Allergy details', txt(a.health.allergy_details)) +
        row('Dietary preferences', a.health.diet.length ? badges(a.health.diet) : '') + row('Other diet', txt(a.health.diet_other)) +
        row('Medical conditions', txt(a.health.medical_conditions)) + row('Medications / care', txt(a.health.medications)) +
        row('Emergency considerations', txt(a.health.emergency)) + row('Parental consent', a.health.consent ? 'Given' : '<span class="flag">Needed</span>'),
      comfort: row('Helps when upset', a.comfort.picks.length ? badges(a.comfort.picks) : '') + row('Calming techniques', txt(a.comfort.techniques)),
      sensory: row('Sensitivities', a.sensory.picks.length ? badges(a.sensory.picks) : '') + row('Other', txt(a.sensory.other)) + row('Details', txt(a.sensory.details)),
      traditions: row('Practices', a.traditions.picks.length ? badges(a.traditions.picks) : '') + row('Other', txt(a.traditions.other)) + row('Details', txt(a.traditions.details)),
      travel: row('Destination', txt(travel.destination)) + row('Dates', esc(A.fmtRange(travel.start_date, travel.end_date))) +
        row('Travel by', travel.modes && travel.modes.length ? badges(travel.modes) : '') + row('Arrangement', txt(a.travel.arrangement)) +
        row('Motion sickness', txt(a.travel.motion_sickness)) + row('Sensitivities', txt(a.travel.sensitivities)) +
        row('Familiar routines', txt(a.travel.routines)) + row('Other needs', txt(a.travel.other_needs)) + row('Security / transport', txt(travel.security)),
      additional: row('Notes', txt(a.additional.notes)),
    };
  }


  window.AhuvaiFormat = { sections, badges };
})();
