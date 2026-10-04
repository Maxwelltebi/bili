import { useEffect, useRef, useState } from 'react';
import type { Snapshot } from './accountApi';
import { FinancialWorkspace } from './FinancialWorkspace';
import { calculateEstimate, formatMoney, type Estimate, type FinancialState } from './financeApi';
import { compareNetworkCosts, createBenefits, currentClaims, daysUntil, downloadCalendar, localToday, normalizeBenefits, reminderDue, usage, type Benefits, type Claim, type NetworkQuote, type NetworkResult } from './benefits';

type Tab = 'usage' | 'care' | 'network' | 'reminders';
const tabs: [Tab, string][] = [['usage', 'Annual usage'], ['care', 'Care sequence'], ['network', 'Network costs'], ['reminders', 'Reminders']];
function Amount({ label, value, onChange, percent = false }: { label: string; value: number | null; onChange: (value: number | null) => void; percent?: boolean }) {
  return <label className="finance-field"><span>{label}{percent ? ' (%)' : ' (USD)'}</span><input type="number" min="0" max={percent ? 100 : 1000000} step={percent ? '0.1' : '0.01'} value={value ?? ''} placeholder="Not sure" onChange={event => { const value = event.target.value === '' ? null : Number(event.target.value); if (value === null || Number.isFinite(value) && value >= 0 && value <= (percent ? 100 : 1000000)) onChange(value === null ? null : Math.round(value * (percent ? 10 : 100)) / (percent ? 10 : 100)); }} /></label>;
}
function DateInput({ label, value, onChange }: { label: string; value: string | null; onChange: (value: string | null) => void }) {
  return <label className="finance-field"><span>{label}</span><input type="date" value={value || ''} onChange={event => onChange(event.target.value || null)} /></label>;
}
function YesNo({ label, value, onChange }: { label: string; value: boolean | null; onChange: (value: boolean | null) => void }) {
  return <label className="finance-field"><span>{label}</span><select value={value === null ? '' : String(value)} onChange={event => onChange(event.target.value === '' ? null : event.target.value === 'true')}><option value="">Not sure</option><option value="true">Yes</option><option value="false">No</option></select></label>;
}

