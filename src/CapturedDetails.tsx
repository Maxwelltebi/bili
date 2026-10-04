import type { Turn } from './consultationApi';

export function CapturedDetails({ turn, onEdit, compact = false }: { turn: Turn; onEdit?: (label: string, value: string) => void; compact?: boolean }) {
  const facts = turn.facts.filter(f => f.basis !== 'unknown').slice(0, compact ? 3 : 6);
  const missing = [...turn.facts.filter(f => f.basis === 'unknown').map(f => f.label), ...turn.uncertainties].slice(0, compact ? 2 : 4);
  if (!facts.length && !missing.length) return null;
  return <section className={`captured-details ${compact ? 'compact' : ''}`} aria-label="What we know and still need">
    {facts.length > 0 && <><h3>{compact ? 'What we know' : 'Your details so far'}</h3><dl>{facts.map((fact, i) => <div className="captured-row" key={i}><dt>{fact.label}</dt><dd><strong>{fact.value}</strong><span>{fact.basis === 'document' ? 'From your file' : 'You shared'}{onEdit && <button type="button" className="text-button" onClick={() => onEdit(fact.label, fact.value)}>Edit</button>}</span>{fact.evidence && !compact && <details><summary>See source</summary><p>{fact.evidence}</p></details>}</dd></div>)}</dl></>}
    {missing.length > 0 && <div className="captured-missing"><h3>Still to check</h3><ul>{missing.map((item, i) => <li key={i}>{item}</li>)}</ul><p>It’s okay if you don’t know. We’ll work with what you have.</p></div>}
  </section>;
}
