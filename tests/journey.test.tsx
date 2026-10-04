import { JSDOM } from 'jsdom';
import React, { useState } from 'react';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';

const dom = new JSDOM('<!doctype html><html lang="en"><body></body></html>', { url: 'http://localhost:5173' });
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLDialogElement', 'HTMLInputElement', 'Node', 'File', 'FileReader', 'MutationObserver']) Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
globalThis.requestAnimationFrame = callback => setTimeout(callback, 0);
globalThis.cancelAnimationFrame = clearTimeout;
window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
window.scrollTo = () => {};
HTMLElement.prototype.scrollTo = () => {};
HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { render, screen, fireEvent, waitFor, cleanup, act } = await import('@testing-library/react');
const { Consultation } = await import('../src/Consultation');
const { FreeResponse } = await import('../src/FreeResponse');
const { FinancialWorkspace } = await import('../src/FinancialWorkspace');
const { financialSchema } = await import('../src/financeApi');
const { estimate } = await import('../server/finance.mjs');
const originalFetch = globalThis.fetch;
afterEach(() => { cleanup(); globalThis.fetch = originalFetch; delete window.SpeechRecognition; });

const question = { id: 'question-1', kind: 'question', topic: 'Your care', title: 'Do you have a treatment planned?', context: 'A little context helps.', choices: ['Yes', 'No', 'Not sure'], facts: [], actions: [], uncertainties: [] };
const documentTurn = { ...question, id: 'document-1', kind: 'document', topic: 'Your insurance', title: 'Do you have your plan handy?' };
const ready = { ...question, id: 'plan-1', kind: 'ready', title: 'Your next clear steps', context: 'Start by confirming your benefits.', choices: [], facts: [{ label: 'Goal', value: 'Understand insurance', basis: 'user', evidence: 'Understand insurance' }], actions: ['Call your insurer before treatment.'], uncertainties: ['Your remaining deductible is unknown.'] };
const json = value => new Response(JSON.stringify(value), { status: 200 });
const props = { open: true, closing: false, goal: 'insurance', explanation: '', onRequestClose() {}, onClosed() {} };
const financialFixture = () => financialSchema.parse({ currency: 'USD', plan: { remainingDeductible: 50, remainingBenefit: 100, annualMaximum: 1500, annualDeductible: 50, benefitYearStart: '2026-07-01', benefitYearEnd: '2027-06-30', nextYearAnnualMaximum: 1500, nextYearDeductible: 50, renewalConfirmed: true }, procedures: [{ id: 'crown', name: 'Crown', code: 'D2740', quote: 1200, quoteType: 'total_fee', allowedAmount: null, insurancePercent: 50, covered: true, deductibleApplies: true, network: 'in', feeBasis: 'quoted_fee', date: '2027-06-15', earliestDate: '2027-06-15', latestDate: '2027-08-01', dentistApprovedWindow: true, dependsOn: [] }] });

test('quote confirmation displays deterministic costs, clears stale results on edits and preserves net clinic estimates', async () => {
  const requests = [];
  globalThis.fetch = async (_url, options) => { const payload = JSON.parse(options.body); requests.push(payload); return json(estimate(payload)); };
  const confirmations = [];
  render(<FinancialWorkspace initial={financialFixture()} onConfirm={(state, result) => confirmations.push([state, result])} onAsk={() => {}} />);
  assert.equal(screen.getByRole('button', { name: 'Calculate my personal cost' }).disabled, true);
  fireEvent.click(screen.getByLabelText(/I’ve checked these details/));
  fireEvent.click(screen.getByRole('button', { name: 'Calculate my personal cost' }));
  await waitFor(() => assert.ok(screen.getAllByText('$1,100.00').length));
  assert.equal(confirmations.at(-1)[1].calculation.totalPatientPays, 1100);
  fireEvent.click(screen.getByText('Change your quote or coverage inputs'));
  fireEvent.change(screen.getByLabelText('What does this amount represent?'), { target: { value: 'patient_estimate' } });
  fireEvent.change(screen.getByLabelText('Dentist quote for Crown (USD)'), { target: { value: '625' } });
  assert.equal(screen.queryByText('You may pay'), null);
  assert.equal(confirmations.at(-1)[0], null);
  fireEvent.click(screen.getByLabelText(/I’ve checked these details/)); fireEvent.click(screen.getByRole('button', { name: 'Calculate my personal cost' }));
  await waitFor(() => assert.ok(screen.getAllByText('$625.00').length));
  assert.equal(requests.at(-1).state.procedures[0].quoteType, 'patient_estimate');
  assert.equal(confirmations.at(-1)[1].calculation.totalInsurerPays, null);
});

