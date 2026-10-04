import { JSDOM } from 'jsdom';
import React from 'react';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost:5173' });
for (const key of ['window', 'document', 'navigator', 'localStorage', 'HTMLElement', 'HTMLDialogElement', 'HTMLInputElement', 'Node', 'File', 'FileReader', 'MutationObserver']) Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
globalThis.requestAnimationFrame = callback => setTimeout(callback, 0);
globalThis.cancelAnimationFrame = clearTimeout;
window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} }) as MediaQueryList;
window.scrollTo = () => {}; HTMLElement.prototype.scrollTo = () => {};
HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { render, screen, fireEvent, waitFor, cleanup, configure, within, act } = await import('@testing-library/react');
configure({ getElementError: message => new Error(message || 'Element not found') });
const { App } = await import('../src/App');
const { Consultation } = await import('../src/Consultation');
const { loadAccount, cacheAccount } = await import('../src/accountApi');
const originalFetch = globalThis.fetch;
afterEach(() => { cleanup(); globalThis.fetch = originalFetch; localStorage.clear(); });
const profile = { id: 'f82451c4-42bd-4fd0-8f36-ff8a79697e06', name: 'Alex Morgan', email: 'alex.morgan@example.com', phone: '', company: 'Example Company', createdAt: '2026-10-04T00:00:00.000Z' };
const ready = { id: 'ready', kind: 'ready', topic: 'Your insurance', title: 'Your plan, made clearer.', context: 'Here is what we know.', choices: [], facts: [{ label: 'Your insurer', value: 'Test Dental', basis: 'user', evidence: 'Test Dental' }], actions: ['Check the current balance with your insurer.'], uncertainties: [] };
const question = { ...ready, id: 'question', kind: 'question', title: 'Do you know what your plan helps pay for?', choices: ['Yes', 'No'] };
const saved = { version: 1, goal: 'insurance', explanation: '', answers: [{ id: 'goal', prompt: 'What brings you here?', choice: 'Understand insurance', text: '' }], turn: ready, history: [], financialState: null, financialDraft: null, financialResult: null, documentNames: [] };
const json = value => Response.json(value);

test('first visit opens My Plan, menu has four pages, and the auto-loaded profile can be edited', async () => {
  const requests = []; let currentProfile = profile;
  globalThis.fetch = async (url, options) => {
    requests.push(String(url));
    if (url === '/api/account') return json({ profile: currentProfile, snapshot: null, storage: 'supabase', firstVisit: true });
    if (url === '/api/profile') { currentProfile = { ...profile, ...JSON.parse(options.body) }; return json(currentProfile); }
    throw new Error(`Unexpected endpoint ${url}`);
  };
  render(<React.StrictMode><App /></React.StrictMode>);
  await screen.findByRole('button', { name: 'Begin my journey' }); assert.equal(requests.filter(url => url === '/api/account').length, 1, 'StrictMode shares one bootstrap request');
  fireEvent.click(screen.getByRole('button', { name: 'Open navigation menu' }));
  assert.equal(screen.getAllByRole('button', { name: /Overview|My Plan|Benefits|Settings/ }).length, 4);
  fireEvent.click(screen.getByRole('button', { name: 'Settings', exact: true }));
  await screen.findByRole('heading', { name: 'Your profile.' });
  assert.equal(screen.getByLabelText('Full name').value, profile.name);
  fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Taylor Stone' } });
  fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'taylor@example.com' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => assert.equal(currentProfile.name, 'Taylor Stone'));
  await screen.findByText('Your profile is saved.');
  fireEvent.click(screen.getByRole('button', { name: 'PlanPilot overview' }));
  await screen.findByRole('heading', { name: 'Welcome back, Taylor.' });
  assert.ok(screen.getByRole('button', { name: 'Start My Plan' }));
});

test('returning user sees saved insurance in Overview and resumes without asking Gemini to repeat the journey', async () => {
  let consultationCalls = 0;
  globalThis.fetch = async (url, options) => {
    if (url === '/api/account') return json({ profile, snapshot: saved, storage: 'supabase', firstVisit: false });
    if (url === '/api/snapshot') return json({ ...JSON.parse(options.body), financialResult: null });
    if (url === '/api/consult') { consultationCalls++; return json(question); }
    throw new Error(`Unexpected endpoint ${url}`);
  };
  render(<App />); await screen.findByRole('heading', { name: 'Welcome back, Alex.' });
  assert.ok(screen.getAllByText('Test Dental').length); fireEvent.click(screen.getByRole('button', { name: 'Review My Plan' }));
  await screen.findByRole('heading', { name: ready.title }); assert.equal(consultationCalls, 0);
  fireEvent.change(await screen.findByLabelText('Ask Bili about your insurance'), { target: { value: 'What does my plan cover?' } });
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Continue with Bili' }));
  await screen.findByRole('heading', { name: question.title }); assert.equal(consultationCalls, 1);
});

