// Presentation wording only. Never changes source excerpts or numerical inputs.
export function plainText(value) {
  return value.replace(/annual maximum/gi, 'yearly plan limit')
    .replace(/remaining (?:annual )?benefits?/gi, 'plan money left this year')
    .replace(/annual deductible/gi, 'yearly amount you pay first')
    .replace(/remaining deductible/gi, 'amount you still pay first')
    .replace(/deductible/gi, 'amount you pay first')
    .replace(/coinsurance/gi, 'shared treatment cost')
    .replace(/(?:negotiated\s*\/\s*)?allowable (?:amount|fee)/gi, 'price your plan uses')
    .replace(/in-network/gi, 'with agreed plan prices')
    .replace(/out-of-network/gi, 'without agreed plan prices');
}
function plainLabel(label) {
  if (/deductible|pay.*before.*(?:insurance|plan).*pay|pay.*before.*(?:insurance|plan).*help/i.test(label)) return /remaining|still|left/i.test(label) ? 'Still to pay before your plan helps' : 'Yearly amount you pay first';
  if (/annual maximum|most.*plan.*pay.*year|yearly.*(?:maximum|limit)/i.test(label)) return 'Most your plan pays per year';
  if (/remaining.*benefit|plan.*(?:can still pay|money left)/i.test(label)) return 'Your plan can still pay this year';
  if (/^provider$|^insurance provider$/i.test(label)) return 'Your insurer';
  if (/major services|larger treatments/i.test(label)) return 'Larger treatments: plan’s share';
  if (/basic services|routine repairs/i.test(label)) return 'Routine repairs: plan’s share';
  if (/allowable|negotiated|agreed price|price.*plan.*uses/i.test(label)) return 'Price your plan uses';
  return plainText(label);
}
export function plainTurn(turn) {
  return { ...turn, title: plainText(turn.title), context: plainText(turn.context), topic: plainText(turn.topic), choices: turn.choices.map(plainText),
    facts: turn.facts.map(fact => ({ ...fact, label: plainLabel(fact.label), value: plainText(fact.value) })),
    actions: turn.actions.map(plainText), uncertainties: turn.uncertainties.map(plainText),
  };
}