test('moving a treatment date after confirmation immediately recalculates and sends actual figures to Bili', async () => {
  const requests = []; const followups = [];
  globalThis.fetch = async (_url, options) => { const payload = JSON.parse(options.body); requests.push(payload); return json(estimate(payload)); };
  render(<FinancialWorkspace initial={financialFixture()} onConfirm={() => {}} onAsk={(...args) => followups.push(args)} />);
  fireEvent.click(screen.getByLabelText(/I’ve checked these details/)); fireEvent.click(screen.getByRole('button', { name: 'Calculate my personal cost' }));
  await waitFor(() => assert.equal(requests.length, 1));
  await waitFor(() => assert.ok(screen.getAllByText('You may pay').length));
  fireEvent.click(screen.getByRole('tab', { name: 'Treatment dates' }));
  fireEvent.change(screen.getByLabelText('Planned date for Crown'), { target: { value: '2027-07-01' } });
  await waitFor(() => assert.equal(requests.length, 2));
  await waitFor(() => assert.ok(screen.getAllByText('$625.00').length));
  assert.equal(requests[1].state.procedures[0].date, '2027-07-01');
  fireEvent.change(screen.getByLabelText('Tell Bili a correction, quote, or question'), { target: { value: 'Why did the cost change?' } });
  fireEvent.click(screen.getByRole('button', { name: 'Continue with Bili' }));
  assert.equal(followups[0][0], 'Why did the cost change?'); assert.equal(followups[0][1].procedures[0].date, '2027-07-01');
});

test('insurance documents and clinic bills remain attached together for AI extraction', async () => {
  const requests = [];
  globalThis.fetch = async (_url, options) => { const payload = JSON.parse(options.body); requests.push(payload); return json({ ...documentTurn, id: `doc-${requests.length}`, title: requests.length < 2 ? 'Upload coverage?' : 'Upload clinic bill?', documentPurpose: requests.length < 2 ? 'insurance' : 'bill' }); };
  render(<Consultation {...props} />);
  await screen.findByRole('heading', { name: 'Upload coverage?' });
  fireEvent.change(screen.getByLabelText('Upload your insurance card or plan'), { target: { files: [new File(['%PDF-1.7 coverage'], 'coverage.pdf', { type: 'application/pdf' })] } });
  await screen.findByText('coverage.pdf'); fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  await screen.findByRole('heading', { name: 'Upload clinic bill?' });
  fireEvent.change(screen.getByLabelText('Upload your dentist bill or estimate'), { target: { files: [new File(['%PDF-1.7 clinic quote'], 'quote.pdf', { type: 'application/pdf' })] } });
  await screen.findByText('quote.pdf'); fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  await waitFor(() => assert.equal(requests.length, 3));
  assert.deepEqual(requests[2].documents.map(doc => doc.name), ['coverage.pdf', 'quote.pdf']);
});

test('coverage checkpoint shows captured and missing details, accepts corrections, and continues to bill intake', async () => {
  const requests = [];
  const checkpoint = { ...question, id: 'recap', kind: 'review', title: 'Here’s what we know so far.', choices: ['Looks right, continue', 'I need to change something'], facts: [{ label: 'Your plan', value: 'Test Dental', basis: 'document', evidence: 'Provider: Test Dental' }], uncertainties: ['How much your plan can still pay this year'] };
  const bill = { ...question, id: 'bill', title: 'Do you have a bill or price estimate from your dentist?', choices: ['Yes, I can upload it', 'I’ll type or speak it', 'Not yet'], documentPurpose: 'bill' };
  globalThis.fetch = async (_url, options) => { const payload = JSON.parse(options.body); requests.push(payload); return json(requests.length === 1 ? checkpoint : bill); };
  render(<Consultation {...props} />);
  await screen.findByRole('heading', { name: checkpoint.title });
  assert.ok(screen.getByText('Test Dental')); assert.ok(screen.getByText('Still to check'));
  fireEvent.click(screen.getByRole('button', { name: 'Edit', exact: true }));
  assert.ok(screen.getByRole('textbox').value.includes('Your plan'));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'My plan name is Test Dental Plus.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Update and continue' }));
  await screen.findByRole('heading', { name: bill.title });
  assert.equal(requests[1].answers.at(-1).text, 'My plan name is Test Dental Plus.');
  assert.equal(requests[1].financialState, null, 'A checkpoint does not silently confirm financial inputs');
  assert.ok(screen.getByLabelText('Upload your dentist bill or estimate'));
});

