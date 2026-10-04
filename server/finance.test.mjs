import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateCosts, estimate, financialSchema, optimizeSchedule } from './finance.mjs';
import { consult } from './consultation.mjs';
import { createApp } from './index.mjs';

export const fixture = () => ({ currency: 'USD', plan: { remainingDeductible: 50, remainingBenefit: 1000, annualMaximum: 1500, annualDeductible: 50, benefitYearStart: '2026-07-01', benefitYearEnd: '2027-06-30', nextYearAnnualMaximum: 1500, nextYearDeductible: 50, renewalConfirmed: true }, procedures: [{ id: 'crown', name: 'Crown', code: 'D2740', quote: 1200, quoteType: 'total_fee', allowedAmount: null, insurancePercent: 50, covered: true, deductibleApplies: true, network: 'in', feeBasis: 'quoted_fee', date: '2027-06-15', earliestDate: '2027-06-15', latestDate: '2027-08-01', dentistApprovedWindow: true, dependsOn: [] }] });

test('quoted fee deducts the remaining deductible before applying insurer percentage', () => {
  const result = calculateCosts(fixture());
  assert.equal(result.status, 'estimate'); assert.equal(result.totalPatientPays, 625); assert.equal(result.totalInsurerPays, 575);
  assert.equal(result.rows[0].deductible, 50); assert.equal(result.benefitUsage[0].remainingBenefit, 425);
  assert.equal(estimate({ state: fixture(), budget: 700 }).withinBudget, true);
});
test('annual cap, zero balances, noncovered care and waived deductibles are respected', () => {
  const state = fixture(); state.plan.remainingBenefit = 100;
  let result = calculateCosts(state); assert.equal(result.totalInsurerPays, 100); assert.equal(result.totalPatientPays, 1100); assert.equal(result.rows[0].benefitCapApplied, true);
  state.plan.remainingBenefit = 0; state.plan.remainingDeductible = 0;
  result = calculateCosts(state); assert.equal(result.totalPatientPays, 1200); assert.equal(result.totalInsurerPays, 0);
  state.procedures[0].covered = false; state.procedures[0].insurancePercent = null;
  assert.equal(calculateCosts(state).totalPatientPays, 1200);
  state.procedures[0].covered = true; state.procedures[0].insurancePercent = 100; state.procedures[0].deductibleApplies = false; state.plan.remainingBenefit = 1500; state.plan.remainingDeductible = null;
  assert.equal(calculateCosts(state).totalPatientPays, 0);
});
test('clinic patient estimates are preserved without subtracting insurance twice', () => {
  const state = fixture(); state.procedures[0].quoteType = 'patient_estimate'; state.procedures[0].quote = 625;
  const result = calculateCosts(state); assert.equal(result.totalPatientPays, 625); assert.equal(result.totalInsurerPays, null); assert.equal(result.rows[0].status, 'clinic_estimate'); assert.equal(result.benefitUsage[0].remainingBenefit, null);
});
test('a bill containing full fee and net patient estimate retains both without changing the fee calculation', () => {
  const state = fixture(); state.procedures[0].clinicPatientEstimate = 650;
  const result = calculateCosts(state); assert.equal(result.totalPatientPays, 625); assert.equal(result.rows[0].quotedFee, 1200); assert.equal(result.rows[0].clinicPatientEstimate, 650);
});
test('allowable fees distinguish contracted in-network fees from out-of-network balance billing', () => {
  const state = fixture(); state.procedures[0].quote = 1500; state.procedures[0].allowedAmount = 1000; state.procedures[0].feeBasis = 'allowed_amount';
  let result = calculateCosts(state); assert.equal(result.totalInsurerPays, 475); assert.equal(result.totalPatientPays, 525);
  state.procedures[0].network = 'out'; result = calculateCosts(state); assert.equal(result.totalInsurerPays, 475); assert.equal(result.totalPatientPays, 1025);
});
test('unknowns remain incomplete or explicitly conditional, never zero or silently unlimited', () => {
  const state = fixture(); state.plan.remainingDeductible = null;
  assert.equal(calculateCosts(state).totalPatientPays, null);
  state.plan.remainingDeductible = 50; state.plan.remainingBenefit = null; state.procedures[0].feeBasis = 'unknown';
  const result = calculateCosts(state); assert.equal(result.status, 'conditional'); assert.ok(result.warnings.some(w => w.includes('yearly limit could reduce'))); assert.ok(result.warnings.some(w => w.includes('different agreed price')));
  assert.equal(optimizeSchedule(state).available, false);
});
test('sequential procedures consume one deductible and share the same annual benefit balance', () => {
  const state = fixture(); state.procedures.push({ ...state.procedures[0], id: 'second', quote: 1200, date: '2027-06-16', dependsOn: ['crown'] });
  const result = calculateCosts(state); assert.equal(result.rows[1].deductible, 0); assert.equal(result.rows[1].insurerPays, 425); assert.equal(result.totalInsurerPays, 1000); assert.equal(result.totalPatientPays, 1400);
});
test('optimizer respects a non-calendar reset, approved windows and renewal assumptions', () => {
  const state = fixture(); state.plan.remainingBenefit = 100; state.plan.remainingDeductible = 0; state.procedures[0].quote = 2000;
  const result = optimizeSchedule(state); assert.equal(result.available, true); assert.equal(result.original.totalPatientPays, 1900); assert.equal(result.best.totalPatientPays, 1025); assert.equal(result.savings, 875); assert.equal(result.dates[0].date, '2027-07-01');
  state.procedures[0].dentistApprovedWindow = false; assert.equal(optimizeSchedule(state).available, false);
  state.procedures[0].dentistApprovedWindow = true; state.plan.renewalConfirmed = false; assert.equal(optimizeSchedule(state).available, false);
  state.plan.renewalConfirmed = true; state.procedures[0].latestDate = '2027-06-30'; assert.equal(optimizeSchedule(state).savings, 0);
});
test('invalid dates, contradictory balances, duplicate IDs and cyclic dependencies cannot reach calculation', () => {
  const state = fixture(); state.procedures[0].date = '2027-02-30'; assert.equal(financialSchema.safeParse(state).success, false);
  state.procedures[0].date = '2027-06-15'; state.plan.remainingBenefit = 2000; assert.equal(financialSchema.safeParse(state).success, false);
  state.plan.remainingBenefit = 1000; state.procedures.push({ ...state.procedures[0] }); assert.equal(financialSchema.safeParse(state).success, false);
  state.procedures[1].id = 'second'; state.procedures[0].dependsOn = ['second']; state.procedures[1].dependsOn = ['crown']; assert.equal(financialSchema.safeParse(state).success, false);
  const fractional = fixture(); fractional.procedures[0].quote = 0.005; assert.equal(financialSchema.safeParse(fractional).success, false);
});
test('changed dates replace previous calculations and outside-window dates cannot become optimized results', () => {
  const state = fixture(); state.plan.remainingBenefit = 100;
  const first = calculateCosts(state); state.procedures[0].date = '2027-07-01'; const next = calculateCosts(state);
  assert.notEqual(first.totalPatientPays, next.totalPatientPays); assert.equal(next.rows[0].period, 'next');
  state.procedures[0].date = '2027-08-15'; assert.equal(calculateCosts(state).status, 'incomplete');
});
test('confirmed financial state is recalculated server-side and supplied to Bili, not accepted as model-generated math', async () => {
  const state = fixture(); const request = { answers: [{ id: 'start', prompt: 'Goal?', choice: 'Explain my estimate', text: '' }], document: null, mode: 'next', financialState: state };
  await consult(request, { apiKey: 'test', fetchImpl: async (_url, options) => {
    const context = JSON.parse(JSON.parse(options.body).contents[0].parts[0].text).runtimeContext;
    assert.equal(context.latestCalculation.totalPatientPays, 625); assert.deepEqual(context.validatedFinancialState, state);
    const turn = { kind: 'ready', topic: 'Costs', title: 'Your cost breakdown', context: 'The deductible is applied before the insurer percentage.', choices: [], facts: [], actions: [], uncertainties: [], financialProposal: state };
    return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(turn) }] } }] }));
  } });
});
test('estimate API validates inputs and removed clinic lookup is unavailable', async t => {
  const server = createApp();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, value) => fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
  const result = await post('/api/estimate', { state: fixture() }); assert.equal(result.status, 200); assert.equal((await result.json()).calculation.totalPatientPays, 625);
  assert.equal((await post('/api/estimate', { state: { currency: 'USD' } })).status, 400);
  const failed = await post('/api/clinics', { location: 'Greensboro NC', procedure: 'Crown' }); assert.equal(failed.status, 404); assert.ok(!(await failed.text()).includes('Private provider diagnostic'));
});
