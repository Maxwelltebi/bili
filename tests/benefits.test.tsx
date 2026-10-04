import { JSDOM } from 'jsdom';
import React from 'react';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost:5173' });
for (const key of ['window', 'document', 'navigator', 'localStorage', 'HTMLElement', 'HTMLDialogElement', 'HTMLInputElement', 'Node', 'MutationObserver']) Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
globalThis.requestAnimationFrame = callback => setTimeout(callback, 0);
globalThis.cancelAnimationFrame = clearTimeout;
window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} }) as MediaQueryList;
window.scrollTo = () => {}; HTMLElement.prototype.scrollTo = () => {};
HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { render, screen, fireEvent, waitFor, cleanup, within } = await import('@testing-library/react');
const { BenefitsPage } = await import('../src/BenefitsPage');
const { App } = await import('../src/App');
const { createBenefits, usage, normalizeBenefits, reminderDue, calendarReminder, localToday } = await import('../src/benefits');
const { compareNetworks } = await import('../server/benefits.mjs');
const { estimate } = await import('../server/finance.mjs');
const originalFetch = globalThis.fetch;
afterEach(() => { cleanup(); globalThis.fetch = originalFetch; localStorage.clear(); });
const year = localToday().slice(0, 4);
const state = () => ({ currency: 'USD' as const, plan: { remainingDeductible: 50, remainingBenefit: 1000, annualMaximum: 1500, annualDeductible: 50, benefitYearStart: `${year}-01-01`, benefitYearEnd: `${year}-12-31`, nextYearAnnualMaximum: 1500, nextYearDeductible: 50, renewalConfirmed: true }, procedures: [] });
const snapshot = benefits => ({ version: 1 as const, goal: '', explanation: '', answers: [], turn: null, history: [], financialState: null, financialDraft: null, documentNames: [], benefits });

