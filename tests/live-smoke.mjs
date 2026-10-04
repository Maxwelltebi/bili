// Explicit, opt-in live verification. Sends only synthetic data to Gemini.
import assert from 'node:assert/strict';
import { consult as runConsult, turnSchema } from '../server/consultation.mjs';
import { calculateCosts } from '../server/finance.mjs';

async function consult(request) {
  return runConsult(request, { fetchImpl: async (url, options) => {
    const response = await fetch(url, options);
    if (response.ok) {
      const candidate = (await response.clone().json()).candidates?.[0];
      try {
        const output = JSON.parse(candidate?.content?.parts?.filter(p => !p.thought).map(p => p.text || '').join(''));
        const parsed = turnSchema.safeParse(output);
        if (!parsed.success) console.error('Synthetic response validation:', parsed.error.issues.map(issue => ({ path: issue.path, message: issue.message, value: issue.path.reduce((value, key) => value?.[key], output) })));
        if (request.mode === 'summary' && output.kind !== 'ready') console.error('Synthetic summary returned kind:', output.kind);
      } catch { console.error('Synthetic response was incomplete:', candidate?.finishReason); }
    }
    return response;
  } });
}

function syntheticPdf(lines = ['Synthetic Dental Benefits - Test Fixture', 'Provider: Test Dental', 'Annual maximum: $1500', 'Annual deductible: $50', 'Major services: 50 percent after deductible', 'Coverage subject to plan exclusions.']) {
  const stream = `BT /F1 14 Tf 50 750 Td ${lines.map((line, i) => `${i ? '0 -25 Td ' : ''}(${line}) Tj`).join('\n')} ET`;
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
  let pdf = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf).toString('base64');
}

const answers = [{ id: 'start', prompt: 'What brings you here?', choice: 'Understand my insurance', text: 'My dentist suggested a crown. I want to understand my deductible, annual maximum, and major services coverage.' }];
const next = await consult({ answers, document: null, mode: 'next' });
assert.ok(['question', 'document', 'review', 'ready'].includes(next.kind));
console.log('Live Gemini next turn:', next.kind, next.title);
const simpleGoal = { id: 'start', prompt: 'What brings you here?', choice: 'Understand my insurance', text: '' };
const confused = await consult({ answers: [simpleGoal, { id: 'coverage', prompt: 'Do you know what your insurance helps pay for?', choice: 'No', text: '' }], document: null, mode: 'next' });
assert.equal(confused.kind, 'document'); assert.equal(confused.documentPurpose, 'insurance');
assert.ok(confused.choices.some(c => /card/i.test(c)));
assert.ok(!/deductible|coinsurance|annual maximum/i.test(confused.title + confused.context));
console.log('Live plain-language uncertainty -> card/file intake: passed.');
const document = { name: 'synthetic-benefits.pdf', mimeType: 'application/pdf', data: syntheticPdf() };
const summary = await consult({ answers: [...answers, { id: 'document', prompt: 'Plan document', choice: 'Synthetic document supplied', text: '' }], document, mode: 'summary' });
assert.equal(summary.kind, 'ready');
assert.ok(summary.facts.some(fact => fact.basis === 'document'), 'The summary must attribute facts to the document');
assert.ok(summary.facts.some(fact => /50|1500|1,500/.test(fact.value)), 'The summary must extract a supplied benefit figure');
console.log('Live Gemini PDF summary: passed; document facts:', summary.facts.filter(fact => fact.basis === 'document').map(fact => ({ label: fact.label, value: fact.value, evidence: fact.evidence })));
const checkpoint = await consult({ answers: [simpleGoal, { id: confused.id, prompt: confused.title, choice: 'Document provided: synthetic-benefits.pdf', text: '' }], document, mode: 'next' });
assert.equal(checkpoint.kind, 'review', 'Meaningful extracted coverage should be shown for review');
assert.ok(checkpoint.facts.some(f => f.basis === 'document'));
assert.ok(!/deductible|coinsurance|annual maximum/i.test(checkpoint.facts.map(f => f.label).join(' ')));
console.log('Live coverage extraction -> plain-language review checkpoint: passed.');
const afterReview = await consult({ answers: [simpleGoal, { id: confused.id, prompt: confused.title, choice: 'Document provided: synthetic-benefits.pdf', text: '' }, { id: checkpoint.id, prompt: checkpoint.title, choice: 'Looks right, continue', text: '' }], document: null, documents: [document], financialDraft: checkpoint.financialProposal || null, mode: 'next' });
assert.ok(['question', 'document'].includes(afterReview.kind));
assert.ok(!afterReview.title.toLowerCase().includes('deductible'));
console.log('Live confirmed review -> adaptive next question:', afterReview.title);

const quoteAnswers = [{ id: 'start', prompt: 'What brings you here?', choice: 'Estimate my treatment expenses', text: 'My dentist quoted a full fee of $1,200 before insurance for one crown. My plan confirms this specific crown is eligible, the whole $1,200 is an eligible fee, and this dentist is in-network. My insurer pays 50% after the deductible. The deductible applies and I have $50 of deductible remaining, with $1,000 of annual benefits remaining. No timing restrictions apply to this quoted procedure. Please show my estimate now.' }];
const quoteTurn = await consult({ answers: quoteAnswers, document: null, mode: 'summary' });
assert.ok(quoteTurn.financialProposal, 'Bili must extract the quoted fee into a reviewable financial draft');
const crown = quoteTurn.financialProposal.procedures.find(p => /crown/i.test(p.name));
assert.equal(crown?.quote, 1200); assert.equal(crown?.quoteType, 'total_fee'); assert.equal(crown?.insurancePercent, 50);
assert.equal(quoteTurn.financialProposal.plan.remainingDeductible, 50); assert.equal(quoteTurn.financialProposal.plan.remainingBenefit, 1000);
const calculation = calculateCosts(quoteTurn.financialProposal);
assert.equal(calculation.totalPatientPays, 625); assert.equal(calculation.totalInsurerPays, 575);
console.log('Live quote extraction + deterministic calculation: passed ($625 estimated personal cost, $575 insurer contribution).');

const bill = { name: 'synthetic-dentist-bill.pdf', mimeType: 'application/pdf', data: syntheticPdf(['Synthetic Dentist Estimate - Test Fixture', 'Procedure: Crown D2740', 'Total fee before insurance: $1200', 'Estimated insurance payment: $550', 'Estimated patient payment after insurance: $650']) };
const billTurn = await consult({ answers: [{ ...simpleGoal, choice: 'Understand my dentist bill', text: 'The attached bill is for a crown my plan specifically covers now. My plan pays 50% of the full price and my dentist has agreed prices with the plan. I still pay $50 first, and the plan can still pay $1,000 this year. Please show the bill breakdown.' }], document: bill, documents: [document, bill], mode: 'summary' });
const extracted = billTurn.financialProposal?.procedures.find(p => /crown/i.test(p.name));
assert.equal(extracted?.quote, 1200); assert.equal(extracted?.quoteType, 'total_fee'); assert.equal(extracted?.clinicPatientEstimate, 650);
assert.equal(calculateCosts(billTurn.financialProposal).totalPatientPays, 625);
console.log('Live bill PDF extraction: full $1,200 fee and clinic $650 estimate retained separately; calculated share $625.');
