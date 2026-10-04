import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccountStore, createDemoSessions, snapshotSchema } from './account.mjs';
import { createApp } from './index.mjs';
import { groundFacts } from './consultation.mjs';
import { buildRuntimeContext } from './prompt.mjs';

const state = () => ({ currency: 'USD', plan: { remainingDeductible: 50, remainingBenefit: 1000, annualMaximum: 1500, annualDeductible: 50, benefitYearStart: '2026-07-01', benefitYearEnd: '2027-06-30', nextYearAnnualMaximum: null, nextYearDeductible: null, renewalConfirmed: false }, procedures: [{ id: 'crown', name: 'Crown', code: null, quote: 1200, quoteType: 'total_fee', allowedAmount: null, insurancePercent: 50, covered: true, deductibleApplies: true, network: 'in', feeBasis: 'quoted_fee', date: '2027-06-15', earliestDate: null, latestDate: null, dentistApprovedWindow: false, dependsOn: [] }] });
const turn = { id: 'saved-result', kind: 'ready', topic: 'Your plan', title: 'Your insurance, explained.', context: 'A clearer view.', choices: [], facts: [{ label: 'Yearly limit', value: '$1,500', basis: 'document', evidence: 'Annual maximum $1,500' }], actions: ['Confirm your benefits before treatment.'], uncertainties: [] };
const snapshot = () => ({ version: 1, goal: 'insurance', explanation: '', answers: [{ id: 'goal', prompt: 'What brings you here?', choice: 'Understand insurance', text: '' }], turn, history: [], financialState: state(), financialDraft: state(), documentNames: ['coverage.pdf'] });
function mockDatabase() {
  const profiles = new Map(); const consultations = new Map(); const calls = [];
  const fetchImpl = async (endpoint, options) => {
    const url = new URL(endpoint); const body = options.body ? JSON.parse(options.body) : null;
    assert.equal(options.headers.apikey, 'sb_secret_test'); assert.equal(options.headers.Authorization, undefined);
    calls.push({ url, options, body }); const table = url.pathname.split('/').at(-1);
    const data = table === 'planpilot_profiles' ? profiles : consultations;
    const id = url.searchParams.get(table === 'planpilot_profiles' ? 'id' : 'user_id')?.slice(3) || body?.id || body?.user_id;
    if (options.method === 'GET') return Response.json(data.has(id) ? [data.get(id)] : []);
    if (options.method === 'PATCH') { if (!data.has(id)) return Response.json([]); data.set(id, { ...data.get(id), ...body }); return Response.json([data.get(id)]); }
    data.set(id, { ...body, created_at: '2026-10-04T00:00:00.000Z' });
    return table === 'planpilot_consultations' ? new Response(null, { status: 204 }) : Response.json([data.get(id)]);
  };
  return { store: createAccountStore({ url: 'https://example.supabase.co', secret: 'sb_secret_test', fetchImpl }), profiles, consultations, calls };
}
async function serve(t, store) {
  const app = createApp({ accounts: store, sessions: createDemoSessions({ secret: 'only-for-tests', secure: false }) });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => app.close(resolve)));
  return `http://127.0.0.1:${app.address().port}`;
}

