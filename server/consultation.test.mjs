import test from 'node:test';
import assert from 'node:assert/strict';
import { consult, groundFacts, providerError, validateDocument } from './consultation.mjs';
import { createApp } from './index.mjs';

const request = { answers: [{ id: 'start', prompt: 'What brings you here?', choice: 'Understand insurance', text: 'My deductible is $50.' }], document: null, mode: 'next' };
const turn = { kind: 'question', topic: 'Your coverage', title: 'Do you have your plan handy?', context: 'A benefits summary can help.', choices: ['Yes', 'No', 'Not sure'], facts: [], actions: [], uncertainties: [] };
const response = value => new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(value) }] } }] }), { status: 200 });

test('Gemini request keeps credentials in headers and sends structured history', async () => {
  let payload;
  const result = await consult(request, { apiKey: 'test-secret', fetchImpl: async (url, options) => {
    assert.ok(!url.includes('test-secret')); assert.equal(options.headers['x-goog-api-key'], 'test-secret');
    payload = JSON.parse(options.body); assert.ok(!options.body.includes('test-secret')); return response(turn);
  } });
  assert.equal(result.kind, 'question'); assert.ok(result.id);
  assert.deepEqual(JSON.parse(payload.contents[0].parts[0].text).answers, request.answers);
  assert.equal(payload.generationConfig.responseMimeType, 'application/json');
});
test('unreadable, incomplete and invalid structured responses are rejected', async () => {
  for (const value of [new Response('{}'), response({ ...turn, kind: 'invented' }), response({ ...turn, choices: ['Yes', 'Yes'] })]) {
    await assert.rejects(consult(request, { apiKey: 'test', fetchImpl: async () => value }), error => error.code === 'ai_response');
  }
});
test('explicit early summary cannot return another question', async () => {
  await assert.rejects(consult({ ...request, mode: 'summary' }, { apiKey: 'test', fetchImpl: async () => response(turn) }), error => error.code === 'ai_response');
});
test('an oversized explanation gets one bounded repair without truncating facts or exposing credentials', async () => {
  let calls = 0;
  const result = await consult(request, { apiKey: 'test-secret', fetchImpl: async (_url, options) => {
    const body = JSON.parse(options.body); calls++;
    if (calls === 1) return response({ ...turn, context: 'A long explanation. '.repeat(15) });
    assert.equal(body.contents.length, 3);
    assert.ok(body.contents[2].parts[0].text.includes('context'));
    assert.ok(!options.body.includes('test-secret'));
    return response({ ...turn, context: 'Your plan file can help us understand what it pays.' });
  } });
  assert.equal(calls, 2); assert.equal(result.context, 'Your plan file can help us understand what it pays.');
});
test('upload suggestions activate document intake without imposing a fixed order', async () => {
  const result = await consult(request, { apiKey: 'test', fetchImpl: async () => response({ ...turn, choices: ['Upload insurance document', 'Explain from memory', 'Not sure'] }) });
  assert.equal(result.kind, 'document');
});
test('unsubstantiated facts become unknown; supplied excerpts remain attributed', () => {
  const result = groundFacts({ ...turn, facts: [
    { label: 'Deductible', value: '$50', basis: 'user', evidence: 'deductible is $50' },
    { label: 'Maximum', value: '$2000', basis: 'user', evidence: 'a made up quote' },
    { label: 'Coverage', value: '80%', basis: 'document', evidence: '80% coverage' },
  ] }, request);
  assert.equal(result.facts[0].basis, 'user'); assert.equal(result.facts[1].basis, 'unknown'); assert.equal(result.facts[2].basis, 'unknown');
});
test('native PDF and images attach without persisting to provider Files API', async () => {
  const document = { name: 'sample.pdf', mimeType: 'application/pdf', data: Buffer.from('%PDF-1.7\nSynthetic test document').toString('base64') };
  await consult({ ...request, document }, { apiKey: 'test', fetchImpl: async (url, options) => {
    assert.ok(url.endsWith(':generateContent')); assert.deepEqual(JSON.parse(options.body).contents[0].parts[1].inlineData, { mimeType: document.mimeType, data: document.data }); return response(turn);
  } });
  assert.throws(() => validateDocument({ ...document, mimeType: 'image/png' }), error => error.code === 'file_type');
  assert.throws(() => validateDocument({ ...document, data: '!!invalid' }), error => error.code === 'file_invalid');
  assert.throws(() => validateDocument({ ...document, data: Buffer.alloc(10 * 1024 * 1024 + 1).toString('base64') }), error => error.code === 'file_size');
});
test('quota and key errors use safe messages without raw provider details', async () => {
  assert.equal(providerError(429, 'private data').code, 'ai_quota');
  assert.equal(providerError(403, 'secret key').code, 'ai_auth');
  await assert.rejects(consult(request, { apiKey: '', fetchImpl: () => assert.fail('Must not fetch') }), error => error.code === 'ai_config');
});
test('HTTP API denies cross-site calls, dotfiles, bad methods and malformed JSON', async t => {
  const server = createApp({ consultant: async () => ({ ...turn, id: 'test' }) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${base}/.env`)).status, 404);
  assert.equal((await fetch(`${base}/api/consult`)).status, 405);
  assert.equal((await fetch(`${base}/api/consult`, { method: 'POST', headers: { origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
  assert.equal((await fetch(`${base}/api/consult`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{broken' })).status, 400);
  const result = await fetch(`${base}/api/consult`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
  assert.equal(result.status, 200); assert.equal((await result.json()).id, 'test');
});
