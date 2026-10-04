import test from 'node:test';
import assert from 'node:assert/strict';
import { plainTurn } from './plain-language.mjs';

test('plain headings preserve financial meaning, source quotes and numerical draft inputs', () => {
  const turn = { topic: 'Coverage', title: 'Do you know your remaining deductible?', context: '', choices: ['I don’t know'], actions: [], uncertainties: ['Remaining annual benefits'], financialProposal: { plan: { annualDeductible: 50, remainingDeductible: null } }, facts: [
    { label: 'Annual deductible (the amount you pay yourself before your plan starts helping)', value: '$50', basis: 'document', evidence: 'Annual deductible: $50' },
    { label: 'Remaining deductible', value: 'Unknown', basis: 'unknown', evidence: '' },
  ] };
  const output = plainTurn(turn);
  assert.equal(output.facts[0].label, 'Yearly amount you pay first');
  assert.equal(output.facts[1].label, 'Still to pay before your plan helps');
  assert.equal(output.facts[0].evidence, 'Annual deductible: $50');
  assert.deepEqual(output.financialProposal, turn.financialProposal);
  assert.ok(!/deductible|annual benefits/i.test(output.title + output.uncertainties.join(' ')));
});
