import { z } from 'zod';

const money = z.number().finite().min(0).max(1000000).refine(value => Math.abs(value * 100 - Math.round(value * 100)) < 0.000001, 'Use monetary amounts with at most two decimal places').nullable();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}, 'Use a valid date').nullable();
export const financialDraftSchema = z.object({
  currency: z.literal('USD'),
  budget: money.optional(), 
  plan: z.object({
    remainingDeductible: money, remainingBenefit: money, annualMaximum: money, annualDeductible: money,
    benefitYearStart: date, benefitYearEnd: date, nextYearAnnualMaximum: money, nextYearDeductible: money, renewalConfirmed: z.boolean(),
  }).strict(),
  procedures: z.array(z.object({
    id: z.string().min(1).max(80), name: z.string().min(1).max(100), code: z.string().max(20).nullable(),
    quote: money, quoteType: z.enum(['total_fee', 'patient_estimate', 'unknown']),
    clinicPatientEstimate: money.optional(),
    allowedAmount: money, insurancePercent: z.number().min(0).max(100).nullable(), covered: z.boolean().nullable(), deductibleApplies: z.boolean().nullable(),
    network: z.enum(['in', 'out', 'unknown']), feeBasis: z.enum(['quoted_fee', 'allowed_amount', 'unknown']),
    date, earliestDate: date, latestDate: date, dentistApprovedWindow: z.boolean(), dependsOn: z.array(z.string().max(80)).max(8),
  }).strict()).max(8),
}).strict();
export const financialSchema = financialDraftSchema.superRefine((state, ctx) => {
  const ids = state.procedures.map(p => p.id);
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', message: 'Procedure IDs must be unique' });
  if (state.plan.benefitYearStart && state.plan.benefitYearEnd && state.plan.benefitYearStart > state.plan.benefitYearEnd) ctx.addIssue({ code: 'custom', message: 'Check benefit-year dates' });
  for (const p of state.procedures) {
    if (p.earliestDate && p.latestDate && p.earliestDate > p.latestDate) ctx.addIssue({ code: 'custom', message: 'Check approved date windows' });
    if (p.dependsOn.some(id => !ids.includes(id) || id === p.id)) ctx.addIssue({ code: 'custom', message: 'Check treatment dependencies' });
  }
  const visiting = new Set(), visited = new Set();
  function hasCycle(id) {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    if (state.procedures.find(p => p.id === id)?.dependsOn.some(hasCycle)) return true;
    visiting.delete(id); visited.add(id); return false;
  }
  if (ids.some(hasCycle)) ctx.addIssue({ code: 'custom', message: 'Treatment dependencies cannot contain a cycle' });
  if (state.plan.remainingBenefit !== null && state.plan.annualMaximum !== null && state.plan.remainingBenefit > state.plan.annualMaximum) ctx.addIssue({ code: 'custom', message: 'Remaining benefits cannot exceed the annual maximum' });
});
export const estimateRequestSchema = z.object({ state: financialSchema, budget: money.optional() }).strict();
const cents = value => Math.round(value * 100);
const dollars = value => value === null ? null : value / 100;
export function nextBenefitStart(end) {
  if (!end) return null;
  const next = new Date(`${end}T12:00:00Z`); next.setUTCDate(next.getUTCDate() + 1); return next.toISOString().slice(0, 10);
}
function nextBenefitEnd(end) {
  const start = new Date(`${nextBenefitStart(end)}T12:00:00Z`);
  start.setUTCFullYear(start.getUTCFullYear() + 1); start.setUTCDate(start.getUTCDate() - 1); return start.toISOString().slice(0, 10);
}

