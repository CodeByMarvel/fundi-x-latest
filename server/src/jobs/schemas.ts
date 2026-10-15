/**
 * JSON schemas Fastify checks request bodies against before any handler
 * runs. Unknown fields are stripped, so a client can't sneak in a status,
 * a customerId or a price.
 */

const text = (maxLength = 200) => ({ type: 'string', minLength: 1, maxLength });

export const requestDetailsProperties = {
  requestType: { enum: ['repair', 'service'] },
  categoryId: text(64),
  vehicle: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'registration', 'make', 'model'],
    properties: {
      id: text(64),
      registration: text(20),
      make: text(60),
      model: text(60),
      year: { type: 'integer', minimum: 1950, maximum: 2100 },
    },
  },
  answers: {
    type: 'object',
    additionalProperties: { type: 'array', items: text(64), maxItems: 20 },
  },
  description: { type: 'string', maxLength: 2000 },
  drivability: { enum: ['safe', 'caution', 'cannot', 'unsure'] },
  location: {
    type: 'object',
    additionalProperties: false,
    required: ['kind', 'label', 'address'],
    properties: {
      kind: { enum: ['current', 'home', 'work', 'other'] },
      label: text(60),
      address: text(300),
      coords: {
        type: 'object',
        additionalProperties: false,
        required: ['lat', 'lng'],
        properties: {
          lat: { type: 'number', minimum: -90, maximum: 90 },
          lng: { type: 'number', minimum: -180, maximum: 180 },
        },
      },
    },
  },
  urgency: { enum: ['now', 'today', 'scheduled'] },
  scheduledFor: {
    type: 'object',
    additionalProperties: false,
    required: ['date', 'time'],
    properties: {
      date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
      time: { type: 'string', pattern: '^\\d{2}:\\d{2}$' },
    },
  },
} as const;

const requiredDetails = [
  'requestType',
  'categoryId',
  'vehicle',
  'answers',
  'description',
  'drivability',
  'location',
  'urgency',
];

export const requestDetailsSchema = {
  type: 'object',
  additionalProperties: false,
  required: requiredDetails,
  properties: requestDetailsProperties,
} as const;

export const createJobSchema = {
  type: 'object',
  additionalProperties: false,
  required: [...requiredDetails, 'acceptedPrice'],
  properties: {
    ...requestDetailsProperties,
    acceptedPrice: {
      type: 'object',
      additionalProperties: false,
      required: ['callOut'],
      properties: {
        callOut: { type: 'integer', minimum: 0 },
        fixedServiceTotal: { type: 'integer', minimum: 0 },
      },
    },
  },
} as const;

export const jobIdParams = {
  type: 'object',
  required: ['id'],
  properties: { id: text(80) },
} as const;