test('paid claims update actual balances; editing and deleting restore benefits and deductible correctly', async () => {
  let saved;
  render(<BenefitsPage snapshot={snapshot(createBenefits(state()))} onChange={value => { saved = value; }} onConsult={() => {}} />);
  fireEvent.change(screen.getByLabelText('Treatment or claim name'), { target: { value: 'Cleaning' } });
  fireEvent.change(screen.getByLabelText('Insurer paid (USD)'), { target: { value: '225' } });
  fireEvent.change(screen.getByLabelText('Applied to your deductible (USD)'), { target: { value: '20' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add paid claim' }));
  assert.equal(usage(saved).remaining, 775); assert.equal(saved.financialState.plan.remainingDeductible, 30);
  fireEvent.click(screen.getByRole('button', { name: 'Edit Cleaning' }));
  fireEvent.change(screen.getByLabelText('Insurer paid (USD)'), { target: { value: '250' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save claim changes' }));
  assert.equal(usage(saved).remaining, 750);
  fireEvent.click(screen.getByRole('button', { name: 'Remove Cleaning' }));
  assert.equal(usage(saved).remaining, 1000); assert.equal(saved.financialState.plan.remainingDeductible, 50);
});
test('unknown balances stay unknown and prior-year claims do not consume the current year', () => {
  const unknown = createBenefits(); unknown.financialState.plan.annualMaximum = 1500;
  assert.equal(usage(unknown).remaining, null); assert.equal(usage(unknown).used, null);
  const data = createBenefits(state()); data.claims = [{ id: 'old', name: 'Past care', date: `${Number(year) - 1}-12-31`, insurerPaid: 700, deductiblePaid: 50 }, { id: 'new', name: 'Current care', date: `${year}-01-02`, insurerPaid: 100, deductiblePaid: 10 }];
  assert.equal(usage(data).remaining, 900); assert.equal(normalizeBenefits(data).financialState.plan.remainingDeductible, 40);
});
test('reminders respect non-calendar years, unknown balances, dismissal, expiry and disabling', () => {
  const data = createBenefits(state()); data.financialState.plan.benefitYearEnd = '2027-06-30';
  assert.equal(reminderDue(data, '2027-06-01'), true); assert.equal(reminderDue(data, '2027-05-01'), false); assert.equal(reminderDue(data, '2027-07-01'), false);
  data.reminders.dismissedYearEnd = '2027-06-30'; assert.equal(reminderDue(data, '2027-06-01'), false);
  data.reminders.dismissedYearEnd = null; data.reminders.enabled = false; assert.equal(reminderDue(data, '2027-06-01'), false);
  data.reminders.enabled = true; data.openingUsed = 1500; assert.equal(reminderDue(data, '2027-06-01'), false);
});
test('calendar export has the chosen date, a display alarm, CRLF, folded lines and no medical details', () => {
  const calendar = calendarReminder('2027-06-30', 30, new Date('2026-10-04T12:00:00Z'));
  assert.ok(calendar.includes('DTSTART;VALUE=DATE:20270531\r\n'));
  assert.ok(calendar.includes('DTEND;VALUE=DATE:20270601\r\n'));
  assert.ok(calendar.includes('BEGIN:VALARM\r\nTRIGGER:PT9H'));
  assert.ok(calendar.split('\r\n').every(line => Buffer.byteLength(line) <= 75));
  assert.ok(!calendar.includes('Crown'));
});
test('network UI compares both reviewed quotes and invalidates an old result when inputs change', async () => {
  const data = createBenefits(state());
  data.financialState.procedures = [{ id: 'crown', name: 'Crown', code: null, quote: 1500, quoteType: 'total_fee', allowedAmount: 1000, insurancePercent: 50, covered: true, deductibleApplies: true, network: 'in', feeBasis: 'allowed_amount', date: null, earliestDate: null, latestDate: null, dentistApprovedWindow: false, dependsOn: [] }];
  const quote = { procedureId: 'crown', quote: 1500, allowedAmount: 1000, insurancePercent: 50, covered: true, deductibleApplies: true };
  data.network = { in: { remainingDeductible: 50, remainingBenefit: 1000, quotes: [quote] }, out: { remainingDeductible: 100, remainingBenefit: 700, quotes: [{ ...quote, insurancePercent: 40 }] } };
  let latest;
  globalThis.fetch = async (_url, options) => Response.json(compareNetworks(JSON.parse(options!.body as string)));
  render(<BenefitsPage initialTab="network" snapshot={snapshot(data)} onChange={value => { latest = value; }} onConsult={() => {}} />);
  assert.equal((screen.getByRole('button', { name: 'Compare network costs' }) as HTMLButtonElement).disabled, true);
  fireEvent.click(screen.getByLabelText(/I checked both quotes/)); fireEvent.click(screen.getByRole('button', { name: 'Compare network costs' }));
  await screen.findByText('$615.00');
  const out = within(screen.getByRole('region', { name: 'Out-of-network inputs' }));
  fireEvent.change(out.getByLabelText('Dentist full-fee quote (USD)'), { target: { value: '1600' } });
  assert.equal(screen.queryByText('$615.00'), null); assert.equal(latest.network.out.quotes[0].quote, 1600);
  fireEvent.click(screen.getByLabelText(/I checked both quotes/)); fireEvent.click(screen.getByRole('button', { name: 'Compare network costs' }));
  await screen.findByText('$715.00');
});
test('care sequencing applies a lower-cost approved next-year date and saves the sequence', async () => {
  const original = state(); original.plan.remainingBenefit = 100; original.plan.remainingDeductible = 0;
  original.procedures = [{ id: 'crown', name: 'Crown', code: null, quote: 2000, quoteType: 'total_fee', allowedAmount: null, insurancePercent: 50, covered: true, deductibleApplies: true, network: 'in', feeBasis: 'quoted_fee', date: `${year}-12-15`, earliestDate: `${year}-12-15`, latestDate: `${Number(year) + 1}-02-01`, dentistApprovedWindow: true, dependsOn: [] }];
  let latest;
  globalThis.fetch = async (_url, options) => Response.json(estimate(JSON.parse(options!.body as string)));
  render(<BenefitsPage initialTab="care" snapshot={snapshot(createBenefits(original))} onChange={value => { latest = value; }} onConsult={() => {}} />);
  fireEvent.click(screen.getByLabelText(/checked these plan details and dates/));
  fireEvent.click(screen.getByRole('button', { name: 'Recalculate and compare dates' }));
  await screen.findByText('$875.00');
  fireEvent.click(screen.getByRole('button', { name: 'Use these approved dates' }));
  await waitFor(() => assert.equal(latest.financialState.procedures[0].date, `${Number(year) + 1}-01-01`));
  assert.equal(latest.claims.length, 0); assert.equal(usage(latest).used, 1400, 'Planned payments must not become paid claims');
});
test('Benefits entry and claims survive an account save and app reload', async () => {
  let persisted = null;
  const profile = { id: 'f82451c4-42bd-4fd0-8f36-ff8a79697e06', name: 'Alex Morgan', email: 'alex@example.com', phone: '', company: 'Demo', createdAt: '2026-10-04' };
  globalThis.fetch = async (url, options) => {
    if (url === '/api/account') return Response.json({ profile, snapshot: persisted, storage: 'supabase', firstVisit: !persisted });
    if (url === '/api/snapshot') { persisted = JSON.parse(options!.body as string); return Response.json(persisted); }
    throw new Error(`Unexpected request: ${url}`);
  };
  const view = render(<App />); await screen.findByRole('button', { name: 'Open navigation menu' });
  fireEvent.click(screen.getByRole('button', { name: 'Open navigation menu' })); fireEvent.click(screen.getByRole('button', { name: 'Benefits', exact: true }));
  await screen.findByRole('heading', { name: 'Your benefits, all year.' });
  fireEvent.change(screen.getByLabelText('Plan year starts'), { target: { value: `${year}-01-01` } }); fireEvent.change(screen.getByLabelText('Plan year ends'), { target: { value: `${year}-12-31` } });
  fireEvent.change(screen.getByLabelText('Annual benefit maximum (USD)'), { target: { value: '1500' } }); fireEvent.change(screen.getByLabelText('Benefits used before tracking (USD)'), { target: { value: '0' } });
  fireEvent.change(screen.getByLabelText('Treatment or claim name'), { target: { value: 'Cleaning' } }); fireEvent.change(screen.getByLabelText('Insurer paid (USD)'), { target: { value: '125' } }); fireEvent.click(screen.getByRole('button', { name: 'Add paid claim' }));
  await waitFor(() => assert.equal(persisted?.benefits?.claims.length, 1));
  view.unmount(); render(<App />); await screen.findByRole('heading', { name: 'Welcome back, Alex.' });
  fireEvent.click(screen.getByRole('button', { name: 'Open navigation menu' })); fireEvent.click(screen.getByRole('button', { name: 'Benefits', exact: true }));
  await screen.findByText('Cleaning'); assert.ok(screen.getByText('$1,375.00'));
});
