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
      engineCc: { type: 'integer', minimum: 50, maximum: 10000 },
      fuel: { enum: ['petrol', 'diesel', 'hybrid', 'electric'] },
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
  partsOption: { enum: ['MECHANIC', 'OWN'] },
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

const quoteItems = {
  type: 'array',
  minItems: 1,
  maxItems: 30,
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['serviceCode', 'kind', 'description', 'quantity', 'unitPrice'],
    properties: {
      serviceCode: text(64),
      kind: { enum: ['PART', 'LABOUR', 'CONSUMABLE', 'OTHER'] },
      description: text(200),
      quantity: { type: 'integer', minimum: 1, maximum: 100 },
      // Cents; KSh 1,000,000 is far above any single line.
      unitPrice: { type: 'integer', minimum: 1, maximum: 100_000_000 },
    },
  },
} as const;

const body = (required: string[], properties: Record<string, unknown>) =>
  ({ type: 'object', additionalProperties: false, required, properties }) as const;

export const sendQuoteSchema = body(['items'], {
  items: quoteItems,
  note: { type: 'string', maxLength: 500 },
});
export const additionalQuoteSchema = body(['items', 'reason'], {
  items: quoteItems,
  reason: text(500),
});
export const quoteAnswerSchema = body(['quoteId'], { quoteId: text(80) });
export const noteSchema = body([], { note: { type: 'string', maxLength: 500 } });
export const summarySchema = body([], { summary: { type: 'string', maxLength: 1000 } });
export const disputeSchema = body(['reason'], { reason: text(1000) });
export const ratingSchema = body(['stars'], {
  stars: { type: 'integer', minimum: 1, maximum: 5 },
  comment: { type: 'string', maxLength: 500 },
});