export function calculateCosts(raw) {
  const state = financialSchema.parse(raw); const plan = state.plan;
  const nextStart = nextBenefitStart(plan.benefitYearEnd);
  const buckets = new Map();
  const warnings = new Set();
  const ordered = [], visited = new Set();
  function visit(id) { if (visited.has(id)) return; visited.add(id); const p = state.procedures.find(p => p.id === id); for (const parent of p.dependsOn) visit(parent); ordered.push(p); }
  for (const p of state.procedures) visit(p.id);
  const order = new Map(ordered.map((p, i) => [p.id, i]));
  const rows = [...state.procedures].sort((a, b) => (a.date || '').localeCompare(b.date || '') || order.get(a.id) - order.get(b.id)).map(p => {
    const gaps = []; const assumptions = [];
    if (state.procedures.length > 1 && state.procedures.some(item => !item.date)) assumptions.push('Treatments without dates are counted first, in listed order. The order can change which treatment uses the amount you pay first.');
    let period = 'current';
    if (p.date && plan.benefitYearStart && p.date < plan.benefitYearStart) gaps.push('The treatment date is before the yearly plan dates you supplied.');
    if (p.date && nextStart && p.date >= nextStart) {
      period = 'next';
      if (p.date > nextBenefitEnd(plan.benefitYearEnd)) gaps.push('We can compare this plan year and the next one only.');
      if (!plan.renewalConfirmed) assumptions.push('This assumes next year’s plan keeps the coverage rules shown.');
      if (!p.dentistApprovedWindow) assumptions.push('This future date is hypothetical until the dentist approves it.');
    }
    if (p.date && (!plan.benefitYearStart || !plan.benefitYearEnd)) assumptions.push('We don’t yet know when your yearly plan money starts over. This uses the amounts left now.');
    if (p.dentistApprovedWindow && p.date && ((p.earliestDate && p.date < p.earliestDate) || (p.latestDate && p.date > p.latestDate))) gaps.push('Date is outside the dentist-approved window.');
    if (p.date && p.dependsOn.some(id => { const preceding = state.procedures.find(other => other.id === id); return !preceding?.date || preceding.date > p.date; })) gaps.push('A required preceding procedure is not scheduled before this treatment.');
    if (!buckets.has(period)) buckets.set(period, {
      period, deductible: (period === 'current' ? plan.remainingDeductible : plan.nextYearDeductible) === null ? null : cents(period === 'current' ? plan.remainingDeductible : plan.nextYearDeductible),
      benefit: (period === 'current' ? plan.remainingBenefit : plan.nextYearAnnualMaximum) === null ? null : cents(period === 'current' ? plan.remainingBenefit : plan.nextYearAnnualMaximum),
      insurancePaid: 0, blocked: false,
    });
    const bucket = buckets.get(period);
    const base = { id: p.id, name: p.name, date: p.date, period, quoteType: p.quoteType, quotedFee: p.quote, clinicPatientEstimate: p.clinicPatientEstimate ?? (p.quoteType === 'patient_estimate' ? p.quote : null), eligibleFee: null, deductible: null, insurancePercent: p.insurancePercent, insurerPays: null, patientPays: null, benefitCapApplied: false, assumptions, gaps };
    if (p.quote === null) gaps.push('Enter the dentist’s quote for this procedure.');
    if (p.quoteType === 'unknown') gaps.push('Confirm whether the quote is the full fee or an after-insurance patient estimate.');
    if (gaps.length) { bucket.blocked = true; return { ...base, status: 'incomplete' }; }
    if (p.quoteType === 'patient_estimate') {
      assumptions.push('This is the clinic’s estimate of your share after insurance. Your plan’s payment is not yet known.');
      bucket.blocked = true;
      return { ...base, patientPays: p.quote, status: 'clinic_estimate' };
    }
    const fee = cents(p.quote);
    if (p.covered === false) return { ...base, eligibleFee: 0, deductible: 0, insurerPays: 0, patientPays: dollars(fee), status: assumptions.length ? 'conditional' : 'estimate' };
    if (p.covered === null) gaps.push('Confirm that this specific procedure is covered.');
    if (p.insurancePercent === null) gaps.push('Enter the insurer’s payment percentage for this procedure.');
    if (p.deductibleApplies === null) gaps.push('Check whether you pay an amount yourself before your plan helps with this treatment.');
    if (p.deductibleApplies && bucket.deductible === null) gaps.push('How much do you still need to pay yourself before your plan starts helping?');
    if (bucket.blocked) gaps.push('We need an earlier treatment’s plan payment before working out how much plan money is left for this one.');
    if (p.feeBasis === 'allowed_amount' && p.allowedAmount === null) gaps.push('What price does your plan use to work out its share for this treatment?');
    if (gaps.length) { bucket.blocked = true; return { ...base, status: 'incomplete' }; }
    let eligible = fee;
    if (p.allowedAmount !== null) eligible = Math.min(fee, cents(p.allowedAmount));
    else if (p.feeBasis === 'unknown') assumptions.push('This assumes your plan uses the full dentist’s price. Check whether it uses a different agreed price.');
    if (p.network === 'unknown') assumptions.push('Check whether your dentist has agreed prices with your plan.');
    const deductible = p.deductibleApplies ? Math.min(eligible, bucket.deductible) : 0;
    if (p.deductibleApplies) bucket.deductible -= deductible;
    const beforeCap = Math.round((eligible - deductible) * p.insurancePercent / 100);
    if (bucket.benefit === null) assumptions.push('We don’t know how much your plan can still pay this year. A yearly limit could reduce its payment.');
    const insurer = bucket.benefit === null ? beforeCap : Math.min(beforeCap, bucket.benefit);
    if (bucket.benefit !== null) bucket.benefit -= insurer;
    bucket.insurancePaid += insurer;
    // An in-network contracted fee replaces the billed fee when supplied. Out-of-network fees can leave a balance above the allowable fee.
    const payable = p.network === 'in' && p.allowedAmount !== null ? eligible : fee;
    return { ...base, eligibleFee: dollars(eligible), deductible: dollars(deductible), insurerPays: dollars(insurer), patientPays: dollars(Math.max(0, payable - insurer)), benefitCapApplied: insurer < beforeCap, status: assumptions.length ? 'conditional' : 'estimate' };
  });
  for (const row of rows) for (const warning of [...row.assumptions, ...row.gaps]) warnings.add(warning);
  const complete = rows.length > 0 && rows.every(row => row.patientPays !== null);
  return {
    currency: state.currency, rows, totalPatientPays: complete ? dollars(rows.reduce((sum, row) => sum + cents(row.patientPays), 0)) : null,
    totalInsurerPays: rows.length && rows.every(row => row.insurerPays !== null) ? dollars(rows.reduce((sum, row) => sum + cents(row.insurerPays), 0)) : null,
    status: !complete ? 'incomplete' : rows.some(row => row.status !== 'estimate') ? 'conditional' : 'estimate',
    benefitUsage: [...buckets.values()].map(b => ({ period: b.period, plannedInsurerPayment: dollars(b.insurancePaid), remainingBenefit: b.blocked ? null : dollars(b.benefit), remainingDeductible: b.blocked ? null : dollars(b.deductible), incomplete: b.blocked })),
    warnings: [...warnings],
  };
}

