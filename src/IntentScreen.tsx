import { useEffect, useRef, useState, type FormEvent } from 'react';
import { FreeResponse } from './FreeResponse';

const goals = [
  { id: 'treatment', label: 'I have upcoming dental treatment', detail: 'Know what to expect before your appointment.', path: 'M8 3C4 3 3 7 5 11c1 2 1 9 3 10 2 0 1-7 4-7s2 7 4 7c2-1 2-8 3-10 2-4 1-8-3-8-2 0-2 1-4 1S10 3 8 3Z' },
  { id: 'insurance', label: 'I want to understand my insurance', detail: 'Make sense of what your plan covers.', path: 'M6 3h8l4 4v14H6V3Zm8 0v5h4M9 12h6m-6 4h6' },
  { id: 'expenses', label: 'I want to reduce my dental expenses', detail: 'Find a clearer path through the costs.', path: 'M4 20h16M6 16v-5h3v5m3 0V7h3v9m3 0V3h3v13' },
  { id: 'options', label: "I'm comparing treatment options", detail: 'Understand your options side by side.', path: 'M4 6h16v15H4V6Zm4-3v6m8-6v6M4 11h16M8 15h2m4 0h2m-8 3h2' },
  { id: 'unsure', label: "I'm not really sure yet", detail: 'A good place to start is right here.', path: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-6-3-2 5-4 1 2-5 4-1Z' },
];

type Props = { selected: string; explanation: string; onChange: (goal: string, explanation: string) => void; onExit: () => void; onContinue: () => void; showHeader?: boolean };

export function IntentScreen({ selected, explanation, onChange, onExit, onContinue, showHeader = true }: Props) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [error, setError] = useState('');
  const [listening, setListening] = useState(false);
  useEffect(() => { heading.current?.focus(); }, []);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (listening) return;
    if (!selected && !explanation.trim()) {
      setError('Choose a goal or tell us what brings you here.');
      return;
    }
    setError('');
    onContinue();
  }
  return <section className="onboarding">
    {showHeader && <header className="header">
      <button className="wordmark brand-button" onClick={onExit} aria-label="PlanPilot, return to welcome">PlanPilot<span className="brand-stroke" aria-hidden="true" /></button>
      <span className="header-note">A clearer path to dental care</span>
      <button className="skip" onClick={onExit}>Exit <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg></button>
    </header>}
    <div className="onboarding-layout">
      <aside className="onboarding-story">
        <p className="eyebrow"><span /> A LITTLE DIRECTION GOES A LONG WAY</p>
        <h2>Your care.<br />Your choices.<br /><span>Your next step.</span></h2>
        <p>Start with what matters to you.</p>
        <div className="story-image" aria-hidden="true" />
        <div className="story-caption">Clarity starts with a conversation.</div>
      </aside>
      <section className="intent-panel" aria-labelledby="intent-title">
        <p className="journey-context"><span aria-hidden="true" /> Getting to know you</p>
        <h1 id="intent-title" ref={heading} tabIndex={-1}>What brings you<br className="desktop-break" /> here today?</h1>
        <p className="intent-intro">Choose, type, or speak. This is your starting point.</p>
        <form onSubmit={submit}>
          <fieldset className="goal-list" aria-describedby={error ? 'goal-error' : undefined}>
            <legend className="sr-only">Choose your main dental care goal</legend>
            {goals.map(goal => <label className={`goal-card ${selected === goal.id ? 'selected' : ''}`} key={goal.id}>
              <input type="radio" name="goal" value={goal.id} checked={selected === goal.id} onChange={() => { onChange(goal.id, explanation); setError(''); }} />
              <svg className="goal-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d={goal.path} stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
              <span className="goal-copy"><span>{goal.label}</span></span>
              <span className="selection-mark" aria-hidden="true">{selected === goal.id ? <svg viewBox="0 0 24 24" fill="none"><path d="m5 12 4 4 10-10" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg> : <svg viewBox="0 0 24 24" fill="none"><path d="m9 6 6 6-6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>}</span>
            </label>)}
          </fieldset>
          <div className="custom-answer">
            <div className="input-divider"><span /> In your own words <span /></div>
            <FreeResponse id="explanation" label="What brings you here? Optional when a goal is selected." placeholder="Anything else you'd like to say?" value={explanation} onChange={text => { onChange(selected, text); setError(''); }} onListeningChange={setListening} />
          </div>
          {error && <p id="goal-error" className="form-error" role="alert">{error}</p>}
          <button className="primary intent-continue" type="submit" disabled={listening}>Continue <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg></button>
          <p className="intent-note">Continue shares your answers with Gemini to guide your journey.</p>
        </form>
      </section>
    </div>
  </section>;
}
