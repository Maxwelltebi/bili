import { z } from 'zod';
const nullableMoney = z.number().finite().nonnegative().nullable();
const nullableDate = z.string().nullable();
export const financialSchema = z.object({
  currency: z.literal('USD'),
  budget: nullableMoney.optional(), 
  plan: z.object({ remainingDeductible: nullableMoney, remainingBenefit: nullableMoney, annualMaximum: nullableMoney, annualDeductible: nullableMoney, benefitYearStart: nullableDate, benefitYearEnd: nullableDate, nextYearAnnualMaximum: nullableMoney, nextYearDeductible: nullableMoney, renewalConfirmed: z.boolean() }),
  procedures: z.array(z.object({ id: z.string(), name: z.string(), code: z.string().nullable(), quote: nullableMoney, quoteType: z.enum(['total_fee', 'patient_estimate', 'unknown']), clinicPatientEstimate: nullableMoney.optional(), allowedAmount: nullableMoney, insurancePercent: z.number().min(0).max(100).nullable(), covered: z.boolean().nullable(), deductibleApplies: z.boolean().nullable(), network: z.enum(['in', 'out', 'unknown']), feeBasis: z.enum(['quoted_fee', 'allowed_amount', 'unknown']), date: nullableDate, earliestDate: nullableDate, latestDate: nullableDate, dentistApprovedWindow: z.boolean(), dependsOn: z.array(z.string()) })),
});
export type FinancialState = z.infer<typeof financialSchema>;
export type Procedure = FinancialState['procedures'][number];
export const emptyFinancialState: FinancialState = { currency: 'USD', plan: { remainingDeductible: null, remainingBenefit: null, annualMaximum: null, annualDeductible: null, benefitYearStart: null, benefitYearEnd: null, nextYearAnnualMaximum: null, nextYearDeductible: null, renewalConfirmed: false }, procedures: [] };
export function newProcedure(): Procedure { return { id: `procedure-${crypto.randomUUID()}`, name: '', code: null, quote: null, quoteType: 'unknown', allowedAmount: null, insurancePercent: null, covered: null, deductibleApplies: null, network: 'unknown', feeBasis: 'unknown', date: null, earliestDate: null, latestDate: null, dentistApprovedWindow: false, dependsOn: [] }; }
const costRowSchema = z.object({ id: z.string(), name: z.string(), date: nullableDate, period: z.string(), quoteType: z.string(), quotedFee: nullableMoney, clinicPatientEstimate: nullableMoney.optional(), eligibleFee: nullableMoney, deductible: nullableMoney, insurancePercent: nullableMoney, insurerPays: nullableMoney, patientPays: nullableMoney, benefitCapApplied: z.boolean(), assumptions: z.array(z.string()), gaps: z.array(z.string()), status: z.string() });
export const calculationSchema = z.object({ currency: z.string(), rows: z.array(costRowSchema), totalPatientPays: nullableMoney, totalInsurerPays: nullableMoney, status: z.string(), benefitUsage: z.array(z.object({ period: z.string(), plannedInsurerPayment: nullableMoney, remainingBenefit: nullableMoney, remainingDeductible: nullableMoney, incomplete: z.boolean() })), warnings: z.array(z.string()) });
export const estimateSchema = z.object({ state: financialSchema, calculation: calculationSchema, optimization: z.object({ available: z.boolean(), reason: z.string(), evaluated: z.number(), original: calculationSchema, best: calculationSchema.nullable(), savings: nullableMoney, dates: z.array(z.object({ id: z.string(), date: z.string() })) }), budget: nullableMoney, withinBudget: z.boolean().nullable() });
export type Estimate = z.infer<typeof estimateSchema>;
async function post<T>(path: string, body: unknown, schema: z.ZodType<T>, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try { response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal }); }
  catch (error) { if (signal?.aborted) throw error; throw new Error('Could not connect. Your inputs are still here; please retry.'); }
  let value: unknown;
  try { value = await response.json(); } catch { throw new Error('The result could not be read. Please retry.'); }
  if (!response.ok) { const failure = z.object({ message: z.string() }).safeParse(value); throw new Error(failure.success ? failure.data.message : 'This request could not complete. Please retry.'); }
  const result = schema.safeParse(value); if (!result.success) throw new Error('The result could not be validated. Please retry.'); return result.data;
}
export const calculateEstimate = (state: FinancialState, budget: number | null = null, signal?: AbortSignal) => post('/api/estimate', { state, budget }, estimateSchema, signal);
export const formatMoney = (amount: number | null) => amount === null ? 'Still needed' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