export function optimizeSchedule(raw) {
  const state = financialSchema.parse(raw); const original = calculateCosts(state);
  const next = nextBenefitStart(state.plan.benefitYearEnd);
  const unavailable = reason => ({ available: false, reason, evaluated: 0, original, best: null, savings: null, dates: [] });
  if (!next || !state.plan.benefitYearStart || state.plan.nextYearAnnualMaximum === null || state.plan.nextYearDeductible === null || !state.plan.renewalConfirmed) return unavailable('Before comparing dates, check when your plan money starts over, how much it pays next year, and the amount you pay first.');
  if (!state.procedures.length || state.procedures.some(p => !p.date || !p.earliestDate || !p.latestDate || !p.dentistApprovedWindow || p.quoteType !== 'total_fee')) return unavailable('Each treatment needs a full-fee quote, original date, and dentist-approved earliest/latest dates.');
  if (original.status !== 'estimate') return unavailable('Check the missing plan and price details before choosing dates based on cost.');
  // Evaluate original and earliest supported dates in each of two benefit years. Amounts do not vary within a benefit year.
  const candidates = state.procedures.map(p => [...new Set([p.date, p.earliestDate, p.earliestDate > next ? p.earliestDate : next])].filter(d => d >= p.earliestDate && d <= p.latestDate && d >= state.plan.benefitYearStart && d <= nextBenefitEnd(state.plan.benefitYearEnd)));
  let best = original, dates = state.procedures.map(p => ({ id: p.id, date: p.date })), evaluated = 0;
  function visit(index, procedures) {
    if (index < state.procedures.length) { for (const date of candidates[index]) visit(index + 1, [...procedures, { ...state.procedures[index], date }]); return; }
    // Dependencies can require a later date within the same benefit year.
    const adjusted = procedures.map(p => ({ ...p }));
    for (let pass = 0; pass < adjusted.length; pass++) for (const p of adjusted) for (const id of p.dependsOn) { const parent = adjusted.find(t => t.id === id); if (parent.date > p.date) p.date = parent.date; }
    if (adjusted.some(p => p.date > p.latestDate)) return;
    const result = calculateCosts({ ...state, procedures: adjusted });
    if (result.status !== 'estimate') return;
    evaluated++;
    if (result.totalPatientPays < best.totalPatientPays) { best = result; dates = adjusted.map(p => ({ id: p.id, date: p.date })); }
  }
  visit(0, []);
  return { available: true, reason: 'These dentist-approved dates have the lowest estimated cost among the dates compared, using the next-year plan details you confirmed.', evaluated, original, best, savings: dollars(cents(original.totalPatientPays) - cents(best.totalPatientPays)), dates };
}

export function estimate(raw) {
  const { state, budget: suppliedBudget } = estimateRequestSchema.parse(raw);
  const budget = suppliedBudget === undefined ? state.budget ?? null : suppliedBudget;
  const calculation = calculateCosts(state);
  const optimization = optimizeSchedule(state);
  return { state, calculation, optimization, budget, withinBudget: budget !== null && calculation.totalPatientPays !== null ? calculation.totalPatientPays <= budget : null };
}
