import test from 'node:test';
import assert from 'node:assert/strict';
import { interactionStatus, journeySignals } from './journey.mjs';
import { consult } from './consultation.mjs';

const start = { id: 'goal', prompt: 'What brings you here?', choice: 'Understand my insurance', text: '' };
const unanswered = { id: 'coverage', prompt: 'Do you know what your plan helps pay for?', choice: 'No', text: '' };
const turn = { kind: 'question', topic: 'Insurance', title: 'How much do you pay first?', context: '', choices: ['I know', 'Not sure'], facts: [], actions: [], uncertainties: [] };
const response = output => new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(output) }] } }] }));
const request = answers => ({ answers: [start, ...answers], document: null, mode: 'next' });

test('No to knowing coverage offers document intake even if the model tries another question', async () => {
  const result = await consult(request([unanswered]), { apiKey: 'test', fetchImpl: async (_url, options) => {
    const context = JSON.parse(JSON.parse(options.body).contents[0].parts[0].text).runtimeContext;
    assert.equal(context.journeySignals.latestAnswerStatus, 'unknown');
    assert.equal(context.previouslyAskedQuestions.at(-1).askAgain, false);
    return response(turn);
  } });
  assert.equal(result.kind, 'document'); assert.equal(result.documentPurpose, 'insurance');
  assert.ok(result.choices.some(choice => /card/i.test(choice)));
  assert.ok(result.choices.some(choice => /simple words/i.test(choice)));
  assert.ok(!/deductible|coinsurance|annual maximum/i.test(result.title + result.context));
});
test('uncertainty is distinct from having no insurance and never creates zero balances', () => {
  assert.equal(interactionStatus(unanswered), 'unknown');
  assert.equal(interactionStatus({ ...unanswered, prompt: 'Do you have insurance?' }), 'user_reported');
  assert.equal(interactionStatus({ ...unanswered, choice: 'I don’t know' }), 'unknown');
  assert.equal(journeySignals(request([{ ...unanswered, prompt: 'Do you have insurance?' }])).offerUpload, false);
});
test('a direct request to explain a confusing term preserves the explanation instead of forcing an upload', async () => {
  const answer = { ...unanswered, choice: '', text: 'What does deductible mean?' };
  const explanation = { ...turn, context: 'It is the amount you pay yourself before your plan starts helping.', title: 'Would you like help finding that amount?', choices: ['Yes', 'Not now'] };
  const result = await consult(request([answer]), { apiKey: 'test', fetchImpl: async () => response(explanation) });
  assert.equal(result.kind, 'question'); assert.equal(result.context, explanation.context);
  assert.equal(journeySignals(request([answer])).offerUpload, false);
});
test('manual guidance and missing-file choices stop repeated upload offers; explicit requests can revisit', async () => {
  const noFile = { id: 'upload', prompt: 'Let’s look at your insurance together.', choice: 'I don’t have a file with me', text: '' };
  const answers = [unanswered, noFile, { ...unanswered, id: 'share', prompt: 'What share of treatment does your plan cover?', choice: 'I don’t know' }];
  const signals = journeySignals(request(answers));
  assert.equal(signals.insuranceUnknownCount, 2); assert.equal(signals.offerUpload, false);
  const explicit = { id: 'new-file', prompt: 'Anything else?', choice: '', text: 'I want to upload my dentist bill.' };
  const result = await consult(request([...answers, explicit]), { apiKey: 'test', fetchImpl: async () => response(turn) });
  assert.equal(result.kind, 'document'); assert.equal(result.documentPurpose, 'bill');
});
test('review checkpoints remain adaptive and preserve grounded extracted facts and unknowns', async () => {
  const review = { ...turn, kind: 'review', title: 'Here’s what we know so far.', choices: ['Looks right, continue', 'I need to change something'], facts: [{ label: 'Your plan', value: 'Test Dental', basis: 'user', evidence: 'Test Dental' }], uncertainties: ['How much your plan can still pay this year'] };
  const result = await consult(request([{ ...unanswered, choice: '', text: 'My plan is Test Dental.' }]), { apiKey: 'test', fetchImpl: async () => response(review) });
  assert.equal(result.kind, 'review'); assert.equal(result.facts[0].basis, 'user');
  assert.equal(result.financialResult, null);
});
test('confirmed coverage gets a bill question before an automatic finish, while insurance-only and requested summaries are respected', async () => {
  const confirmation = { id: 'review', prompt: 'Here’s what we know about your insurance.', choice: 'Looks right, continue', text: '' };
  const ready = { ...turn, kind: 'ready', title: 'Your plan explained', choices: [] };
  const options = { apiKey: 'test', fetchImpl: async () => response(ready) };
  const result = await consult(request([confirmation]), options);
  assert.equal(result.kind, 'question'); assert.equal(result.documentPurpose, 'bill');
  assert.ok(result.title.includes('bill or price estimate'));
  const insuranceOnly = await consult(request([{ ...confirmation, text: 'I only want to understand my plan.' }]), options);
  assert.equal(insuranceOnly.kind, 'ready');
  assert.equal((await consult({ ...request([confirmation]), mode: 'summary' }, options)).kind, 'ready');
});