export function BenefitsPage({ snapshot, onChange, onConsult, initialTab = 'usage' }: { snapshot: Snapshot | null; onChange: (data: Benefits) => void; onConsult: () => void; initialTab?: Tab }) {
  const [data, setData] = useState<Benefits>(() => snapshot?.benefits || createBenefits(snapshot?.financialState || snapshot?.financialDraft || null, !!snapshot?.financialState));
  const [tab, setTab] = useState<Tab>(initialTab);
  const [result, setResult] = useState<Estimate | null>(null);
  const [networkResult, setNetworkResult] = useState<NetworkResult | null>(null);
  const [error, setError] = useState('');
  const [networkBusy, setNetworkBusy] = useState(false);
  const [networkConfirmed, setNetworkConfirmed] = useState(false);
  const [workspaceKey, setWorkspaceKey] = useState(0);
  const [claim, setClaim] = useState<Claim>(() => ({ id: crypto.randomUUID(), name: '', date: localToday(), insurerPaid: 0, deductiblePaid: 0 }));
  const [editingClaim, setEditingClaim] = useState<string | null>(null);
  const networkAbort = useRef<AbortController | null>(null);
  const initialized = useRef(false);
  const balance = usage(data), plan = data.financialState.plan;
  const current = currentClaims(data);
  const planned = result?.calculation.benefitUsage.find(row => row.period === 'current');

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    if (!snapshot?.benefits) onChange(normalizeBenefits(data));
  }, [snapshot, data, onChange]);

  useEffect(() => {
    setResult(null);
    if (!data.confirmed || !data.financialState.procedures.length) return;
    const abort = new AbortController();
    void calculateEstimate(data.financialState, null, abort.signal).then(value => { if (!abort.signal.aborted) { setResult(value); setError(''); } }).catch(error => { if (!abort.signal.aborted) setError(error instanceof Error ? error.message : 'Could not update planned usage.'); });
    return () => abort.abort();
  }, [data.financialState, data.confirmed]);
  useEffect(() => () => networkAbort.current?.abort(), []);
  function save(next: Benefits) {
    const normalized = normalizeBenefits(next);
    networkAbort.current?.abort(); setNetworkBusy(false); setNetworkResult(null); setNetworkConfirmed(false); setError('');
    setData(normalized); onChange(normalized);
  }
  function updatePlan(patch: Partial<FinancialState['plan']>) {
    const openingDeductible = 'remainingDeductible' in patch ? patch.remainingDeductible === null ? null : (patch.remainingDeductible ?? 0) + current.reduce((sum, claim) => sum + claim.deductiblePaid, 0) : data.openingDeductible;
    save({ ...data, openingDeductible, confirmed: false, financialState: { ...data.financialState, plan: { ...plan, ...patch } } });
  }
  function updateFinancial(next: FinancialState, confirmed = false) {
    const balanceChanged = next.plan.remainingBenefit !== plan.remainingBenefit || next.plan.annualMaximum !== plan.annualMaximum;
    const openingUsed = balanceChanged ? next.plan.annualMaximum !== null && next.plan.remainingBenefit !== null ? Math.max(0, next.plan.annualMaximum - next.plan.remainingBenefit - balance.paid) : null : data.openingUsed;
    const openingDeductible = next.plan.remainingDeductible !== plan.remainingDeductible ? next.plan.remainingDeductible === null ? null : next.plan.remainingDeductible + current.reduce((sum, claim) => sum + claim.deductiblePaid, 0) : data.openingDeductible;
    save({ ...data, openingUsed, openingDeductible, confirmed, financialState: next, network: { in: { ...data.network.in, quotes: data.network.in.quotes.filter(q => next.procedures.some(p => p.id === q.procedureId)) }, out: { ...data.network.out, quotes: data.network.out.quotes.filter(q => next.procedures.some(p => p.id === q.procedureId)) } } });
  }
  function saveClaim(event: React.FormEvent) {
    event.preventDefault();
    if (!plan.benefitYearStart || !plan.benefitYearEnd) { setError('Add the plan year start and end before recording a claim.'); return; }
    if (plan.annualMaximum === null || data.openingUsed === null) { setError('Add your annual maximum and previously used benefits first. Enter 0 if you have not used any benefits.'); return; }
    if (!claim.name.trim()) { setError('Enter a treatment or claim name.'); return; }
    if (claim.date < plan.benefitYearStart || claim.date > plan.benefitYearEnd || claim.date > localToday()) { setError('Use a paid claim date within this plan year, on or before today.'); return; }
    const claims = editingClaim ? data.claims.map(item => item.id === editingClaim ? { ...claim, name: claim.name.trim() } : item) : [...data.claims, { ...claim, name: claim.name.trim() }];
    if (claims.length > 300) { setError('This tracker supports up to 300 claims.'); return; }
    const next = { ...data, claims };
    if (usage(next).used! > plan.annualMaximum) { setError('These payments exceed your annual maximum. Check the claim amount and benefits used before tracking.'); return; }
    save(next); setEditingClaim(null); setClaim({ id: crypto.randomUUID(), name: '', date: localToday(), insurerPaid: 0, deductiblePaid: 0 });
  }
  function removeClaim(item: Claim) {
    save({ ...data, claims: data.claims.filter(c => c.id !== item.id) });
    if (editingClaim === item.id) { setEditingClaim(null); setClaim({ id: crypto.randomUUID(), name: '', date: localToday(), insurerPaid: 0, deductiblePaid: 0 }); }
  }
  function importPlan() {
    const source = snapshot?.financialState || snapshot?.financialDraft;
    if (!source) return;
    const imported = createBenefits(source, !!snapshot?.financialState);
    imported.claims = data.claims; imported.reminders = data.reminders;
    imported.openingUsed = imported.openingUsed === null ? null : Math.max(0, imported.openingUsed - usage(imported).paid);
    imported.openingDeductible = source.plan.remainingDeductible === null ? null : source.plan.remainingDeductible + currentClaims(imported).reduce((sum, claim) => sum + claim.deductiblePaid, 0);
    save(imported); setWorkspaceKey(key => key + 1);
  }
  function rollover() {
    if (!plan.benefitYearEnd || !plan.renewalConfirmed || plan.nextYearAnnualMaximum === null || plan.nextYearDeductible === null) return;
    const startDate = new Date(`${plan.benefitYearEnd}T12:00:00Z`); startDate.setUTCDate(startDate.getUTCDate() + 1);
    const start = startDate.toISOString().slice(0, 10); startDate.setUTCFullYear(startDate.getUTCFullYear() + 1); startDate.setUTCDate(startDate.getUTCDate() - 1);
    const procedures = data.financialState.procedures.filter(p => !p.date || p.date >= start);
    save({ ...data, openingUsed: 0, openingDeductible: plan.nextYearDeductible, confirmed: false, financialState: { ...data.financialState, plan: { ...plan, benefitYearStart: start, benefitYearEnd: startDate.toISOString().slice(0, 10), annualMaximum: plan.nextYearAnnualMaximum, remainingBenefit: plan.nextYearAnnualMaximum, annualDeductible: plan.nextYearDeductible, remainingDeductible: plan.nextYearDeductible, nextYearAnnualMaximum: null, nextYearDeductible: null, renewalConfirmed: false }, procedures: procedures.map(p => ({ ...p, dependsOn: p.dependsOn.filter(id => procedures.some(other => other.id === id)) })) }, network: createBenefits().network });
    setWorkspaceKey(key => key + 1);
  }
  function networkQuote(key: 'in' | 'out', id: string): NetworkQuote {
    return data.network[key].quotes.find(q => q.procedureId === id) || { procedureId: id, quote: null, allowedAmount: null, insurancePercent: null, covered: null, deductibleApplies: null };
  }
  function updateQuote(key: 'in' | 'out', id: string, patch: Partial<NetworkQuote>) {
    const quotes = [...data.network[key].quotes.filter(q => q.procedureId !== id), { ...networkQuote(key, id), ...patch }];
    save({ ...data, network: { ...data.network, [key]: { ...data.network[key], quotes } } });
  }
  async function compare() {
    const abort = new AbortController(); networkAbort.current?.abort(); networkAbort.current = abort; setNetworkBusy(true); setError('');
    try { const output = await compareNetworkCosts(data.financialState, data.network, abort.signal); if (!abort.signal.aborted) setNetworkResult(output); }
    catch (error) { if (!abort.signal.aborted) setError(error instanceof Error ? error.message : 'Could not compare network costs.'); }
    finally { if (networkAbort.current === abort) setNetworkBusy(false); }
  }

  return <main className="account-page benefits-page">
    <div className="page-heading"><div><p className="eyebrow"><span /> MAKE YOUR BENEFITS GO FURTHER</p><h1>Your benefits, all year.</h1><p>Track paid claims, plan your care, and keep renewal in sight.</p></div><button className="voice-button" onClick={onConsult}>Plan with Bili <span aria-hidden="true">→</span></button></div>
    {reminderDue(data) && <aside className="benefits-alert" role="status"><div><strong>{balance.remaining === null ? 'Check your unused benefits' : `${formatMoney(balance.remaining)} in benefits remaining`}</strong><p>Your plan year ends {plan.benefitYearEnd}, in {daysUntil(plan.benefitYearEnd!)} days. Discuss any recommended care with your dentist.</p></div><button className="text-button" onClick={() => save({ ...data, reminders: { ...data.reminders, dismissedYearEnd: plan.benefitYearEnd } })}>Dismiss for this plan year</button></aside>}
    <section className="overview-metrics" aria-label="Annual benefits usage"><article className="metric-card"><span>Annual maximum</span><strong>{formatMoney(balance.maximum)}</strong><small>{plan.benefitYearStart && plan.benefitYearEnd ? `${plan.benefitYearStart} — ${plan.benefitYearEnd}` : 'Add your actual plan year dates below.'}</small></article><article className="metric-card"><span>Benefits used</span><strong>{formatMoney(balance.used)}</strong><small>Previously used amount plus recorded insurer payments.</small></article><article className="metric-card featured"><span>Benefits remaining</span><strong>{formatMoney(balance.remaining)}</strong><small>{planned && !planned.incomplete ? `${formatMoney(planned.remainingBenefit)} projected after planned care.` : 'Planned care is separate from paid claims.'}</small></article></section>
    {balance.maximum !== null && balance.used !== null && <div className="benefits-progress"><div className="benefits-progress-label"><span>Annual maximum used</span><strong>{balance.maximum === 0 ? 0 : Math.min(100, Math.round(balance.used / balance.maximum * 100))}%</strong></div><progress aria-label="Annual maximum used" value={Math.min(balance.used, balance.maximum)} max={balance.maximum || 1} /></div>}
    <div className="finance-tabs benefits-tabs" role="tablist" aria-label="Benefits tools">{tabs.map(([id, label]) => <button key={id} id={`benefits-tab-${id}`} role="tab" aria-controls={`benefits-panel-${id}`} aria-selected={tab === id} onClick={() => { setTab(id); setError(''); }}>{label}</button>)}</div>
    <section className="benefits-panel" id={`benefits-panel-${tab}`} role="tabpanel" aria-labelledby={`benefits-tab-${tab}`}>
      {tab === 'usage' && <>
        <div className="section-heading"><h2>Your yearly allowance</h2>{(snapshot?.financialState || snapshot?.financialDraft) && <button className="text-button" onClick={importPlan}>Use consultation details</button>}</div>
        <p className="finance-note">Use the dates and paid amounts from your insurer. Previously used benefits should exclude claims you record below. Imported balances include logged claims; check the previously used amount.</p>
        <div className="finance-fields benefits-fields"><DateInput label="Plan year starts" value={plan.benefitYearStart} onChange={value => updatePlan({ benefitYearStart: value })} /><DateInput label="Plan year ends" value={plan.benefitYearEnd} onChange={value => updatePlan({ benefitYearEnd: value })} /><Amount label="Annual benefit maximum" value={plan.annualMaximum} onChange={value => updatePlan({ annualMaximum: value })} /><Amount label="Benefits used before tracking" value={data.openingUsed} onChange={value => save({ ...data, openingUsed: value })} /><Amount label="Remaining amount you pay first" value={plan.remainingDeductible} onChange={value => updatePlan({ remainingDeductible: value })} /></div>
        {balance.maximum !== null && balance.used !== null && balance.used > balance.maximum && <p className="form-error" role="alert">Used benefits exceed the annual maximum. Check your amounts before planning more care.</p>}
        <div className="benefits-divider"><h2>{editingClaim ? 'Edit a paid claim' : 'Record a paid claim'}</h2><p className="finance-note">Record the insurer's actual payment, not the dentist's full fee or a pending estimate. A claim must fall within this plan year.</p></div>
        <form className="claim-form" onSubmit={saveClaim}><div className="finance-fields benefits-fields"><label className="finance-field"><span>Treatment or claim name</span><input required maxLength={100} value={claim.name} onChange={event => setClaim({ ...claim, name: event.target.value })} placeholder="e.g. Cleaning, claim #123" /></label><DateInput label="Claim date" value={claim.date} onChange={value => setClaim({ ...claim, date: value || '' })} /><Amount label="Insurer paid" value={claim.insurerPaid} onChange={value => setClaim({ ...claim, insurerPaid: value ?? 0 })} /><Amount label="Applied to your deductible" value={claim.deductiblePaid} onChange={value => setClaim({ ...claim, deductiblePaid: value ?? 0 })} /></div><div className="benefits-actions"><button className="primary" type="submit" disabled={!plan.benefitYearStart || !plan.benefitYearEnd || !claim.date || data.claims.length >= 300 && !editingClaim}>{editingClaim ? 'Save claim changes' : 'Add paid claim'}</button>{editingClaim && <button type="button" className="text-button" onClick={() => { setEditingClaim(null); setClaim({ id: crypto.randomUUID(), name: '', date: localToday(), insurerPaid: 0, deductiblePaid: 0 }); }}>Cancel edit</button>}</div></form>
        <div className="benefits-divider"><h2>Paid claim history</h2><p className="finance-note">{current.length} claim{current.length === 1 ? '' : 's'} in this plan year. Earlier years stay in your history.</p></div>
        {!data.claims.length ? <p className="benefits-empty">No paid claims recorded yet. Your starting balance stays separate.</p> : <div className="claim-list">{[...data.claims].sort((a, b) => b.date.localeCompare(a.date)).map(item => <article className="claim-row" key={item.id}><div><h3>{item.name}</h3><p>{item.date}{current.some(c => c.id === item.id) ? ' · This plan year' : ' · Another plan year'}</p></div><div><strong>{formatMoney(item.insurerPaid)}</strong><small>Insurer paid</small></div><div className="benefits-actions">{current.some(c => c.id === item.id) && <button className="text-button" aria-label={`Edit ${item.name}`} onClick={() => { setClaim(item); setEditingClaim(item.id); }}>Edit</button>}<button className="text-button" aria-label={`Remove ${item.name}`} onClick={() => removeClaim(item)}>Remove</button></div></article>)}</div>}
        {plan.benefitYearEnd && daysUntil(plan.benefitYearEnd) < 0 && <div className="benefits-alert"><div><strong>Your plan year has ended.</strong><p>Confirm next-year amounts in Care sequence, then start a new year. Paid claim history is retained.</p></div><button className="voice-button" disabled={!plan.renewalConfirmed || plan.nextYearAnnualMaximum === null || plan.nextYearDeductible === null} onClick={rollover}>Start next plan year</button></div>}
      </>}
      {tab === 'care' && <><div className="section-heading"><h2>A sequence that fits your plan</h2></div><p className="finance-note">Add your dentist's treatments in Your quote, then compare approved dates across this plan year and the next. The calculation uses your tracked remaining benefits. Remove completed treatments here so they are not projected again.</p>
        {data.financialState.procedures.length > 0 && <ol className="care-timeline">{[...data.financialState.procedures].sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999')).map(p => { const row = result?.calculation.rows.find(row => row.id === p.id); return <li key={p.id}><span className="timeline-dot" /><div><small>{p.date || 'Date to confirm'}{p.date && plan.benefitYearEnd ? p.date > plan.benefitYearEnd ? ' · Next plan year' : ' · This plan year' : ''}</small><h3>{p.name}</h3>{p.dependsOn.length > 0 && <p>After: {p.dependsOn.map(id => data.financialState.procedures.find(other => other.id === id)?.name).join(', ')}</p>}<p>{row ? `You may pay ${formatMoney(row.patientPays)} · Plan may pay ${formatMoney(row.insurerPays)}` : 'Review your quote and coverage to calculate costs.'}</p></div></li>; })}</ol>}
        <FinancialWorkspace key={workspaceKey} initial={data.financialState} initialView={data.financialState.procedures.length ? 'schedule' : 'cost'} hideFollowup onDraft={state => updateFinancial(state)} onConfirm={(state, output) => { if (state) { updateFinancial(state, true); setResult(output || null); } else save({ ...data, confirmed: false }); }} onAsk={onConsult} />
      </>}
      {tab === 'network' && <><div className="section-heading"><h2>Same care. Two network options.</h2></div><p className="finance-note">Compare actual full-fee quotes and procedure-specific coverage. A dentist with agreed prices uses the contracted fee; an out-of-network dentist may bill the amount above your plan's allowed fee.</p>
        {!data.financialState.procedures.length ? <div className="benefits-empty"><p>Add your treatments and quotes in Care sequence, or bring them in through Bili.</p><button className="voice-button" onClick={() => setTab('care')}>Add treatments</button></div> : <>
          <button className="text-button" onClick={() => save({ ...data, network: { in: { ...data.network.in, remainingBenefit: balance.remaining, remainingDeductible: plan.remainingDeductible }, out: { ...data.network.out, remainingBenefit: balance.remaining, remainingDeductible: plan.remainingDeductible } } })}>Use tracked balances for both networks (if your plan shares them)</button>
          <div className="network-columns">{(['in', 'out'] as const).map(key => <section className="network-card" key={key} aria-label={key === 'in' ? 'In-network inputs' : 'Out-of-network inputs'}><span className="status-pill">{key === 'in' ? 'IN-NETWORK' : 'OUT-OF-NETWORK'}</span><h3>{key === 'in' ? 'Agreed prices with your plan' : 'No agreed prices with your plan'}</h3><div className="finance-fields"><Amount label="Remaining deductible for this network" value={data.network[key].remainingDeductible} onChange={value => save({ ...data, network: { ...data.network, [key]: { ...data.network[key], remainingDeductible: value } } })} /><Amount label="Remaining benefits for this network" value={data.network[key].remainingBenefit} onChange={value => save({ ...data, network: { ...data.network, [key]: { ...data.network[key], remainingBenefit: value } } })} /></div>
            {data.financialState.procedures.map(p => { const quote = networkQuote(key, p.id); return <div className="network-treatment" key={p.id}><h4>{p.name}</h4><div className="finance-fields"><Amount label="Dentist full-fee quote" value={quote.quote} onChange={value => updateQuote(key, p.id, { quote: value })} /><Amount label={key === 'in' ? 'Contracted fee' : 'Plan allowed fee'} value={quote.allowedAmount} onChange={value => updateQuote(key, p.id, { allowedAmount: value })} /><Amount label="Plan payment percentage" percent value={quote.insurancePercent} onChange={value => updateQuote(key, p.id, { insurancePercent: value })} /><YesNo label="This treatment is covered" value={quote.covered} onChange={value => updateQuote(key, p.id, { covered: value })} /><YesNo label="Deductible applies to this treatment" value={quote.deductibleApplies} onChange={value => updateQuote(key, p.id, { deductibleApplies: value })} /></div></div>; })}
          </section>)}</div>
          <label className="finance-check"><input type="checkbox" checked={networkConfirmed} onChange={event => { setNetworkConfirmed(event.target.checked); if (!event.target.checked) setNetworkResult(null); }} />I checked both quotes and each network's coverage details</label><button className="primary" disabled={!networkConfirmed || networkBusy} onClick={() => void compare()}>{networkBusy ? 'Comparing…' : 'Compare network costs'}</button>
        </>}
        {networkResult && <div className="network-comparison" aria-live="polite"><div className="overview-metrics"><article className="metric-card featured"><span>In-network: you may pay</span><strong>{formatMoney(networkResult.inNetwork.totalPatientPays)}</strong></article><article className="metric-card"><span>Out-of-network: you may pay</span><strong>{formatMoney(networkResult.outOfNetwork.totalPatientPays)}</strong></article><article className="metric-card"><span>{networkResult.difference !== null && networkResult.difference < 0 ? 'Potential savings out of network' : 'Potential savings in network'}</span><strong>{formatMoney(networkResult.difference === null ? null : Math.abs(networkResult.difference))}</strong><small>Only shown when both estimates have complete inputs.</small></article></div><div className="network-columns">{([['In-network breakdown', networkResult.inNetwork], ['Out-of-network breakdown', networkResult.outOfNetwork]] as const).map(([title, calculation]) => <section key={title}><h3>{title}</h3>{calculation.rows.map(row => <div className="network-breakdown" key={row.id}><h4>{row.name}</h4><dl><div><dt>Price used by the plan</dt><dd>{formatMoney(row.eligibleFee)}</dd></div><div><dt>Deductible applied</dt><dd>{formatMoney(row.deductible)}</dd></div><div><dt>Plan may pay</dt><dd>{formatMoney(row.insurerPays)}</dd></div><div><dt>You may pay</dt><dd>{formatMoney(row.patientPays)}</dd></div></dl></div>)}{calculation.warnings.length > 0 && <ul className="finance-note">{calculation.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>}</section>)}</div></div>}
      </>}
      {tab === 'reminders' && <><div className="section-heading"><h2>A nudge before benefits expire</h2></div><p className="finance-note">See a reminder when you open PlanPilot near the end of your plan year. Import a calendar reminder to receive a notification from your calendar app.</p><label className="finance-check"><input type="checkbox" checked={data.reminders.enabled} onChange={event => save({ ...data, reminders: { ...data.reminders, enabled: event.target.checked, dismissedYearEnd: null } })} />Show reminders for unused benefits</label><div className="finance-fields benefits-fields"><DateInput label="Benefits expire on" value={plan.benefitYearEnd} onChange={value => updatePlan({ benefitYearEnd: value })} /><label className="finance-field"><span>Remind me before the year ends</span><select value={data.reminders.leadDays} onChange={event => save({ ...data, reminders: { ...data.reminders, leadDays: Number(event.target.value) as Benefits['reminders']['leadDays'], dismissedYearEnd: null } })}><option value={14}>2 weeks before</option><option value={30}>30 days before</option><option value={60}>60 days before</option><option value={90}>90 days before</option></select></label></div>
        <div className="reminder-preview"><span className="status-pill">YOUR REMINDER</span><h3>{balance.remaining === null ? 'Check your unused dental benefits.' : `You have ${formatMoney(balance.remaining)} in benefits remaining.`}</h3><p>{plan.benefitYearEnd ? `Your plan year ends ${plan.benefitYearEnd}. ` : 'Add your plan year end date. '}Review dentist-recommended care and confirm coverage before booking.</p>{plan.benefitYearEnd && <p className="finance-note">{daysUntil(plan.benefitYearEnd) < 0 ? 'This plan year has ended. Update your year before exporting a reminder.' : `Reminder window begins ${data.reminders.leadDays} days before your plan year ends.`}</p>}</div><div className="benefits-actions"><button className="primary" disabled={!plan.benefitYearEnd || daysUntil(plan.benefitYearEnd) < 0} onClick={() => downloadCalendar(plan.benefitYearEnd!, data.reminders.leadDays)}>Download calendar reminder</button>{data.reminders.dismissedYearEnd && <button className="text-button" onClick={() => save({ ...data, reminders: { ...data.reminders, dismissedYearEnd: null } })}>Restore dismissed reminder</button>}</div><p className="finance-note">Calendar exports contain a general benefits reminder, without treatment or claim details. PlanPilot does not send email or background notifications.</p>
      </>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </section>
  </main>;
}