test('new answers are saved without uploaded file contents and survive an app reload', async () => {
  let persisted = null; let visits = 0; const requests = [];
  globalThis.fetch = async (url, options) => {
    if (url === '/api/account') return json({ profile, snapshot: persisted, storage: 'supabase', firstVisit: visits++ === 0 });
    if (url === '/api/consult') { requests.push(JSON.parse(options.body)); return json(requests.length === 1 ? question : ready); }
    if (url === '/api/snapshot') { persisted = { ...JSON.parse(options.body), financialResult: null }; return json(persisted); }
    throw new Error(`Unexpected endpoint ${url}`);
  };
  const view = render(<App />); fireEvent.click(await screen.findByRole('button', { name: 'Begin my journey' }));
  await screen.findByRole('heading', { name: /What brings you here/ });
  fireEvent.click(screen.getByLabelText(/I want to understand/));
  fireEvent.click(screen.getByRole('button', { name: 'Continue' })); await screen.findByRole('heading', { name: question.title });
  fireEvent.change(screen.getByLabelText('Upload your insurance card or plan'), { target: { files: [new File(['%PDF-1.7 secret-test-content'], 'coverage.pdf', { type: 'application/pdf' })] } });
  await screen.findByText('coverage.pdf'); fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Continue' }));
  await screen.findByRole('heading', { name: ready.title });
  await waitFor(() => assert.equal(persisted?.turn?.id, ready.id));
  assert.deepEqual(persisted.documentNames, ['coverage.pdf']); assert.equal(JSON.stringify(persisted).includes('secret-test-content'), false); assert.equal('documents' in persisted, false);
  assert.equal('documents' in persisted.history[0], false); assert.equal(requests[1].documents.length, 1);
  view.unmount(); render(<App />); await screen.findByRole('heading', { name: 'Welcome back, Alex.' });
  assert.ok(screen.getAllByText('Test Dental').length); fireEvent.click(screen.getByRole('button', { name: 'Review My Plan' }));
  await screen.findByRole('heading', { name: ready.title }); assert.equal(requests.length, 2);
});

test('resumed requests carry earlier extracted facts without attaching absent original documents', async () => {
  let payload;
  const snapshot = { ...saved, turn: { ...question, facts: [{ label: 'Your plan', value: 'Test Dental', basis: 'document', evidence: 'Provider: Test Dental' }] }, documentNames: ['coverage.pdf'] };
  globalThis.fetch = async (_url, options) => { payload = JSON.parse(options.body); return json(ready); };
  render(<Consultation open closing={false} goal="insurance" explanation="" initialSnapshot={snapshot} onRequestClose={() => {}} onClosed={() => {}} />);
  await screen.findByRole('heading', { name: question.title });
  fireEvent.click(screen.getByRole('radio', { name: 'Yes', exact: true })); fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  await screen.findByRole('heading', { name: ready.title }); assert.equal(payload.documents.length, 0); assert.equal(payload.document, null);
  assert.deepEqual(payload.savedFacts, snapshot.turn.facts);
});

test('device-only visits and progress stay scoped to this browser account; configured storage failures remain visible', async () => {
  cacheAccount({ profile, snapshot: saved, firstVisit: true, storage: 'device' });
  globalThis.fetch = async () => json({ profile, snapshot: null, firstVisit: true, storage: 'device' });
  const returning = await loadAccount(); assert.equal(returning.firstVisit, false); assert.equal(returning.snapshot.turn.id, 'ready');
  globalThis.fetch = async () => json({ profile: { ...profile, id: '5f36ce44-3f6f-40dc-9a62-fb1c6074db47' }, snapshot: null, firstVisit: true, storage: 'device' });
  const other = await loadAccount(); assert.equal(other.firstVisit, true); assert.equal(other.snapshot, null);
  globalThis.fetch = async () => new Response(JSON.stringify({ message: 'Cloud connection failed; retry.' }), { status: 503 });
  await assert.rejects(loadAccount(), /Cloud connection failed/);
});

test('cloud save failures keep answers available and retry saves the same completed consultation', async () => {
  let fail = true; let persisted = null; let consultationCalls = 0;
  globalThis.fetch = async (url, options) => {
    if (url === '/api/account') return json({ profile, snapshot: null, firstVisit: true, storage: 'supabase' });
    if (url === '/api/consult') { consultationCalls++; return json(ready); }
    if (url === '/api/snapshot') {
      if (fail) return new Response(JSON.stringify({ message: 'Could not save.' }), { status: 503 });
      persisted = JSON.parse(options.body); return json(persisted);
    }
    throw new Error(`Unexpected endpoint ${url}`);
  };
  render(<App />); fireEvent.click(await screen.findByRole('button', { name: 'Begin my journey' }));
  fireEvent.click(await screen.findByLabelText(/I want to understand/)); fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  await screen.findByLabelText('Ask Bili about your insurance'); await screen.findByText('Progress couldn’t save. Your current answers are still here.');
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));
  await waitFor(() => assert.ok(!screen.queryByRole('dialog')));
  assert.equal(persisted, null); fail = false; fireEvent.click(await screen.findByRole('button', { name: 'Retry saving' }));
  await waitFor(() => assert.equal(persisted?.turn?.id, 'ready'));
  await screen.findByText('Your progress is saved'); assert.equal(consultationCalls, 1);
});

test('changing the starting goal never saves the previous answers under the new goal', async () => {
  const snapshots = []; let resolveResponse;
  globalThis.fetch = async () => new Promise(resolve => { resolveResponse = () => resolve(json(question)); });
  const view = render(<Consultation open closing={false} goal="insurance" explanation="" initialSnapshot={saved} onSnapshot={snapshot => snapshots.push(snapshot)} onRequestClose={() => {}} onClosed={() => {}} />);
  await screen.findByLabelText('Ask Bili about your insurance');
  view.rerender(<Consultation open closing={false} goal="treatment" explanation="A crown" initialSnapshot={saved} onSnapshot={snapshot => snapshots.push(snapshot)} onRequestClose={() => {}} onClosed={() => {}} />);
  await waitFor(() => assert.equal(typeof resolveResponse, 'function'));
  assert.equal(snapshots.some(snapshot => snapshot.goal === 'treatment'), false);
  await act(async () => resolveResponse());
  await screen.findByRole('heading', { name: question.title });
  await waitFor(() => assert.equal(snapshots.at(-1).goal, 'treatment'));
  assert.equal(snapshots.at(-1).answers.length, 1); assert.equal(snapshots.at(-1).answers[0].text, 'A crown');
});
