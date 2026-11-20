type Schema = Record<string, unknown>;

function object(properties: Record<string, Schema>): Schema {
  return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false };
}

const id = { type: 'integer', minimum: 1 };
const sentence = { type: 'string' };
const citations = { type: 'array', items: id, maxItems: 12 };
const addition = object({
  componentIds: { type: 'array', items: id, minItems: 1, maxItems: 2 },
  when: sentence,
  why: sentence,
  groupIds: citations,
});
const recommendation = object({
  baseId: id,
  rankBasis: { type: 'string', enum: ['solo', 'recurrence', 'targetFeedback', 'contrast', 'backgroundUse', 'overall'] },
  reason: sentence,
  limitation: sentence,
  guidance: sentence,
  groupIds: citations,
  additions: { type: 'array', items: addition, maxItems: 2 },
});

export const prescriptionSynthesisSchema = object({
  recommendations: { type: 'array', items: recommendation, maxItems: 3 },
  shortlistNote: sentence,
});
