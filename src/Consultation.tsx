import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { FreeResponse } from './FreeResponse';
import { JourneyModal, JourneyTransition } from './JourneyModal';
import { requestConsultation, type Answer, type PlanDocument, type Turn, type Payload } from './consultationApi';
import { FinancialWorkspace } from './FinancialWorkspace';
import { CapturedDetails } from './CapturedDetails';
import { type FinancialState, type Estimate, formatMoney, emptyFinancialState } from './financeApi';
import type { Snapshot } from './accountApi';
import { ThemeToggle } from './Theme';

type Entry = { turn: Turn; answer: Answer; document: PlanDocument | null; documents: PlanDocument[]; financialState: FinancialState | null; financialDraft: FinancialState | null };
const goalLabels: Record<string, string> = { treatment: 'I have upcoming dental treatment', insurance: 'I want to understand my insurance', expenses: 'I want to reduce my dental expenses', options: "I'm comparing treatment options", unsure: "I'm not really sure yet" };

function Arrow() { return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>; }
type Props = { open: boolean; closing: boolean; goal: string; explanation: string; onRequestClose: () => void; onClosed: () => void; initialSnapshot?: Snapshot | null; onSnapshot?: (snapshot: Snapshot) => void; onViewOverview?: () => void };

export function Consultation({ open, closing, goal, explanation, onRequestClose, onClosed, initialSnapshot, onSnapshot, onViewOverview }: Props) {
  const [turn, setTurn] = useState<Turn | null>(null);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [history, setHistory] = useState<Entry[]>([]);
  const [document, setDocument] = useState<PlanDocument | null>(null);
  const [documents, setDocuments] = useState<PlanDocument[]>([]);
  const [archivedNames, setArchivedNames] = useState<string[]>([]);
  const [financialState, setFinancialState] = useState<FinancialState | null>(null);
  const [financialResult, setFinancialResult] = useState<Estimate | null>(null);
  const [financialDraft, setFinancialDraft] = useState<FinancialState | null>(null);
  const savedFacts = [...new Map([...history.flatMap(entry => entry.turn.facts), ...(turn?.facts || [])].map(fact => [fact.label, fact])).values()].slice(-60);
  const contextRef = useRef({ documents, financialState, financialDraft, savedFacts });
  contextRef.current = { documents, financialState, financialDraft, savedFacts };
  const [choice, setChoice] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');
  const [validation, setValidation] = useState('');
  const [listening, setListening] = useState(false);
  const [review, setReview] = useState(false);
  const [done, setDone] = useState(false);
  const [examples, setExamples] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const pending = useRef<Payload | null>(null);
  const seed = useRef('');
  const [activeSeed, setActiveSeed] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const run = useCallback(async (payload: Payload) => {
    abort.current?.abort();
    const controller = new AbortController(); abort.current = controller;
    const outbound = { ...contextRef.current, ...payload }; pending.current = outbound;
    setBusy(true); setError(''); setValidation(''); setReview(false); setDone(false);
    try {
      const result = await requestConsultation(outbound, controller.signal);
      if (controller.signal.aborted) return;
      setTurn(result); setChoice(''); setText(''); setExamples(false); setDownloaded(false); setUploadOpen(false); setDocument(null);
      if (result.financialProposal) {
        setFinancialDraft(result.financialProposal);
        const unchanged = JSON.stringify(result.financialProposal) === JSON.stringify(outbound.financialState);
        if (!unchanged) { setFinancialState(null); setFinancialResult(null); }
        else setFinancialResult(result.financialResult || null);
      }
      if (result.kind === 'document') setDocument(null);
      if (result.kind === 'ready') {
        setReview(false); setDone(true);
      }
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'The consultant could not connect. Retry to continue.');
    } finally { if (abort.current === controller) setBusy(false); }
  }, []);

  useEffect(() => {
    if (!open) return;
    const nextSeed = JSON.stringify([goal, explanation]);
    if (seed.current === nextSeed) return;
    seed.current = nextSeed;
    setActiveSeed(nextSeed);
    if (initialSnapshot?.goal === goal && initialSnapshot.explanation === explanation && initialSnapshot.answers.length) {
      setAnswers(initialSnapshot.answers); setHistory(initialSnapshot.history.map(entry => ({ ...entry, document: null, documents: [] })));
      setDocument(null); setDocuments([]); setArchivedNames(initialSnapshot.documentNames); setFinancialState(initialSnapshot.financialState); setFinancialDraft(initialSnapshot.financialDraft); setFinancialResult(initialSnapshot.financialResult || null); setTurn(initialSnapshot.turn); setReview(false); setDone(initialSnapshot.turn?.kind === 'ready');
      if (!initialSnapshot.turn) void run({ answers: initialSnapshot.answers, document: null, documents: [], financialState: initialSnapshot.financialState, financialDraft: initialSnapshot.financialDraft, savedFacts: initialSnapshot.history.flatMap(entry => entry.turn.facts).slice(-60), mode: 'next' });
      return;
    }
    const initial: Answer[] = [{ id: 'starting-point', prompt: 'What brings you here today?', choice: goalLabels[goal] || '', text: explanation }];
    setAnswers(initial); setHistory([]); setDocument(null); setDocuments([]); setArchivedNames([]); setFinancialState(null); setFinancialDraft(null); setFinancialResult(null); setTurn(null); setReview(false); setDone(false);
    void run({ answers: initial, document: null, documents: [], financialState: null, financialDraft: null, savedFacts: [], mode: 'next' });
  }, [open, goal, explanation, run, initialSnapshot]);
  useEffect(() => () => { abort.current?.abort(); }, []);
  useEffect(() => {
    if (!answers.length || busy || activeSeed !== JSON.stringify([goal, explanation])) return;
    onSnapshot?.({ version: 1, goal, explanation, answers, turn: error ? null : turn, history: history.map(({ document: _file, documents: _files, ...entry }) => entry), financialState, financialDraft, financialResult, documentNames: [...new Set([...archivedNames, ...documents.map(doc => doc.name)])].slice(-5) });
  }, [answers, busy, error, turn, history, financialState, financialDraft, financialResult, archivedNames, documents, goal, explanation, activeSeed, onSnapshot]);

  function close() {
    if (busy) { abort.current?.abort(); setBusy(false); setError('Your consultation is paused. Retry when you are ready.'); }
    onRequestClose();
  }
  function submit(event: FormEvent, skip = false) {
    event.preventDefault();
    if (!turn || busy || listening || reading) return;
    if (!skip && choice === 'I need to change something' && !text.trim() && !document) { setValidation('Tell Bili what to change below, by typing or speaking.'); return; }
    if (!skip && !choice && !text.trim() && !document && turn.kind !== 'review') { setValidation('Choose an option, type, or speak your answer.'); return; }
    if (!skip && /upload/i.test(choice) && !document && !text.trim()) { setValidation('Choose a file, or tell Bili you want to continue without one.'); return; }
    const answer = { id: turn.id, prompt: turn.title, choice: skip ? 'Skip; I do not know' : document ? `Document provided: ${document.name}` : choice || (turn.kind === 'review' && !text.trim() ? 'Looks right, continue' : ''), text: skip ? '' : text.trim() };
    const nextAnswers = [...answers, answer];
    setHistory([...history, { turn, answer, document, documents, financialState, financialDraft }]); setAnswers(nextAnswers);
    void run({ answers: nextAnswers, document, mode: 'next' });
  }
  function back() {
    const previous = history.at(-1);
    if (!previous || busy || reading || listening) return;
    setTurn(previous.turn); setChoice(previous.answer.choice); setText(previous.answer.text); setDocument(previous.document); setDocuments(previous.documents); setFinancialState(previous.financialState); setFinancialDraft(previous.financialDraft); setFinancialResult(null);
    setHistory(history.slice(0, -1)); setAnswers(answers.slice(0, -1)); setReview(false); setDone(false); setError(''); setValidation('');
  }
  function edit(index: number) {
    const entry = history[index]; if (!entry) return;
    setTurn(entry.turn); setChoice(entry.answer.choice); setText(entry.answer.text); setDocument(entry.document); setDocuments(entry.documents); setFinancialState(entry.financialState); setFinancialDraft(entry.financialDraft); setFinancialResult(null);
    setAnswers(answers.slice(0, index + 1)); setHistory(history.slice(0, index)); setReview(false); setDone(false); setValidation('');
  }
  async function selectFile(file?: File) {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024 || file.size === 0) { setValidation('Choose a file smaller than 10 MB.'); return; }
    if (documents.filter(doc => doc.name !== file.name).reduce((sum, doc) => sum + doc.data.length * 0.75, file.size) > 10 * 1024 * 1024 || documents.length >= 5 && !documents.some(doc => doc.name === file.name)) { setValidation('Keep up to five documents, smaller than 10 MB combined.'); return; }
    const types: Record<string, PlanDocument['mimeType']> = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' };
    const mimeType = types[file.name.split('.').at(-1)?.toLowerCase() || ''];
    if (!mimeType) { setValidation('Choose a PDF, JPG or PNG.'); return; }
    setReading(true); setValidation('');
    try {
      const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(new Error('This file could not be read. Try another file.')); reader.readAsDataURL(file); });
      const added = { name: file.name, mimeType, data };
      setDocument(added); setDocuments(previous => [...previous.filter(doc => doc.name !== file.name), added]); setChoice(''); setUploadOpen(true);
    } catch (err) { setValidation(err instanceof Error ? err.message : 'This file could not be read.'); }
    finally { setReading(false); if (fileInput.current) fileInput.current.value = ''; }
  }
  function exportPlan() {
    if (!turn) return;
    let contents = ['PlanPilot — Your dental benefits plan', turn.title, turn.context, '', 'What we know', ...turn.facts.map(f => `${f.label}: ${f.value} (${f.basis === 'unknown' ? 'Unconfirmed' : f.basis === 'user' ? 'You shared' : 'Document states'})${f.evidence ? `\nSource: ${f.evidence}` : ''}`), '', 'Next actions', ...turn.actions.map(a => `- ${a}`), '', 'To confirm', ...turn.uncertainties.map(a => `- ${a}`), '', 'Confirm benefits with your insurer and treatment choices with your dentist.'].join('\n');
    if (financialResult) {
      contents += '\n\nCost calculation (USD)\n' + financialResult.calculation.rows.map(row => `${row.name}: quote ${formatMoney(row.quotedFee)}, you pay first ${formatMoney(row.deductible)}, estimated insurance ${formatMoney(row.insurerPays)}, estimated personal cost ${formatMoney(row.patientPays)} (${row.status})`).join('\n');
      contents += `\nTotal personal cost: ${formatMoney(financialResult.calculation.totalPatientPays)}\n` + financialResult.calculation.warnings.join('\n');
      if (financialResult.optimization.available) contents += `\nSchedule comparison: original ${formatMoney(financialResult.optimization.original.totalPatientPays)}, lowest evaluated ${formatMoney(financialResult.optimization.best?.totalPatientPays ?? null)}\n` + financialResult.optimization.dates.map(d => `${financialResult.state.procedures.find(p => p.id === d.id)?.name}: ${d.date}`).join('\n');
    }
    const url = URL.createObjectURL(new Blob([contents], { type: 'text/plain;charset=utf-8' }));
    const link = window.document.createElement('a'); link.href = url; link.download = 'PlanPilot-my-plan.txt'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); setDownloaded(true);
  }

  function askFromPlan(message: string, state: FinancialState | null, draft: FinancialState) {
    if (!turn || busy) return;
    const answer = { id: `followup-${Date.now()}`, prompt: 'A question or correction about my plan', choice: '', text: message };
    const nextAnswers = [...answers, answer]; setAnswers(nextAnswers);
    setHistory([...history, { turn, answer, document, documents, financialState, financialDraft }]);
    void run({ answers: nextAnswers, document, financialState: state, financialDraft: { ...draft, procedures: draft.procedures.map(p => ({ ...p, name: p.name || 'Unspecified procedure' })) }, mode: 'next' });
  }

  const disabled = busy || reading || listening;
  const purpose = turn?.documentPurpose || (/bill|quote|estimate|dentist|treatment/i.test(`${turn?.topic || ''} ${turn?.title || ''}`) ? 'bill' : 'insurance');
  const showUpload = turn?.kind === 'document' || uploadOpen;
  const inputChoices = turn?.kind === 'review' ? (turn.choices.length ? turn.choices : ['Looks right, continue', 'I need to change something']) : turn?.choices || [];
  function editFact(label: string, value: string) { setChoice('I need to change something'); setText(`Please change ${label} from ${value} to `); window.document.getElementById('consult-answer')?.focus(); }
  const key = busy ? 'loading' : error ? 'error' : done ? 'summary' : review ? 'review' : turn?.id || 'initial';
  return open ? <JourneyModal closing={closing} onClose={onClosed} onRequestClose={close} titleId="consultation-title">
    <header className="consult-header"><span className="wordmark">PlanPilot</span><span className="consult-label">YOUR GUIDED JOURNEY</span><div className="consult-appearance"><ThemeToggle /></div><button className="skip" onClick={close}>Close <span aria-hidden="true">×</span></button></header>
    <JourneyTransition stepKey={key}>
      {busy ? <section className="consult-loading" aria-busy="true"><div className="loading-line" /><h2 id="consultation-title" tabIndex={-1}>{document ? 'Making sense of your plan.' : 'Finding your next clear step.'}</h2><p role="status">The consultant is considering what you've shared.</p></section> : error ?
        <section className="consult-error"><p className="journey-context">A moment to reconnect</p><h2 id="consultation-title" tabIndex={-1}>Your answers are still here.</h2><p role="alert">{error}</p><div className="action-row"><button className="primary" onClick={() => pending.current && void run(pending.current)}>Retry <Arrow /></button>{history.length > 0 && <button className="text-button" onClick={back}>Edit last answer</button>}<button className="text-button" onClick={close}>Return to my goals</button></div></section> : review && turn ?
        <section className="consult-body review-body"><div className="consult-prompt"><p className="journey-context"><span /> Your story so far</p><h2 id="consultation-title" tabIndex={-1}>Does this sound<br />like you?</h2><p>A quick check before your plan.</p><button className="primary" onClick={() => { setReview(false); setDone(true); }}>See my plan <Arrow /></button></div>
          <div className="review-answers">{answers.map((answer, index) => <div className="review-answer" key={answer.id}><div><span>{answer.prompt}</span><p>{[answer.choice, answer.text].filter(Boolean).join(' · ')}</p></div>{index > 0 ? <button className="text-button" onClick={() => edit(index - 1)}>Edit</button> : <button className="text-button" onClick={close}>Edit goals</button>}</div>)}{document && <p className="document-note">Attached: {document.name}</p>}</div></section> : done && turn ?
        <section className="summary-body"><div className="summary-heading"><div><p className="journey-context"><span /> A clearer path forward</p><h2 id="consultation-title" tabIndex={-1}>{turn.title}</h2><p>{turn.context}</p></div><button className="voice-button" onClick={exportPlan}>Save my plan <Arrow /></button></div>
          {(financialDraft || financialState || turn.financialProposal)?.procedures.length ? <FinancialWorkspace key={turn.id} initial={financialDraft || financialState || turn.financialProposal || null} initialResult={financialResult} initialView={turn.suggestedView} onDraft={setFinancialDraft} onConfirm={(state, result) => { setFinancialState(state); setFinancialResult(result || null); }} onAsk={askFromPlan} busy={busy} /> : <div className="insurance-summary"><CapturedDetails turn={turn} /><div><h3>Your next moves</h3><ul>{turn.actions.map((action, i) => <li key={i}>{action}</li>)}</ul><FreeResponse id="summary-answer" label="Ask Bili about your insurance" placeholder="Ask a question or share another detail…" value={text} onChange={setText} onListeningChange={setListening} /><button className="voice-button" disabled={disabled || !text.trim()} onClick={() => askFromPlan(text.trim(), financialState, financialDraft || emptyFinancialState)}>Continue with Bili</button></div></div>}
          {!!(financialDraft || financialState || turn.financialProposal)?.procedures.length && <details className="consult-summary-details"><summary>Coverage sources and next steps</summary><div className="fact-grid">{turn.facts.map((fact, index) => <article className="fact-card" key={index}><span className={`fact-basis ${fact.basis}`}>{fact.basis === 'user' ? 'You shared' : fact.basis === 'document' ? 'Document states' : 'To confirm'}</span><h3>{fact.label}</h3><p>{fact.value}</p>{fact.evidence && <details><summary>View source</summary><p>{fact.evidence}</p></details>}</article>)}</div>
          <div className="summary-bottom"><div><h3>Your next moves</h3><ol>{turn.actions.map((action, i) => <li key={i}>{action}</li>)}</ol></div><div><h3>Worth confirming</h3><ul>{turn.uncertainties.map((uncertainty, i) => <li key={i}>{uncertainty}</li>)}</ul><p className="document-note">Confirm benefits with your insurer and treatment choices with your dentist.</p></div></div>

          </details>}<div className="summary-footer">{onViewOverview && <button className="voice-button" onClick={onViewOverview}>View Overview</button>}<button className="text-button" onClick={() => setReview(true)}>Review my answers</button><button className="text-button" onClick={() => void run({ answers, document, mode: 'next' })}>Keep exploring</button>{downloaded && <span role="status">Plan downloaded.</span>}</div></section> : turn ?
        <form className={`consult-body ${turn.kind === 'review' ? 'checkpoint-body' : ''}`} onSubmit={submit}>
          <div className="consult-prompt"><p className="journey-context"><span /> {turn.topic || 'Your next step'}</p><div className="bili-message"><span className="bili-name">Bili <span>Your benefits guide</span></span><h2 id="consultation-title" tabIndex={-1}>{turn.title}</h2><p>{turn.context}</p></div>{turn.kind === 'review' ? <CapturedDetails turn={turn} onEdit={editFact} /> : <CapturedDetails turn={turn} compact />}<div className="consult-navigation">{history.length > 0 && <button type="button" className="text-button" onClick={back} disabled={disabled}>Back</button>}<button type="button" className="text-button" disabled={disabled} onClick={() => void run({ answers, document, mode: 'summary' })}>Make a plan with what I've shared</button></div></div>
          <div className="consult-response">
            <fieldset className={`consult-choices ${turn.kind === 'document' ? 'document-choices' : ''}`}><legend className="sr-only">Choose an answer</legend>{inputChoices.map(option => <label className={`consult-choice ${choice === option ? 'selected' : ''}`} key={option}><input type="radio" name="consult-choice" checked={choice === option} onChange={() => { setChoice(option); setValidation(''); if (/upload/i.test(option)) { setUploadOpen(true); fileInput.current?.click(); } if (/change|type|speak|explain/i.test(option)) window.document.getElementById('consult-answer')?.focus(); }} />{/upload/i.test(option) && <svg className="choice-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 3h7l4 4v14H7V3Zm7 0v5h4M10 12h5m-5 4h5" stroke="currentColor" strokeWidth="1.5" /></svg>}<span>{option}</span><span aria-hidden="true">{choice === option ? '✓' : '›'}</span></label>)}</fieldset>
            <input ref={fileInput} className="sr-only" type="file" accept=".pdf,.jpg,.jpeg,.png" aria-label={purpose === 'bill' ? 'Upload your dentist bill or estimate' : 'Upload your insurance card or plan'} onChange={event => void selectFile(event.target.files?.[0])} />
            {!showUpload && <button type="button" className="text-button upload-alternative" onClick={() => { setUploadOpen(true); fileInput.current?.click(); }}>Or upload {purpose === 'bill' ? 'a bill or price estimate' : 'an insurance card or file'}</button>}
            {showUpload && <>
              <div className={`file-drop ${dragging ? 'dragging' : ''}`} onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); void selectFile(event.dataTransfer.files[0]); }}>
                {reading ? <p role="status">Preparing your document...</p> : document ? <div className="file-selected"><p>{document.name}</p><button type="button" className="text-button" onClick={() => { setDocuments(previous => previous.filter(doc => doc.name !== document?.name)); setDocument(null); setChoice(''); }}>Remove</button></div> : <button type="button" onClick={() => fileInput.current?.click()}><svg className="upload-document-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 3h7l4 4v14H7V3Zm7 0v5h4M10 12h5m-5 4h5" stroke="currentColor" strokeWidth="1.5" /></svg>Drop {purpose === 'bill' ? 'your bill or estimate' : 'your card or plan'} here, or browse<span>PDF, JPG or PNG · up to 10 MB combined</span></button>}
              </div>
              <button type="button" className="text-button examples-button" aria-expanded={examples} onClick={() => setExamples(!examples)}>What can I upload?</button>
              {examples && <p className="document-note">{purpose === 'bill' ? 'A dentist’s itemized bill or price estimate, showing treatment names and prices. Include the page showing what insurance pays, if available.' : 'An insurance card, benefits summary, or plan booklet. A card may name your plan without explaining its coverage; we’ll check what is actually shown.'} Hide personal IDs you don’t need to share.</p>}
              {documents.length > 0 && <div className="attached-documents">{documents.filter(doc => doc.name !== document?.name).map(doc => <div key={doc.name}><span>{doc.name}</span><button type="button" className="text-button" onClick={() => { setDocuments(previous => previous.filter(saved => saved.name !== doc.name)); if (document?.name === doc.name) { setDocument(null); setChoice(''); } }}>Remove file</button></div>)}</div>}
            </>}
            <FreeResponse key={turn.id} id="consult-answer" label="Your own answer or additional context" placeholder="Or tell me in your own words..." value={text} onChange={value => { setText(value); setValidation(''); }} onListeningChange={setListening} />
            {validation && <p className="form-error" role="alert">{validation}</p>}
            <div className="response-actions"><button className="primary" disabled={disabled} type="submit">{turn.kind === 'review' ? text.trim() ? 'Update and continue' : 'Looks right, continue' : 'Continue'} <Arrow /></button><button className="text-button" disabled={disabled} type="button" onClick={event => submit(event, true)}>Skip for now</button></div>
            <p className="document-note">Continue shares your answer{documents.length ? ' and attached documents' : ''} with Gemini. Your answers and extracted details are saved to your demo profile. Original files stay in this visit and aren't stored.</p>
          </div>
        </form> : <section className="consult-loading"><h2 id="consultation-title" tabIndex={-1}>Let's find your next step.</h2></section>}
    </JourneyTransition>
  </JourneyModal> : null;
}
