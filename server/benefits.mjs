import { z } from 'zod';
import { financialSchema, calculateCosts } from './finance.mjs';

const money = z.number().finite().min(0).max(1000000).refine(value => Math.abs(value * 100 - Math.round(value * 100)) < 0.000001, 'Use dollars and cents');
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}, 'Use a valid date');
const networkQuoteSchema = z.object({
  procedureId: z.string().min(1).max(80), quote: money.nullable(), allowedAmount: money.nullable(),
  insurancePercent: z.number().min(0).max(100).nullable(), covered: z.boolean().nullable(), deductibleApplies: z.boolean().nullable(),
}).strict();
const networkScenarioSchema = z.object({ remainingDeductible: money.nullable(), remainingBenefit: money.nullable(), quotes: z.array(networkQuoteSchema).max(8) }).strict();
export const networkSchema = z.object({ in: networkScenarioSchema, out: networkScenarioSchema }).strict();
export const benefitsSchema = z.object({
  financialState: financialSchema, confirmed: z.boolean(), openingUsed: money.nullable(), openingDeductible: money.nullable(),
  claims: z.array(z.object({ id: z.string().min(1).max(80), name: z.string().trim().min(1).max(100), date, insurerPaid: money, deductiblePaid: money }).strict()).max(300),
  network: networkSchema,
  reminders: z.object({ enabled: z.boolean(), leadDays: z.union([z.literal(14), z.literal(30), z.literal(60), z.literal(90)]), dismissedYearEnd: date.nullable() }).strict(),
}).strict().superRefine((data, ctx) => {
  if (new Set(data.claims.map(claim => claim.id)).size !== data.claims.length) ctx.addIssue({ code: 'custom', message: 'Claim IDs must be unique' });
  if (data.openingUsed !== null && data.financialState.plan.annualMaximum !== null && data.openingUsed > data.financialState.plan.annualMaximum) ctx.addIssue({ code: 'custom', message: 'Previously used benefits cannot exceed the annual maximum' });
  const plan = data.financialState.plan;
  if (data.openingUsed !== null && plan.annualMaximum !== null && plan.benefitYearStart && plan.benefitYearEnd) {
    const paid = data.claims.filter(claim => claim.date >= plan.benefitYearStart && claim.date <= plan.benefitYearEnd).reduce((sum, claim) => sum + Math.round(claim.insurerPaid * 100), 0);
    if (Math.round(data.openingUsed * 100) + paid > Math.round(plan.annualMaximum * 100)) ctx.addIssue({ code: 'custom', message: 'Recorded benefits used cannot exceed the annual maximum' });
  }
});
export const networkRequestSchema = z.object({ state: financialSchema, network: networkSchema }).strict().superRefine(({ state, network }, ctx) => {
  for (const scenario of Object.values(network)) {
    const ids = scenario.quotes.map(quote => quote.procedureId);
    if (new Set(ids).size !== ids.length || ids.some(id => !state.procedures.some(p => p.id === id))) ctx.addIssue({ code: 'custom', message: 'Check network quote procedure IDs' });
    if (state.plan.annualMaximum !== null && scenario.remainingBenefit !== null && scenario.remainingBenefit > state.plan.annualMaximum) ctx.addIssue({ code: 'custom', message: 'Remaining benefits cannot exceed the annual maximum' });
  }
});
export function compareNetworks(raw) {
  const { state, network } = networkRequestSchema.parse(raw);
  function scenario(key) {
    const details = network[key];
    return calculateCosts({ ...state, plan: { ...state.plan, remainingDeductible: details.remainingDeductible, remainingBenefit: details.remainingBenefit }, procedures: state.procedures.map(p => {
      const quote = details.quotes.find(q => q.procedureId === p.id);
      return { ...p, quote: quote?.quote ?? null, quoteType: 'total_fee', clinicPatientEstimate: null, allowedAmount: quote?.allowedAmount ?? null, insurancePercent: quote?.insurancePercent ?? null, covered: quote?.covered ?? null, deductibleApplies: quote?.deductibleApplies ?? null, network: key, feeBasis: 'allowed_amount' };
    }) });
  }
  const inNetwork = scenario('in'), outOfNetwork = scenario('out');
  const complete = inNetwork.status === 'estimate' && outOfNetwork.status === 'estimate';
  return { inNetwork, outOfNetwork, difference: complete ? Math.round((outOfNetwork.totalPatientPays - inNetwork.totalPatientPays) * 100) / 100 : null };
}
