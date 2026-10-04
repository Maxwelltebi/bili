import test from 'node:test';
import assert from 'node:assert/strict';
import { compareNetworks, benefitsSchema } from './benefits.mjs';
import { createAccountStore, snapshotSchema } from './account.mjs';
import { createApp } from './index.mjs';

const state = () => ({ currency: 'USD', plan: { remainingDeductible: 50, remainingBenefit: 1000, annualMaximum: 1500, annualDeductible: 50, benefitYearStart: '2026-07-01', benefitYearEnd: '2027-06-30', nextYearAnnualMaximum: 1500, nextYearDeductible: 50, renewalConfirmed: true }, procedures: [{ id: 'crown', name: 'Crown', code: null, quote: 1500, quoteType: 'total_fee', allowedAmount: 1000, insurancePercent: 50, covered: true, deductibleApplies: true, network: 'in', feeBasis: 'allowed_amount', date: '2027-06-15', earliestDate: '2027-06-15', latestDate: '2027-08-01', dentistApprovedWindow: true, dependsOn: [] }] });
const quote = () => ({ procedureId: 'crown', quote: 1500, allowedAmount: 1000, insurancePercent: 50, covered: true, deductibleApplies: true });
const network = () => ({ in: { remainingDeductible: 50, remainingBenefit: 1000, quotes: [quote()] }, out: { remainingDeductible: 100, remainingBenefit: 700, quotes: [{ ...quote(), insurancePercent: 40 }] } });
test('network comparisons use independent coverage, deductibles and balance billing', () => {
  const result = compareNetworks({ state: state(), network: network() });
  assert.equal(result.inNetwork.totalPatientPays, 525);
  assert.equal(result.outOfNetwork.totalPatientPays, 1140);
  assert.equal(result.difference, 615);
  assert.equal(result.outOfNetwork.rows[0].deductible, 100);
});
test('network comparisons preserve missing quotes and never reuse a net patient estimate as a full fee', () => {
  const original = state(); original.procedures[0].quoteType = 'patient_estimate'; original.procedures[0].quote = 625;
  const inputs = network(); inputs.out.quotes = [];
  const result = compareNetworks({ state: original, network: inputs });
  assert.equal(result.inNetwork.totalPatientPays, 525);
  assert.equal(result.outOfNetwork.totalPatientPays, null); assert.equal(result.difference, null);
  inputs.out.quotes = [{ ...quote(), allowedAmount: null }];
  assert.equal(compareNetworks({ state: original, network: inputs }).outOfNetwork.status, 'incomplete');
  inputs.out.remainingBenefit = null;
  inputs.out.quotes = [quote()];
  assert.equal(compareNetworks({ state: original, network: inputs }).difference, null);
});
test('network comparison consumes caps and deductibles across multiple treatments in each scenario', () => {
  const original = state(); original.procedures.push({ ...original.procedures[0], id: 'second', name: 'Second crown', date: '2027-06-16', dependsOn: ['crown'] });
  const inputs = network();
  for (const scenario of Object.values(inputs)) scenario.quotes.push({ ...scenario.quotes[0], procedureId: 'second' });
  const result = compareNetworks({ state: original, network: inputs });
  assert.equal(result.inNetwork.totalInsurerPays, 975); assert.equal(result.inNetwork.totalPatientPays, 1025);
  assert.equal(result.outOfNetwork.totalInsurerPays, 700); assert.equal(result.outOfNetwork.totalPatientPays, 2300);
});
test('benefit tracking saves and reloads through the existing private snapshot without a migration', async () => {
  const benefits = { financialState: state(), confirmed: true, openingUsed: 500, openingDeductible: 50, claims: [{ id: 'claim', name: 'Cleaning', date: '2026-09-01', insurerPaid: 100, deductiblePaid: 0 }], network: network(), reminders: { enabled: true, leadDays: 60, dismissedYearEnd: null } };
  const snapshot = { version: 1, goal: '', explanation: '', answers: [], turn: null, history: [], financialState: null, financialDraft: null, documentNames: [], benefits };
  assert.equal(snapshotSchema.safeParse(snapshot).success, true);
  assert.equal(benefitsSchema.safeParse({ ...benefits, claims: [...benefits.claims, benefits.claims[0]] }).success, false);
  assert.equal(benefitsSchema.safeParse({ ...benefits, claims: [{ ...benefits.claims[0], date: '2026-02-30' }] }).success, false);
  let stored;
  const id = 'f82451c4-42bd-4fd0-8f36-ff8a79697e06';
  const store = createAccountStore({ url: 'https://example.supabase.co', secret: 'sb_secret_test', fetchImpl: async (url, options) => {
    if (options.method === 'POST') { stored = JSON.parse(options.body); return new Response(null, { status: 204 }); }
    return Response.json(String(url).includes('planpilot_profiles') ? [{ id, display_name: 'Alex', email: 'alex@example.com', created_at: '2026-10-04' }] : [stored]);
  } });
  await store.saveSnapshot(id, snapshot);
  const account = await store.bootstrap(id);
  assert.deepEqual(account.snapshot.benefits, benefits);
});
test('network API validates fractional money and unknown procedure IDs', async t => {
  const server = createApp(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/network-estimate`;
  const post = body => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await post({ state: state(), network: network() })).status, 200);
  const invalid = network(); invalid.in.quotes[0].quote = 0.005;
  assert.equal((await post({ state: state(), network: invalid })).status, 400);
  invalid.in.quotes[0].quote = 100; invalid.in.quotes[0].procedureId = 'missing';
  assert.equal((await post({ state: state(), network: invalid })).status, 400);
});