test('uploads are available on regular questions and insurance-only results do not force an empty calculator', async () => {
  const requests = [];
  globalThis.fetch = async (_url, options) => { const payload = JSON.parse(options.body); requests.push(payload); return json(requests.length === 1 ? question : ready); };
  render(<Consultation {...props} />);
  await screen.findByRole('heading', { name: question.title });
  fireEvent.change(screen.getByLabelText('Upload your dentist bill or estimate'), { target: { files: [new File(['%PDF-1.7 bill'], 'bill.pdf', { type: 'application/pdf' })] } });
  await screen.findByText('bill.pdf'); fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  await screen.findByRole('heading', { name: ready.title });
  await screen.findByRole('heading', { name: ready.title });
  assert.equal(requests[1].document.name, 'bill.pdf');
  assert.equal(screen.queryByRole('tab', { name: 'Your quote' }), null);
  assert.ok(screen.getByLabelText('Ask Bili about your insurance'));
});

test('AI-extracted price corrections invalidate confirmed inputs until the revised draft is reviewed', async () => {
  const state = financialFixture(); const updated = structuredClone(state); updated.procedures[0].quote = 1400;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    const payload = JSON.parse(options.body);
    if (String(url).endsWith('/estimate')) return json(estimate(payload));
    requests.push(payload);
    return json(requests.length === 2 ? { ...question, id: 'price-review', kind: 'review', title: 'Check your updated price.', choices: ['Looks right, continue'], financialProposal: updated } : { ...ready, financialProposal: requests.length === 1 ? state : updated });
  };
  render(<Consultation {...props} />);
  await screen.findByRole('button', { name: 'Calculate my personal cost' });
  fireEvent.click(screen.getByLabelText(/checked these details/)); fireEvent.click(screen.getByRole('button', { name: 'Calculate my personal cost' }));
  await waitFor(() => assert.ok(screen.getAllByText('$1,100.00').length));
  fireEvent.change(screen.getByLabelText('Tell Bili a correction, quote, or question'), { target: { value: 'My dentist corrected the full crown price to $1,400.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Continue with Bili' }));
  await screen.findByRole('heading', { name: 'Check your updated price.' });
  assert.equal(requests[1].financialState.procedures[0].quote, 1200);
  fireEvent.click(screen.getByRole('button', { name: 'Looks right, continue' }));
  await screen.findByRole('button', { name: 'Calculate my personal cost' });
  assert.equal(requests[2].financialState, null);
  assert.equal(requests[2].financialDraft.procedures[0].quote, 1400);
  assert.equal(screen.getByRole('button', { name: 'Calculate my personal cost' }).disabled, true);
});