test('auto-loaded accounts distinguish first visits, retain profiles and recalculate saved estimates', async t => {
  const db = mockDatabase(); const url = await serve(t, db.store);
  const firstResponse = await fetch(`${url}/api/account`); const cookie = firstResponse.headers.get('set-cookie').split(';')[0];
  assert.match(firstResponse.headers.get('set-cookie'), /HttpOnly; SameSite=Lax/);
  const first = await firstResponse.json(); assert.equal(first.firstVisit, true); assert.equal(first.profile.name, 'Alex Morgan'); assert.equal(first.storage, 'supabase');
  const result = await fetch(`${url}/api/snapshot`, { method: 'PUT', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(snapshot()) });
  assert.equal(result.status, 200); assert.equal((await result.json()).financialResult.calculation.totalPatientPays, 625);
  const updated = await fetch(`${url}/api/profile`, { method: 'PUT', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Taylor Stone', email: 'taylor@example.com', phone: '555-0100', company: 'Acme' }) });
  assert.equal(updated.status, 200);
  const returning = await (await fetch(`${url}/api/account`, { headers: { cookie } })).json();
  assert.equal(returning.firstVisit, false); assert.equal(returning.profile.name, 'Taylor Stone'); assert.equal(returning.snapshot.turn.title, turn.title);
  assert.equal(returning.snapshot.financialResult.calculation.totalPatientPays, 625);
  assert.equal(db.consultations.get(first.profile.id).snapshot.financialResult, undefined, 'Only inputs are stored; calculations are regenerated');
  assert.equal(JSON.stringify(returning).includes('sb_secret_test'), false);
});

test('demo sessions cannot select another account or write with missing or forged cookies', async t => {
  const db = mockDatabase(); const url = await serve(t, db.store);
  const firstResponse = await fetch(`${url}/api/account`); const cookie = firstResponse.headers.get('set-cookie').split(';')[0]; const first = await firstResponse.json();
  const secondResponse = await fetch(`${url}/api/account`); const secondCookie = secondResponse.headers.get('set-cookie').split(';')[0]; const second = await secondResponse.json();
  assert.notEqual(first.profile.id, second.profile.id);
  for (const cookieValue of ['', `planpilot_demo=${second.profile.id}.${'0'.repeat(64)}`]) {
    const response = await fetch(`${url}/api/snapshot`, { method: 'PUT', headers: { cookie: cookieValue, 'Content-Type': 'application/json' }, body: JSON.stringify(snapshot()) }); assert.equal(response.status, 401);
  }
  const attempt = await fetch(`${url}/api/snapshot`, { method: 'PUT', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...snapshot(), user_id: second.profile.id }) }); assert.equal(attempt.status, 400);
  const saved = await fetch(`${url}/api/snapshot`, { method: 'PUT', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(snapshot()) }); assert.equal(saved.status, 200);
  const other = await (await fetch(`${url}/api/account?user_id=${first.profile.id}`, { headers: { cookie: secondCookie } })).json(); assert.equal(other.snapshot, null);
  const crossSite = await fetch(`${url}/api/profile`, { method: 'PUT', headers: { cookie, 'Content-Type': 'application/json', origin: 'https://elsewhere.example' }, body: '{}' }); assert.equal(crossSite.status, 403);
});

test('stored snapshots reject document bytes, account selectors and model-authored cost results', () => {
  assert.equal(snapshotSchema.safeParse({ ...snapshot(), documents: [{ data: 'private-bytes' }] }).success, false);
  assert.equal(snapshotSchema.safeParse({ ...snapshot(), financialResult: { total: 1 } }).success, false);
  assert.equal(snapshotSchema.safeParse({ ...snapshot(), turn: { ...turn, financialResult: {} } }).success, false);
  const invalid = snapshot(); invalid.financialState.plan.remainingBenefit = 9999;
  assert.equal(snapshotSchema.safeParse(invalid).success, false);
});

test('absent configuration offers device storage; partial, invalid or failed cloud configuration stays explicit', async () => {
  const id = 'f82451c4-42bd-4fd0-8f36-ff8a79697e06';
  const device = await createAccountStore({ url: '', secret: '' }).bootstrap(id); assert.equal(device.storage, 'device');
  await assert.rejects(createAccountStore({ url: 'https://example.supabase.co', secret: '' }).bootstrap(id), /both SUPABASE/);
  await assert.rejects(createAccountStore({ url: 'http://example.supabase.co', secret: 'sb_secret_test' }).bootstrap(id), /Check SUPABASE_URL/);
  await assert.rejects(createAccountStore({ url: 'https://example.supabase.co', secret: 'sb_secret_test', fetchImpl: async () => new Response('', { status: 404 }) }).bootstrap(id), /Apply the migration/);
});

test('resuming retains original source labels without pretending absent files were read again', () => {
  const request = { answers: snapshot().answers, document: null, savedFacts: turn.facts, mode: 'next' };
  assert.deepEqual(groundFacts(turn, request).facts, turn.facts);
  const altered = { ...turn, facts: [{ ...turn.facts[0], value: '$9,999' }] };
  assert.equal(groundFacts(altered, request).facts[0].basis, 'unknown');
  const context = buildRuntimeContext(request);
  assert.deepEqual(context.previouslyCapturedFacts, turn.facts); assert.equal(context.sourceStatus.document, 'not_provided');
});
