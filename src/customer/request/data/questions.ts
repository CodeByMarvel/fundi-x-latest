import { Question } from '../types';

/**
 * The guided questions. Categories list which questions start their flow;
 * an option's `followUps` are asked straight after the question it belongs to.
 * Add a new branch by adding questions here, no new screens needed.
 */
const QUESTION_LIST: Question[] = [
  // ---- Shared ----
  {
    id: 'common.since',
    title: 'When did you first notice this?',
    options: [
      { id: 'just_now', label: 'Just now' },
      { id: 'today', label: 'Today' },
      { id: 'few_days', label: 'A few days ago' },
      { id: 'over_week', label: 'More than a week ago' },
      { id: 'a_while', label: "It's been happening for a while" },
    ],
  },
  {
    id: 'common.start_behaviour',
    title: 'What happens when you try to start it?',
    options: [
      { id: 'nothing', label: 'Nothing happens' },
      { id: 'clicking', label: 'I hear clicking' },
      { id: 'cranks', label: "Engine turns but doesn't start" },
      { id: 'starts_stops', label: 'It starts then immediately stops' },
      { id: 'not_sure', label: "I'm not sure" },
    ],
  },
  {
    id: 'common.warning_signs',
    title: 'Were there any warning signs before this happened?',
    options: [
      { id: 'yes', label: 'Yes' },
      { id: 'no', label: 'No' },
      { id: 'not_sure', label: 'Not sure' },
    ],
  },

  // ---- Engine ----
  {
    id: 'engine.symptoms',
    title: 'What are you experiencing?',
    subtitle: 'Pick everything that applies.',
    multi: true,
    options: [
      {
        id: 'wont_start',
        label: "Car won't start",
        followUps: ['common.start_behaviour', 'common.warning_signs'],
      },
      { id: 'overheating', label: 'Engine is overheating' },
      { id: 'loss_of_power', label: 'Loss of power' },
      { id: 'shaking', label: 'Engine shaking' },
      {
        id: 'noise',
        label: 'Strange noise',
        followUps: ['engine.noise_when'],
      },
      { id: 'fuel_consumption', label: 'High fuel consumption' },
      { id: 'smoke', label: 'Smoke from exhaust' },
      { id: 'warning_light', label: 'Engine warning light' },
      { id: 'other', label: 'Other' },
    ],
  },
  {
    id: 'engine.noise_when',
    title: 'When do you hear the noise?',
    options: [
      { id: 'idle', label: 'When idling' },
      { id: 'accelerating', label: 'When accelerating' },
      { id: 'cold_start', label: 'When starting a cold engine' },
      { id: 'always', label: 'All the time' },
      { id: 'not_sure', label: "I'm not sure" },
    ],
  },

  // ---- Electrical ----
  {
    id: 'electrical.symptoms',
    title: 'What are you experiencing?',
    subtitle: 'Pick everything that applies.',
    multi: true,
    options: [
      {
        id: 'wont_start',
        label: "Car won't start",
        followUps: ['common.start_behaviour'],
      },
      { id: 'battery_drains', label: 'Battery keeps dying' },
      { id: 'lights', label: "Lights don't work" },
      { id: 'dashboard', label: 'Dashboard or gauges acting up' },
      { id: 'windows_locks', label: 'Windows or locks not working' },
      { id: 'burning_smell', label: 'Burning smell from wiring' },
      { id: 'other', label: 'Other' },
    ],
  },

  // ---- Brakes ----
  {
    id: 'brakes.symptoms',
    title: 'What are you experiencing?',
    subtitle: 'Pick everything that applies.',
    multi: true,
    options: [
      {
        id: 'noise',
        label: 'Strange noise',
        followUps: ['brakes.noise_when', 'brakes.noise_type'],
      },
      { id: 'vibration', label: 'Vibration when braking' },
      { id: 'weak', label: 'Weak braking' },
      { id: 'soft_pedal', label: 'Pedal feels soft or sinks' },
      { id: 'pulling', label: 'Car pulls to one side when braking' },
      { id: 'warning_light', label: 'Brake warning light' },
      { id: 'other', label: 'Other' },
    ],
  },
  {
    id: 'brakes.noise_when',
    title: 'When do you hear the noise?',
    options: [
      { id: 'braking', label: 'When braking' },
      { id: 'not_braking', label: 'Even when not braking' },
      { id: 'turning', label: 'When turning' },
      { id: 'bumps', label: 'Over bumps' },
      { id: 'not_sure', label: "I'm not sure" },
    ],
  },
  {
    id: 'brakes.noise_type',
    title: 'How would you describe the noise?',
    options: [
      { id: 'squealing', label: 'Squealing' },
      { id: 'grinding', label: 'Grinding' },
      { id: 'knocking', label: 'Knocking' },
      { id: 'scraping', label: 'Scraping' },
      { id: 'clicking', label: 'Clicking' },
      { id: 'other', label: 'Other' },
    ],
  },

  // ---- Suspension & steering ----
  {
    id: 'suspension.symptoms',
    title: 'What are you experiencing?',
    subtitle: 'Pick everything that applies.',
    multi: true,
    options: [
      { id: 'shaking', label: 'Shaking or vibration' },
      { id: 'pulling', label: 'Pulls to one side' },
      {
        id: 'knocking',
        label: 'Knocking or clunking',
        followUps: ['suspension.noise_when'],
      },
      { id: 'heavy_steering', label: 'Steering feels heavy' },
      { id: 'loose_steering', label: 'Steering feels loose' },
      { id: 'bouncy', label: 'Ride is too bouncy' },
      { id: 'other', label: 'Other' },
    ],
  },
  {
    id: 'suspension.noise_when',
    title: 'When do you hear it?',
    options: [
      { id: 'bumps', label: 'Over bumps' },
      { id: 'turning', label: 'When turning' },
      { id: 'braking', label: 'When braking' },
      { id: 'always', label: 'All the time' },
      { id: 'not_sure', label: "I'm not sure" },
    ],
  },

  // ---- Transmission ----
  {
    id: 'transmission.symptoms',
    title: 'What are you experiencing?',
    subtitle: 'Pick everything that applies.',
    multi: true,
    options: [
      { id: 'hard_shift', label: 'Hard to change gears' },
      { id: 'slipping', label: 'Gears slipping' },
      { id: 'delay', label: 'Delay before the car moves' },
      { id: 'noise', label: 'Whining or grinding noise' },
      { id: 'leak', label: 'Fluid leaking' },
      { id: 'warning_light', label: 'Warning light' },
      { id: 'other', label: 'Other' },
    ],
  },

  // ---- AC ----
  {
    id: 'ac.symptoms',
    title: 'What are you experiencing?',
    subtitle: 'Pick everything that applies.',
    multi: true,
    options: [
      { id: 'not_cooling', label: 'Not cooling' },
      { id: 'weak_airflow', label: 'Weak airflow' },
      { id: 'bad_smell', label: 'Bad smell' },
      { id: 'noise', label: 'Noise when AC is on' },
      { id: 'other', label: 'Other' },
    ],
  },

  // ---- Diagnostics ----
  {
    id: 'diagnostics.light',
    title: 'Is there a warning light on the dashboard?',
    options: [
      { id: 'check_engine', label: 'Check engine light' },
      { id: 'battery', label: 'Battery light' },
      { id: 'oil', label: 'Oil pressure light' },
      { id: 'temperature', label: 'Temperature light' },
      { id: 'abs', label: 'ABS / brake light' },
      { id: 'airbag', label: 'Airbag light' },
      { id: 'other_light', label: 'A different light' },
      { id: 'no_light', label: 'No light, something just feels wrong' },
    ],
  },

  // ---- Body ----
  {
    id: 'body.damage',
    title: 'What kind of damage is it?',
    subtitle: 'Pick everything that applies.',
    multi: true,
    options: [
      { id: 'dent', label: 'Dent' },
      { id: 'scratch', label: 'Scratches or paint damage' },
      { id: 'collision', label: 'Collision damage' },
      { id: 'glass', label: 'Broken glass or mirror' },
      { id: 'lights', label: 'Broken lights' },
      { id: 'other', label: 'Other' },
    ],
  },
  {
    id: 'body.when',
    title: 'When did it happen?',
    options: [
      { id: 'just_now', label: 'Just now' },
      { id: 'today', label: 'Today' },
      { id: 'few_days', label: 'A few days ago' },
      { id: 'a_while', label: 'A while ago' },
    ],
  },

  // ---- Service ----
  {
    id: 'service.last_service',
    title: 'When was it last done?',
    options: [
      { id: 'under_3m', label: 'Less than 3 months ago' },
      { id: '3_6m', label: '3 to 6 months ago' },
      { id: '6_12m', label: '6 to 12 months ago' },
      { id: 'over_year', label: 'More than a year ago' },
      { id: 'not_sure', label: "I'm not sure" },
    ],
  },
  {
    id: 'service.brake_issues',
    title: 'Have you noticed anything with the brakes?',
    subtitle: 'Pick everything that applies.',
    multi: true,
    options: [
      { id: 'none', label: 'No, just due for a service' },
      { id: 'noise', label: 'Noise when braking' },
      { id: 'vibration', label: 'Vibration' },
      { id: 'soft_pedal', label: 'Soft pedal' },
    ],
  },
  {
    id: 'service.ac_issues',
    title: 'How is the AC working right now?',
    options: [
      { id: 'fine', label: 'Fine, just due for a service' },
      { id: 'weak', label: 'Cooling, but weakly' },
      { id: 'not_cooling', label: 'Not cooling' },
      { id: 'smell', label: 'Bad smell' },
    ],
  },
  {
    id: 'service.inspection_reason',
    title: 'What is the inspection for?',
    options: [
      { id: 'buying', label: "I'm buying this car" },
      { id: 'selling', label: "I'm selling this car" },
      { id: 'general', label: 'General health check' },
      { id: 'after_accident', label: 'After an accident' },
      { id: 'insurance', label: 'Insurance' },
    ],
  },
  {
    id: 'service.trip_length',
    title: 'How long is the trip?',
    options: [
      { id: 'under_200', label: 'Under 200 km' },
      { id: '200_500', label: '200 to 500 km' },
      { id: 'over_500', label: 'Over 500 km' },
      { id: 'cross_border', label: 'Cross-border' },
    ],
  },
];

export const QUESTIONS: Record<string, Question> = Object.fromEntries(
  QUESTION_LIST.map(q => [q.id, q]),
);
