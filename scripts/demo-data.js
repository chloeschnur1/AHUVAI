'use strict';
// Fictional demonstration data. Every record created here is marked is_demo and
// can be removed in one click from Settings → Demonstration data.

const davidAnswers = {
  basic: { full_name: 'David Cohen', preferred_name: 'David', dob: '2021-03-14', gender: 'Boy', languages: ['English', 'Hebrew'] },
  temperament: { traits: ['Outgoing', 'Curious', 'High energy'], notes: 'David makes friends everywhere and asks a hundred questions a day.' },
  interests: { picks: ['Sports', 'Building and LEGO', 'Animals'], favorites: 'Paw Patrol, dinosaurs, anything with trains.' },
  routines: { wake: '06:45', bedtime: '19:30', naps: 'No longer naps', meals: 'Breakfast 7:15, snack 10:00, lunch 12:30, snack 15:30, dinner 17:45',
    bath: 'Every evening at 18:45', toileting: 'Fully independent', habits: 'Two stories and a song before bed.', notes: 'Gets hungry quickly — keep snacks handy.' },
  health: { has_allergies: 'Yes', allergy_details: 'Tree nuts (cashew, pistachio). Carries an EpiPen; parents will brief the caregiver.', diet: ['Kosher'],
    medical_conditions: 'None', medications: 'EpiPen Jr — travels in the blue pouch.', emergency: 'Call parents immediately after any reaction.', consent: true },
  comfort: { picks: ['Hugs', 'Talking', 'Going outside'], techniques: 'Naming the feeling together and a short walk.' },
  sensory: { picks: ['Loud noises'], details: 'Covers ears at fireworks and hand dryers.' },
  traditions: { picks: ['Shabbat observance', 'Kosher food requirements'], details: 'We keep Shabbat from Friday sundown; no screens on Shabbat.' },
  travel: { arrangement: 'Travels with the nanny', motion_sickness: 'No', routines: 'Window seat and a sticker book on the plane.' },
  additional: { notes: 'We prefer calm redirection rather than time-outs. Daily photo update in the evening would be lovely.' },
  _visited: ['traditions', 'additional'],
};

const leahAnswers = {
  basic: { full_name: 'Leah Cohen', preferred_name: 'Leah', dob: '2023-01-09', gender: 'Girl', languages: ['English'] },
  temperament: { traits: ['Sensitive', 'Needs reassurance', 'Loves routines'], notes: 'Warms up slowly to new people; once comfortable she is very affectionate.' },
  interests: { picks: ['Books', 'Music', 'Pretend play'], favorites: 'Bluey, "Goodnight Moon", tea parties.' },
  routines: { wake: '07:15', bedtime: '19:00', naps: '13:00–14:30 daily', meals: 'Similar to her brother, smaller portions',
    bath: 'Every other evening', toileting: 'Potty training', toileting_notes: 'Pull-ups for nap and night.', habits: 'Needs her bunny "Shoshi" to sleep.' },
  health: { has_allergies: 'No', diet: ['Kosher'], consent: true },
  comfort: { picks: ['Favorite toy', 'Quiet time', 'Music'], techniques: 'Humming "Twinkle Twinkle" while holding Shoshi.' },
  sensory: { picks: ['Certain textures', 'Food textures', 'Transitions between activities'], details: 'Give a five-minute warning before changing activity.' },
  traditions: { picks: ['Shabbat observance', 'Kosher food requirements'] },
  travel: { arrangement: 'Travels with the nanny', motion_sickness: 'Yes', sensitivities: 'Ear pain on descent — offer a bottle or snack.' },
  additional: { notes: '' },
  _visited: ['traditions', 'additional'],
};

const benjaminAnswers = {
  basic: { full_name: 'Benjamin Cohen', preferred_name: 'Benji', dob: '2025-02-02', gender: 'Boy', languages: ['English', 'Hebrew'] },
  temperament: { traits: ['Calm', 'Social'] },
  interests: { picks: ['Music', 'Water activities'] },
  routines: { wake: '06:30', bedtime: '18:30', naps: '09:30–10:30 and 14:00–15:30', meals: 'Bottle on waking and before bed; three solid meals',
    toileting: 'Diapers', bath: 'Evenings, warm not hot' },
  health: { has_allergies: 'Yes', allergy_details: 'Dairy intolerance — oat-based formula only.', diet: ['Kosher'], consent: true },
  comfort: { picks: ['Hugs', 'Music'] },
  sensory: { picks: ['None that we know of'] },
  traditions: { picks: ['Shabbat observance'] },
  travel: { arrangement: 'Meets the nanny at the destination', motion_sickness: 'Not sure' },
  additional: { notes: 'Please follow his nap schedule closely — he becomes overtired quickly.' },
  _visited: ['traditions', 'additional'],
};

const noamAnswers = {
  basic: { full_name: 'Noam Levi', preferred_name: 'Noam', dob: '2020-06-21', languages: ['Hebrew', 'English'] },
  temperament: { traits: ['Quiet', 'Thoughtful'] },
  interests: { picks: ['Art and crafts', 'Nature and outdoors'] },
};

module.exports = {
  families: [
    {
      family_name: 'The Cohen Family', primary_guardian: 'Sarah Cohen', primary_email: 'sarah.cohen.demo@example.com',
      login_password: 'demo-password-cohen', status: 'profiles_submitted', preferred_contact: 'WhatsApp',
      travel: { destination: 'Paris, France', start_date: '2026-12-12', end_date: '2026-12-22', modes: ['Plane', 'Car'],
        security: 'Private car from the airport; please do not share the hotel name.' },
      children: [davidAnswers, leahAnswers, benjaminAnswers], submit: true,
    },
    {
      family_name: 'The Levi Family', primary_guardian: 'Miriam Levi', primary_email: 'miriam.levi.demo@example.com',
      login_password: 'demo-password-levi', status: 'onboarding', preferred_contact: 'Email',
      travel: { destination: 'Lake Como, Italy', start_date: '2027-07-03', end_date: '2027-07-17', modes: ['Plane'] },
      children: [noamAnswers], submit: false,
    },
  ],
  inquiries: [
    { parent_name: 'Rachel Klein', email: 'rachel.klein.demo@example.com', preferred_contact: 'Phone call', phone: '+1 555 0100',
      destination: 'Jerusalem, Israel', travel_start: '2027-04-10', travel_end: '2027-04-25', num_children: 2, children_ages: '6 and 3',
      nanny_type: 'Destination nanny', care_duration: 'Two weeks, daytime', preferences: 'Experience with Passover routines would be wonderful.',
      cultural_considerations: 'Orthodox family; Shabbat and Yom Tov observant.' },
    { parent_name: 'Emma Rosen', email: 'emma.rosen.demo@example.com', preferred_contact: 'Email',
      destination: 'St. Barts', travel_start: '2027-02-14', travel_end: '2027-02-21', num_children: 1, children_ages: '18 months',
      nanny_type: 'Traveling nanny', care_duration: 'One week', preferences: 'Evening care so we can dine out.' },
  ],
  messages: [
    { name: 'Daniel Weiss', email: 'daniel.weiss.demo@example.com', subject: 'Availability next summer', body: 'Do you arrange care in Greece? We are planning a month in Crete.' },
  ],
  samples: { davidAnswers, leahAnswers, benjaminAnswers, noamAnswers },
};
