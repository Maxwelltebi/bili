import { z } from 'zod';

// Gemini limits schema complexity. Keep output shape, required keys, enums and nullability;
// enforce lengths, ranges, dates and cross-field constraints with the full Zod schema after generation.
export function modelSchema(schema) {
  function project(value, financial = false) {
    if (Array.isArray(value)) return value.map(item => project(item, financial));
    if (!value || typeof value !== 'object') return value;
    const result = {};
    for (const [key, item] of Object.entries(value)) {
      if (key === '$schema' || financial && ['pattern', 'minLength', 'maxLength', 'minimum', 'maximum', 'minItems', 'maxItems'].includes(key)) continue;
      if (key === 'const') result.enum = [item];
      else result[key] = project(item, financial || key === 'financialProposal');
    }
    return result;
  }
  return project(z.toJSONSchema(schema, { unrepresentable: 'any' }));
}
