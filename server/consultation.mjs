import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { readSystemPrompt, buildRuntimeContext } from './prompt.mjs';
import { financialSchema, financialDraftSchema, estimate } from './finance.mjs';
import { modelSchema } from './model-schema.mjs';
import { supportJourney } from './journey.mjs';
import { plainTurn } from './plain-language.mjs';

const text = max => z.string().max(max);
export const answerSchema = z.object({ id: text(100), prompt: text(240), choice: text(120), text: text(1000) }).strict();
export const documentSchema = z.object({ name: text(180), mimeType: z.enum(['application/pdf', 'image/jpeg', 'image/png']), data: text(14000000) }).strict();
const savedFactSchema = z.object({ label: text(60), value: text(160), basis: z.enum(['user', 'document', 'unknown']), evidence: text(180) }).strict();
export const requestSchema = z.object({ answers: z.array(answerSchema).min(1).max(200), document: documentSchema.nullable(), documents: z.array(documentSchema).max(5).optional(), financialState: financialSchema.nullable().optional(), financialDraft: financialDraftSchema.nullable().optional(), savedFacts: z.array(savedFactSchema).max(60).optional(), mode: z.enum(['next', 'summary']) }).strict();
export const turnSchema = z.object({
  kind: z.enum(['question', 'document', 'review', 'ready']), topic: text(50), title: text(100), context: text(180), choices: z.array(text(80)).max(5),
  documentPurpose: z.enum(['insurance', 'bill']).optional(),
  facts: z.array(z.object({ label: text(60), value: text(160), basis: z.enum(['user', 'document', 'unknown']), evidence: text(180) }).strict()).max(6),
  actions: z.array(text(180)).max(4), uncertainties: z.array(text(160)).max(4),
  financialProposal: financialSchema.nullable().optional(),
  suggestedView: z.enum(['cost', 'schedule']).optional(),
}).strict();
export class AppError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }

export function validateDocument(document) {
  if (!document) return;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(document.data)) throw new AppError(400, 'file_invalid', 'Select a valid PDF, JPG or PNG.');
  const bytes = Buffer.from(document.data, 'base64');
  if (!bytes.length || bytes.length > 10 * 1024 * 1024) throw new AppError(413, 'file_size', 'Files must be smaller than 10 MB.');
  const pdf = bytes.subarray(0, 5).toString() === '%PDF-';
  const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (!((document.mimeType === 'application/pdf' && pdf) || (document.mimeType === 'image/png' && png) || (document.mimeType === 'image/jpeg' && jpg))) throw new AppError(400, 'file_type', 'The file contents must match a PDF, JPG or PNG.');
}

export function providerError(status, body = '') {
  if (status === 401 || status === 403 || (status === 400 && /API_KEY_INVALID|API key not valid/i.test(body))) return new AppError(502, 'ai_auth', 'Gemini could not accept the API key. Check the server key and its permissions.');
  if (status === 429) return new AppError(429, 'ai_quota', 'Gemini reached an account quota or rate limit. Your answers are saved for this visit; wait and retry.');
  if (status === 400 || status === 404) return new AppError(502, 'ai_request', 'Gemini could not process this request. Try removing the document, or check GEMINI_MODEL on the server.');
  return new AppError(502, 'ai_unavailable', 'The consultant is temporarily unavailable. Your answers are still here; please retry.');
}

export function groundFacts(turn, request) {
  const userText = request.answers.map(a => `${a.choice}\n${a.text}`).join('\n').toLowerCase();
  return { ...turn, facts: turn.facts.map(fact => {
    const quote = fact.evidence.trim().toLowerCase();
    const saved = request.savedFacts?.some(previous => previous.basis === fact.basis && previous.label === fact.label && previous.value === fact.value && previous.evidence === fact.evidence);
    const supported = fact.basis === 'unknown' || (quote && ((fact.basis === 'user' && userText.includes(quote)) || (fact.basis === 'document' && (request.document || saved))));
    return supported ? fact : { ...fact, value: 'Not confirmed from the information provided', basis: 'unknown', evidence: '' };
  }) };
}