test('adaptive journey supports typed answers, file intake, review, edits and resume', async () => {
  const requests = [];
  globalThis.fetch = async (_url, options) => {
    const payload = JSON.parse(options.body); requests.push(payload);
    return json(payload.answers.length === 1 ? question : payload.answers.length === 2 ? documentTurn : ready);
  };
  const view = render(<Consultation {...props} />);
  await screen.findByRole('heading', { name: question.title });
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  assert.ok(screen.getByRole('alert').textContent.includes('Choose'));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'A crown is planned.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  await screen.findByRole('heading', { name: documentTurn.title });
  assert.equal(requests[1].answers[1].text, 'A crown is planned.');
  const file = new File(['%PDF-1.7\nSynthetic coverage plan'], 'benefits.pdf', { type: 'application/pdf' });
  fireEvent.change(screen.getByLabelText('Upload your insurance card or plan'), { target: { files: [file] } });
  await screen.findByText('benefits.pdf');
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  assert.equal(requests[2].document.mimeType, 'application/pdf');
  await screen.findByRole('heading', { name: ready.title });
  assert.ok(screen.getByText('Call your insurer before treatment.'));
  view.rerender(<Consultation {...props} open={false} />);
  view.rerender(<Consultation {...props} />);
  await screen.findByRole('heading', { name: ready.title });
  assert.equal(requests.length, 3, 'Reopening must not spend another API call');
  fireEvent.click(screen.getByRole('button', { name: 'Review my answers' }));
  await screen.findByRole('heading', { name: /Does this sound/ });
  fireEvent.click(screen.getAllByRole('button', { name: 'Edit', exact: true })[0]);
  await screen.findByRole('heading', { name: question.title });
  assert.equal(screen.getByRole('textbox').value, 'A crown is planned.');
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Actually, a filling is planned.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  await screen.findByRole('heading', { name: documentTurn.title });
  assert.equal(requests[3].answers.length, 2, 'Editing must discard later answers');
  assert.equal(requests[3].answers[1].text, 'Actually, a filling is planned.');
});

test('provider failure can retry the same answer without duplicating history', async () => {
  let calls = 0;
  globalThis.fetch = async () => ++calls === 1 ? new Response(JSON.stringify({ message: 'Quota reached. Retry later.' }), { status: 429 }) : json(question);
  render(<Consultation {...props} />);
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await screen.findByRole('heading', { name: question.title });
  assert.equal(calls, 2);
});

test('empty, HTML, malformed and invalid responses show helpful errors instead of crashing', async () => {
  for (const response of [new Response('', { status: 500 }), new Response('<html>Wrong server</html>'), new Response('{broken'), json({ id: 'bad', kind: 'question' })]) {
    globalThis.fetch = async () => response;
    render(<Consultation {...props} />);
    const alert = await screen.findByRole('alert');
    assert.ok(alert.textContent.includes('Your answers are still here'));
    assert.ok(!alert.textContent.includes('JSON'));
    assert.ok(screen.getByRole('button', { name: 'Retry' }));
    cleanup();
  }
});

test('users can ask for an early plan and cannot upload an oversized file', async () => {
  const requests = [];
  globalThis.fetch = async (_url, options) => { const payload = JSON.parse(options.body); requests.push(payload); return json(payload.mode === 'summary' ? ready : documentTurn); };
  render(<Consultation {...props} />);
  await screen.findByRole('heading', { name: documentTurn.title });
  const big = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'big.pdf', { type: 'application/pdf' });
  fireEvent.change(screen.getByLabelText('Upload your insurance card or plan'), { target: { files: [big] } });
  assert.ok(screen.getByRole('alert').textContent.includes('10 MB'));
  fireEvent.click(screen.getByRole('button', { name: /Make a plan with/ }));
  await screen.findByRole('heading', { name: ready.title });
  assert.equal(requests[1].mode, 'summary'); assert.equal(requests[1].document, null);
});

test('voice appends final transcripts, handles denied permission and aborts on unmount', async () => {
  let recognizer;
  class FakeRecognition {
    constructor() { recognizer = this; } start() {} stop() { this.onend?.(); } abort() { this.aborted = true; }
  }
  window.SpeechRecognition = FakeRecognition;
  function Input() { const [value, setValue] = useState('My plan:'); return <FreeResponse id="speech" label="Your answer" placeholder="Type" value={value} onChange={setValue} />; }
  const view = render(<Input />);
  fireEvent.click(screen.getByRole('button', { name: 'Use my voice' }));
  act(() => recognizer.onresult({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: 'covers cleanings' } }] }));
  assert.equal(screen.getByRole('textbox').value, 'My plan: covers cleanings');
  fireEvent.click(screen.getByRole('button', { name: 'Stop dictation' }));
  fireEvent.click(screen.getByRole('button', { name: 'Use my voice' }));
  act(() => { recognizer.onerror({ error: 'not-allowed' }); recognizer.onend(); });
  assert.ok(screen.getByRole('status').textContent.includes('denied'));
  fireEvent.click(screen.getByRole('button', { name: 'Use my voice' }));
  view.unmount(); assert.equal(recognizer.aborted, true);
});
