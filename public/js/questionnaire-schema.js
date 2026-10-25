/*
 * AHUVAI child profile questionnaire — single source of truth.
 * Loaded by the browser (window.AhuvaiSchema) and by the server (require),
 * so options, validation and completion rules can never drift apart.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AhuvaiSchema = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const OPTIONS = {
    languages: ['English', 'Hebrew', 'Spanish', 'French', 'Yiddish', 'Other'],
    gender: ['Girl', 'Boy', 'Prefer not to say'],
    temperament: ['Outgoing', 'Quiet', 'Curious', 'Sensitive', 'Independent', 'Needs reassurance',
      'Loves routines', 'Flexible', 'Calm', 'High energy', 'Thoughtful', 'Strong-willed', 'Social',
      'Prefers one-on-one attention', 'Other'],
    interests: ['Art and crafts', 'Music', 'Books', 'Sports', 'Nature and outdoors', 'Animals',
      'Building and LEGO', 'Cooking and baking', 'Water activities', 'Pretend play', 'Technology', 'Other'],
    toileting: ['Diapers', 'Potty training', 'Toilet trained, may need help', 'Fully independent', 'Not applicable'],
    yesNo: ['Yes', 'No'],
    yesNoUnsure: ['Yes', 'No', 'Not sure'],
    diet: ['Kosher', 'Vegetarian', 'Vegan', 'No pork', 'No shellfish', 'Other'],
    comfort: ['Hugs', 'Quiet time', 'Music', 'Favorite toy', 'Deep breathing', 'Going outside',
      'Talking', 'Distraction with a new activity'],
    sensory: ['Loud noises', 'Bright lights', 'Crowded places', 'Certain textures', 'Strong smells',
      'Food textures', 'Water, showers, or swimming pools', 'Transitions between activities',
      'None that we know of', 'Other'],
    traditions: ['Shabbat observance', 'Kosher food requirements', 'Jewish holiday routines',
      'Modesty or tzniut preferences', 'Prayer times', 'Hebrew language use',
      'Other cultural or religious practices', 'None', 'Prefer to discuss privately'],
    arrangement: ['Travels with the nanny', 'Meets the nanny at the destination', 'Not yet decided'],
    travelModes: ['Plane', 'Car', 'Boat', 'Train', 'Other'],
  };

  // Field definitions per section: type 'text' (max length), 'list' (subset of options),
  // 'choice' (one of options), 'date', 'time', 'bool'.
  const FIELDS = {
    basic: {
      full_name: { type: 'text', max: 120 }, preferred_name: { type: 'text', max: 60 },
      dob: { type: 'date' }, gender: { type: 'choice', options: OPTIONS.gender },
      languages: { type: 'list', options: OPTIONS.languages }, other_languages: { type: 'text', max: 200 },
    },
    temperament: {
      traits: { type: 'list', options: OPTIONS.temperament }, other: { type: 'text', max: 200 },
      notes: { type: 'text', max: 4000 },
    },
    interests: {
      picks: { type: 'list', options: OPTIONS.interests }, other: { type: 'text', max: 200 },
      favorites: { type: 'text', max: 2000 },
    },
    routines: {
      wake: { type: 'time' }, naps: { type: 'text', max: 300 }, bedtime: { type: 'time' },
      meals: { type: 'text', max: 1000 }, bath: { type: 'text', max: 500 },
      toileting: { type: 'choice', options: OPTIONS.toileting }, toileting_notes: { type: 'text', max: 500 },
      habits: { type: 'text', max: 1000 }, notes: { type: 'text', max: 4000 },
    },
    health: {
      has_allergies: { type: 'choice', options: OPTIONS.yesNo }, allergy_details: { type: 'text', max: 2000 },
      diet: { type: 'list', options: OPTIONS.diet }, diet_other: { type: 'text', max: 300 },
      medical_conditions: { type: 'text', max: 2000 }, medications: { type: 'text', max: 2000 },
      emergency: { type: 'text', max: 2000 }, consent: { type: 'bool' },
    },
    comfort: {
      picks: { type: 'list', options: OPTIONS.comfort }, techniques: { type: 'text', max: 3000 },
    },
    sensory: {
      picks: { type: 'list', options: OPTIONS.sensory }, other: { type: 'text', max: 200 },
      details: { type: 'text', max: 3000 },
    },
    traditions: {
      picks: { type: 'list', options: OPTIONS.traditions }, other: { type: 'text', max: 300 },
      details: { type: 'text', max: 3000 },
    },
    travel: {
      arrangement: { type: 'choice', options: OPTIONS.arrangement },
      motion_sickness: { type: 'choice', options: OPTIONS.yesNoUnsure },
      sensitivities: { type: 'text', max: 2000 }, routines: { type: 'text', max: 2000 },
      other_needs: { type: 'text', max: 2000 },
    },
    additional: { notes: { type: 'text', max: 8000 } },
  };

  // Travel details saved once per family and shown in every child's profile.
  const FAMILY_TRAVEL_FIELDS = {
    destination: { type: 'text', max: 200 }, start_date: { type: 'date' }, end_date: { type: 'date' },
    modes: { type: 'list', options: OPTIONS.travelModes }, modes_other: { type: 'text', max: 200 },
    security: { type: 'text', max: 2000 },
  };

  const SECTIONS = [
    { key: 'basic', title: 'Basic Information', required: true },
    { key: 'temperament', title: 'Personality & Temperament', required: true },
    { key: 'interests', title: 'Interests & Activities', required: true },
    { key: 'routines', title: 'Daily Routine', required: true },
    { key: 'health', title: 'Food, Allergies & Health', required: true },
    { key: 'comfort', title: 'Comfort & Emotional Support', required: true },
    { key: 'sensory', title: 'Sensory Preferences', required: true },
    { key: 'traditions', title: 'Family Traditions', required: false },
    { key: 'travel', title: 'Travel Information', required: true },
    { key: 'additional', title: 'Additional Parent Notes', required: false },
  ];

  // The 13 numbered stages shown to parents.
  const STEPS = [
    { n: 1, key: 'welcome', title: 'Welcome' },
    { n: 2, key: 'children', title: 'Your Children' },
    { n: 3, key: 'basic', title: 'Basic Information' },
    { n: 4, key: 'temperament', title: 'Personality & Temperament' },
    { n: 5, key: 'interests', title: 'Interests & Activities' },
    { n: 6, key: 'routines', title: 'Routines & Daily Schedule' },
    { n: 7, key: 'health', title: 'Food, Allergies & Health' },
    { n: 8, key: 'comfort', title: 'Comfort & Emotional Support' },
    { n: 9, key: 'sensory', title: 'Sensory Preferences' },
    { n: 10, key: 'traditions', title: 'Family Traditions & Preferences' },
    { n: 11, key: 'travel', title: 'Travel-Specific Information' },
    { n: 12, key: 'additional', title: 'Additional Information' },
    { n: 13, key: 'review', title: 'Review & Submit' },
  ];

  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const TIME_RE = /^\d{2}:\d{2}$/;

  function cleanValue(def, v) {
    switch (def.type) {
      case 'text': return typeof v === 'string' ? v.slice(0, def.max).trim() : '';
      case 'list': return Array.isArray(v) ? [...new Set(v.filter((x) => def.options.includes(x)))] : [];
      case 'choice': return def.options.includes(v) ? v : '';
      case 'date': return typeof v === 'string' && DATE_RE.test(v) && !isNaN(Date.parse(v)) ? v : '';
      case 'time': return typeof v === 'string' && TIME_RE.test(v) ? v : '';
      case 'bool': return v === true;
      default: return '';
    }
  }

  function cleanGroup(fields, raw) {
    const out = {};
    const src = raw && typeof raw === 'object' ? raw : {};
    for (const [k, def] of Object.entries(fields)) out[k] = cleanValue(def, src[k]);
    return out;
  }

  function emptyAnswers() { return sanitizeAnswers({}); }

  // Keeps only known sections, fields and option values.
  function sanitizeAnswers(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const out = {};
    for (const [section, fields] of Object.entries(FIELDS)) out[section] = cleanGroup(fields, src[section]);
    const known = SECTIONS.map((s) => s.key);
    out._visited = Array.isArray(src._visited) ? [...new Set(src._visited.filter((k) => known.includes(k)))] : [];
    return out;
  }

  function sanitizeFamilyTravel(raw) { return cleanGroup(FAMILY_TRAVEL_FIELDS, raw); }

  function sectionComplete(key, a, familyTravel) {
    const visited = (a._visited || []).includes(key);
    switch (key) {
      case 'basic': return !!(a.basic.full_name && a.basic.dob && a.basic.languages.length);
      case 'temperament': return a.temperament.traits.length > 0;
      case 'interests': return a.interests.picks.length > 0;
      case 'routines': return !!(a.routines.wake && a.routines.bedtime);
      case 'health': {
        const h = a.health;
        if (!h.consent || !h.has_allergies) return false;
        return h.has_allergies === 'No' || !!h.allergy_details;
      }
      case 'comfort': return a.comfort.picks.length > 0 || !!a.comfort.techniques;
      case 'sensory': return a.sensory.picks.length > 0;
      case 'traditions': return visited || a.traditions.picks.length > 0;
      case 'travel': return !!(a.travel.arrangement && familyTravel && familyTravel.destination);
      case 'additional': return visited || !!a.additional.notes;
      default: return false;
    }
  }

  function completion(answers, familyTravel) {
    const a = sanitizeAnswers(answers);
    const sections = {};
    let done = 0;
    for (const s of SECTIONS) {
      sections[s.key] = sectionComplete(s.key, a, familyTravel);
      if (sections[s.key]) done++;
    }
    const missing = SECTIONS.filter((s) => !sections[s.key]).map((s) => s.key);
    return {
      sections,
      missing,
      percent: Math.round((done / SECTIONS.length) * 100),
      complete: missing.length === 0,
      started: done > 0 || a._visited.length > 0 || !!a.basic.full_name,
    };
  }

  function ageFromDob(dob, today) {
    if (!dob || !DATE_RE.test(dob)) return null;
    const d = new Date(dob + 'T00:00:00');
    const now = today || new Date();
    let age = now.getFullYear() - d.getFullYear();
    const m = now.getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
    return age >= 0 && age < 30 ? age : null;
  }

  function ageLabel(dob) {
    const age = ageFromDob(dob);
    if (age === null) return '';
    if (age === 0) {
      const d = new Date(dob + 'T00:00:00');
      const now = new Date();
      const months = (now.getFullYear() - d.getFullYear()) * 12 + now.getMonth() - d.getMonth() - (now.getDate() < d.getDate() ? 1 : 0);
      return months <= 1 ? 'Newborn' : months + ' months';
    }
    return 'Age ' + age;
  }

  return {
    OPTIONS, FIELDS, FAMILY_TRAVEL_FIELDS, SECTIONS, STEPS,
    sanitizeAnswers, sanitizeFamilyTravel, emptyAnswers, completion, ageFromDob, ageLabel,
  };
});
