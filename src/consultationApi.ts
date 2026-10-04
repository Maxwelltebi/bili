import { z } from 'zod';
import { financialSchema, estimateSchema, type FinancialState } from './financeApi';

export type Answer = { id: string; prompt: string; choice: string; text: string };
export type PlanDocument = { name: string; mimeType: 'application/pdf' | 'image/jpeg' | 'image/png'; data: string };
export type Payload = { answers: Answer[]; document: PlanDocument | null; documents?: PlanDocument[]; financialState?: FinancialState | null; financialDraft?: FinancialState | null; savedFacts?: Turn['facts']; mode: 'next' | 'summary' };
export const turnSchema = z.object({
  id: z.string().min(1), kind: z.enum(['question', 'document', 'review', 'ready']), topic: z.string(), title: z.string().min(1), context: z.string(), choices: z.array(z.string()),
  documentPurpose: z.enum(['insurance', 'bill']).optional(),
  facts: z.array(z.object({ label: z.string(), value: z.string(), basis: z.enum(['user', 'document', 'unknown']), evidence: z.string() })),
  actions: z.array(z.string()), uncertainties: z.array(z.string()),
  financialProposal: financialSchema.nullable().optional(), financialResult: estimateSchema.nullable().optional(),
  suggestedView: z.enum(['cost', 'schedule']).optional(),
});
export type Turn = z.infer<typeof turnSchema>;
const connectionMessage = 'The consultation could not connect. Your answers are still here; please try again in a moment.';

export async function requestConsultation(payload: Payload, signal: AbortSignal): Promise<Turn> {
  let response: Response;
  try {
    response = await fetch('/api/consult', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal });
  } catch (error) { if (signal.aborted) throw error; throw new Error(connectionMessage); }
  let result: unknown;
  try { result = JSON.parse(await response.text()); }
  catch { throw new Error(connectionMessage); }
  if (!response.ok) {
    const failure = z.object({ message: z.string().min(1).max(500) }).safeParse(result);
    throw new Error(failure.success ? failure.data.message : connectionMessage);
  }
  const turn = turnSchema.safeParse(result);
  if (!turn.success) throw new Error('The consultation response could not be read. Your answers are still here; please retry.');
  return turn.data;
}