export async function consult(raw, { apiKey = process.env.GEMINI_API_KEY, model = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite', fetchImpl = fetch, promptLoader = readSystemPrompt, signal } = {}) {
  const request = requestSchema.parse(raw);
  const documents = [...new Map([...(request.documents || []), ...(request.document ? [request.document] : [])].map(doc => [doc.data, doc])).values()];
  documents.forEach(validateDocument);
  if (documents.reduce((sum, doc) => sum + Buffer.from(doc.data, 'base64').length, 0) > 10 * 1024 * 1024) throw new AppError(413, 'file_size', 'Combined documents must be smaller than 10 MB.');
  if (!apiKey) throw new AppError(503, 'ai_config', 'The consultant is not configured yet. Add GEMINI_API_KEY on the server.');
  let consultationContext;
  try {
    consultationContext = await promptLoader();
    if (typeof consultationContext !== 'string' || !consultationContext.trim() || consultationContext.length > 48000) throw new Error('Invalid system prompt');
  }
  catch { throw new AppError(503, 'ai_context', 'The consultation guidance could not be loaded. Check the server-side system prompt and retry.'); }
  const systemParts = [{ text: consultationContext }];
  const financialResult = request.financialState ? estimate({ state: request.financialState }) : null;
  const parts = [{ text: JSON.stringify({ mode: request.mode, runtimeContext: buildRuntimeContext(request, financialResult), answers: request.answers, documentName: request.document?.name || null, documentNames: documents.map(doc => doc.name) }) }];
  for (const document of documents) parts.push({ inlineData: { mimeType: document.mimeType, data: document.data } });
  // A requested result must not turn into another checkpoint or question.
  const schema = modelSchema(request.mode === 'summary' ? turnSchema.extend({ kind: z.literal('ready') }) : turnSchema);
  const contents = [{ role: 'user', parts }];
  const deadline = signal ? AbortSignal.any([signal, AbortSignal.timeout(90000)]) : AbortSignal.timeout(90000);
  let turn;
  for (let attempt = 0; attempt < 2; attempt++) {
    let response;
    try {
      response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST', headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' }, signal: deadline,
        body: JSON.stringify({ systemInstruction: { parts: systemParts }, contents, generationConfig: { responseMimeType: 'application/json', responseJsonSchema: schema } }),
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new AppError(504, 'ai_timeout', 'The consultant could not connect in time. Your answers are still here; please retry.');
    }
    if (!response.ok) throw providerError(response.status, await response.text());
    let output;
    try {
      const payload = await response.json();
      const candidate = payload.candidates?.[0];
      if (candidate?.finishReason !== 'STOP') throw new Error('Incomplete answer');
      output = candidate.content?.parts?.filter(part => !part.thought && typeof part.text === 'string').map(part => part.text).join('');
      // Excerpts and financial inputs remain untouched by presentation changes.
      const shape = turnSchema.extend({ topic: z.string(), title: z.string(), context: z.string(), choices: z.array(z.string()).max(5), facts: z.array(z.object({ label: z.string(), value: z.string(), basis: z.enum(['user', 'document', 'unknown']), evidence: text(180) }).strict()).max(6), actions: z.array(z.string()).max(4), uncertainties: z.array(z.string()).max(4) }).parse(JSON.parse(output));
      turn = turnSchema.parse(plainTurn(shape));
      if (request.mode === 'summary' && turn.kind !== 'ready') throw new Error('Summary required');
      if (!turn.title.trim() || new Set(turn.choices).size !== turn.choices.length) throw new Error('Invalid question');
      break;
    } catch (error) {
      // One bounded repair preserves meaning instead of truncating cost assumptions.
      if (attempt === 0 && output && error instanceof z.ZodError) {
        contents.push({ role: 'model', parts: [{ text: output }] }, { role: 'user', parts: [{ text: JSON.stringify({ instruction: 'Repair your JSON to match the response schema. Keep all grounded facts, source excerpts and financial inputs accurate. Use short plain-language headings; keep context under 180 characters and use facts for details. Do not invent missing amounts.', validation: error.issues.map(issue => ({ field: issue.path.join('.'), message: issue.message })) }) }] });
        continue;
      }
      throw new AppError(502, 'ai_response', 'The consultant returned an unreadable response. Retry to continue.');
    }
  }
  return { ...groundFacts(supportJourney(turn, request), { ...request, document: documents[0] || null }), id: randomUUID(), financialResult };
}
