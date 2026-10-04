// These signals support the consultant; they do not prescribe a questionnaire.
const insuranceQuestion = /insurance|coverage|benefit|\bplan\b|pay.*first|deductible|annual maximum/i;
const knowledgeQuestion = /\bknow\b|understand|familiar|what.*cover|how much|what (?:share|percentage)|deductible|annual maximum/i;
export function interactionStatus(answer) {
  const value = [answer.choice, answer.text].filter(Boolean).join(' ').trim().replaceAll('’', "'");
  if (/\bskip\b|continue without|do not ask|don't ask/i.test(value)) return 'declined';
  if (/^(?:i (?:do not|don't) know|i(?:'m| am) not (?:really )?sure(?: yet)?|not sure|unknown)[.!]?$/i.test(value) || /(?:don't|do not) understand|what does .*mean|confus/i.test(value)) return 'unknown';
  // "No" to knowing coverage is uncertainty. "No" to having insurance is a fact.
  if (/^no[.!]?$/i.test(value) && insuranceQuestion.test(answer.prompt) && knowledgeQuestion.test(answer.prompt)) return 'unknown';
  return value ? 'user_reported' : 'unknown';
}

export function journeySignals(request) {
  const latest = request.answers.at(-1);
  const value = [latest.choice, latest.text].filter(Boolean).join(' ').replaceAll('’', "'");
  const insuranceUnknowns = request.answers.filter(a => insuranceQuestion.test(a.prompt) && interactionStatus(a) === 'unknown');
  const documentsAvailable = !!(request.document || request.documents?.length);
  const explicitUpload = /\b(upload|attach|send|share)\b.*\b(card|file|document|bill|estimate|plan|insurance)\b|\b(card|file|document|bill|estimate)\b.*\bupload\b/i.test(value);
  const uploadDeclined = request.answers.some(a => /insurance|coverage|\bplan\b|upload|document|card|file/i.test(a.prompt) && /continue without|no (?:file|card|document)|don't have|do not have|skip|rather.*(?:type|speak)|guide me/i.test([a.choice, a.text].join(' ').replaceAll('’', "'")));
  const latestUnknown = interactionStatus(latest) === 'unknown';
  const coverageConfusion = latestUnknown && insuranceQuestion.test(latest.prompt);
  const directClarification = /what (?:does|is|are)|what's|explain|what.*mean/i.test(value);
  const offerUpload = explicitUpload || (!documentsAvailable && !uploadDeclined && coverageConfusion && !directClarification);
  const billEstablished = request.answers.some(a => /bill|invoice|(?:dentist|clinic).*(?:estimate|quote)|(?:estimate|quote).*dentist/i.test([a.prompt, a.text].join(' '))) || !!(request.financialDraft || request.financialState)?.procedures.some(p => p.quote !== null);
  const insuranceOnly = request.answers.some(a => /(?:only|just).*(?:understand|explain).*(?:insurance|plan)|no.*(?:bill|treatment).*(?:want|need)/i.test([a.choice, a.text].join(' ')));
  const coverageReviewed = /looks (?:right|good)|confirm.*(?:details|plan|insurance)/i.test(value);
  return {
    latestAnswerStatus: interactionStatus(latest), insuranceUnknownCount: insuranceUnknowns.length,
    explicitUpload, offerUpload, directClarification, documentsAvailable, uploadPreviouslyDeclined: uploadDeclined,
    billEstablished, insuranceOnly, coverageReviewed,
    documentPurpose: /bill|estimate|quote|invoice/i.test(explicitUpload ? value : latest.prompt) ? 'bill' : 'insurance',
    guidance: offerUpload ? 'Offer a card/file upload now, with a simple manual alternative. Do not repeat the same coverage question.' : coverageConfusion ? 'Explain in simpler words, preserve unknowns, and choose another useful next action.' : 'Choose the next action from the user goal and known information.',
  };
}

export function supportJourney(turn, request) {
  if (request.mode === 'summary') return turn;
  const signals = journeySignals(request);
  if (turn.kind === 'ready' && signals.coverageReviewed && !signals.billEstablished && !signals.insuranceOnly && !turn.financialProposal?.procedures.length) {
    return { ...turn, kind: 'question', documentPurpose: 'bill', topic: 'Your dentist’s bill',
      title: 'Do you have a bill or price estimate from your dentist?',
      context: 'If you do, we can explain each price and what your plan may pay. You can upload it, type it, or say it out loud.',
      choices: ['Yes, I have one', 'Not yet', 'I only want to understand my plan'],
    };
  }
  if (signals.offerUpload) {
    const bill = signals.documentPurpose === 'bill';
    return { ...turn, kind: 'document', documentPurpose: signals.documentPurpose,
      topic: bill ? 'Your dentist’s bill' : 'Your insurance',
      title: bill ? 'Let’s look at your dentist’s bill.' : 'Let’s look at your insurance together.',
      context: bill ? 'Upload a bill or price estimate, or tell me what it says. We’ll check whether insurance is already included.' : 'You don’t need to know the insurance terms. Share a card or plan file, or we can work through it in plain words.',
      choices: bill ? ['Upload my bill or estimate', 'I’ll type or speak it', 'I don’t have it with me'] : ['Upload my card or plan', 'Guide me in simple words', 'I don’t have a file with me'],
      financialProposal: null,
    };
  }
  if (turn.kind === 'question' && turn.choices.some(c => /\bupload\b/i.test(c))) return { ...turn, kind: 'document', documentPurpose: turn.documentPurpose || (/bill|estimate|quote|treatment/i.test([turn.title, ...turn.choices].join(' ')) ? 'bill' : 'insurance') };
  return turn;
}
