import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSystemPrompt, buildRuntimeContext } from './prompt.mjs';
import { consult } from './consultation.mjs';

const request = { answers: [{ id: 'start', prompt: 'Your goal?', choice: 'Understand benefits', text: 'Delta Dental, two fillings and a crown, with a $1,500 annual maximum.' }], document: null, mode: 'next' };
const turn = { kind: 'question', topic: 'Benefits', title: 'How much benefit do you have left?', context: 'This may affect your insurer contribution.', choices: ['I know the amount', "I don't know", 'Skip for now'], facts: [], actions: [], uncertainties: [] };
const response = () => new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(turn) }] } }] }));

test('the adapted master prompt is the actual Gemini system instruction', async () => {
  const prompt = await readSystemPrompt();
  assert.ok(prompt.includes('You are Bili'));
  assert.ok(prompt.includes('one principal question'));
  assert.ok(prompt.includes('kind document'));
  assert.ok(!prompt.includes('Two integration requirements'));
  assert.ok(!prompt.includes('The most important demonstration test'));
  await consult(request, { apiKey: 'test', fetchImpl: async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.deepEqual(body.systemInstruction.parts, [{ text: prompt }]);
    const payload = JSON.parse(body.contents[0].parts[0].text);
    assert.deepEqual(payload.answers, request.answers);
    assert.equal(payload.runtimeContext.latestUserInteraction.text, request.answers[0].text);
    assert.equal(payload.runtimeContext.availableCapabilities.costCalculator, true);
    return response();
  } });
});

test('saved system prompt edits are reloaded on the next consultation request', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'planpilot-prompt-'));
  const file = join(directory, 'consultation.md');
  t.after(async () => { await unlink(file); await rmdir(directory); });
  const prompts = [];
  const options = { apiKey: 'test', promptLoader: () => readSystemPrompt(file), fetchImpl: async (_url, options) => { prompts.push(JSON.parse(options.body).systemInstruction.parts[0].text); return response(); } };
  await writeFile(file, '\uFEFFAsk about timing only when treatment is planned.\n');
  await consult(request, options);
  await writeFile(file, 'First clarify affordability when the user has no insurance.');
  await consult(request, options);
  assert.deepEqual(prompts, ['Ask about timing only when treatment is planned.', 'First clarify affordability when the user has no insurance.']);
});

test('missing, empty, and oversized prompts cannot silently lose the consultation procedure', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'planpilot-prompt-'));
  const file = join(directory, 'consultation.md');
  t.after(async () => { await unlink(file); await rmdir(directory); });
  const options = { apiKey: 'test', promptLoader: () => readSystemPrompt(file), fetchImpl: () => assert.fail('Must not fetch') };
  await assert.rejects(consult(request, options), error => error.code === 'ai_context');
  for (const value of ['', 'x'.repeat(48001)]) {
    await writeFile(file, value);
    await assert.rejects(consult(request, options), error => error.code === 'ai_context');
  }
  await assert.rejects(consult(request, { ...options, promptLoader: async () => '' }), error => error.code === 'ai_context');
});

test('runtime context preserves multi-fact answers, uncertainty, skips, and corrections without inventing state', () => {
  const answers = [...request.answers,
    { id: 'balance', prompt: turn.title, choice: "I don't know", text: '' },
    { id: 'code', prompt: 'Do you know the procedure code?', choice: 'Skip for now', text: '' },
    { id: 'correction', prompt: 'Any corrections?', choice: '', text: 'Actually the annual maximum is $2,000.' },
  ];
  const context = buildRuntimeContext({ ...request, answers });
  assert.deepEqual(context.userGoals, ['Understand benefits']);
  assert.equal(context.latestUserInteraction.text, answers[3].text);
  assert.deepEqual(context.unresolvedInformation.map(q => [q.id, q.answerStatus]), [['balance', 'unknown'], ['code', 'declined']]);
  assert.ok(context.previouslyAskedQuestions.every(q => q.askAgain === false));
  assert.equal(context.validatedFinancialState, null);
  assert.equal(context.latestCalculation, null);
  assert.equal(context.currency, null);
  assert.ok(context.availableTools.includes('deterministic_cost_calculator'));
  for (const capability of ['costCalculator', 'scheduleOptimizer']) assert.equal(context.availableCapabilities[capability], true);
  for (const capability of ['reminderScheduling', 'insurerVerification', 'pdfExport', 'nearbyClinicSearch', 'publishedClinicPrices']) assert.equal(context.availableCapabilities[capability], false);
  assert.equal(context.availableCapabilities.persistentConsultations, true);
  assert.equal(buildRuntimeContext({ ...request, mode: 'summary' }).currentStage, 'results_requested');
  const declined = buildRuntimeContext({ ...request, answers: [...answers, { id: 'declined', prompt: 'Coverage?', choice: '', text: "I don't know. Please continue without that information." }] });
  assert.equal(declined.previouslyAskedQuestions.at(-1).answerStatus, 'declined');
});
