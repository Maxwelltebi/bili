import { useCallback, useEffect, useRef, useState } from 'react';
import { AppHeader, type Page } from './AppHeader';
import { WelcomeScreen } from './WelcomeScreen';
import { OverviewPage } from './OverviewPage';
import { SettingsPage } from './SettingsPage';
import { IntentScreen } from './IntentScreen';
import { Consultation } from './Consultation';
import { JourneyTransition } from './JourneyModal';
import { cacheAccount, loadAccount, saveProfile, saveSnapshot, type Account, type Profile, type Snapshot } from './accountApi';
import { ThemeProvider, ThemeToggle } from './Theme';
import { BenefitsPage } from './BenefitsPage';
import { reminderDue, usage, type Benefits } from './benefits';
import { formatMoney } from './financeApi';

export function App() {
  return <ThemeProvider><AppContent /></ThemeProvider>;
}

function AppContent() {
  const [account, setAccount] = useState<Account | null>(null);
  const [loadingError, setLoadingError] = useState('');
  const [page, setPage] = useState<Page>('my-plan');
  const [screen, setScreen] = useState<'welcome' | 'intent'>('welcome');
  const [journeyOpen, setJourneyOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [goal, setGoal] = useState('');
  const [explanation, setExplanation] = useState('');
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'error'>('saved');
  const bootstrap = useRef<Promise<Account> | null>(null);
  const accountRef = useRef(account); accountRef.current = account;
  const queued = useRef<Snapshot | null>(null);
  const saving = useRef(false);
  const lastSnapshot = useRef('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const navigate = useCallback((next: Page) => { setPage(next); window.history.replaceState(null, '', `#${next}`); window.scrollTo(0, 0); }, []);
  const initialize = useCallback(async () => {
    setLoadingError('');
    try {
      bootstrap.current ||= loadAccount();
      const loaded = await bootstrap.current;
      setAccount(loaded); accountRef.current = loaded;
      lastSnapshot.current = JSON.stringify(loaded.snapshot);
      setGoal(loaded.snapshot?.goal || ''); setExplanation(loaded.snapshot?.explanation || '');
      navigate(loaded.firstVisit ? 'my-plan' : 'overview');
    } catch (err) { bootstrap.current = null; setLoadingError(err instanceof Error ? err.message : 'Your account could not connect. Please retry.'); }
  }, [navigate]);
  useEffect(() => { void initialize(); }, [initialize]);

  const flush = useCallback(async function persist() {
    if (saving.current || !queued.current || !accountRef.current) return;
    const snapshot = queued.current; queued.current = null;
    const current = accountRef.current; saving.current = true; setSaveStatus('saving');
    let failed = false;
    try {
      const saved = await saveSnapshot(snapshot, current.storage);
      const next = { ...accountRef.current!, snapshot: queued.current || saved };
      cacheAccount(next); accountRef.current = next; setAccount(next); setSaveStatus(queued.current ? 'saving' : 'saved');
    } catch { failed = true; queued.current ||= snapshot; setSaveStatus('error'); }
    finally { saving.current = false; if (queued.current && !failed) void persist(); }
  }, []);
  const recordSnapshot = useCallback((snapshot: Snapshot) => {
    // Consultation updates must retain the independent benefits tracker.
    snapshot = { ...snapshot, benefits: snapshot.benefits || accountRef.current?.snapshot?.benefits };
    const encoded = JSON.stringify(snapshot);
    if (lastSnapshot.current === encoded || !accountRef.current) return;
    lastSnapshot.current = encoded; queued.current = snapshot;
    const next = { ...accountRef.current, snapshot }; accountRef.current = next; setAccount(next); setSaveStatus('saving');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 500);
  }, [flush]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const finishClose = useCallback(() => { setJourneyOpen(false); setClosing(false); void flush(); }, [flush]);
  function start() {
    navigate('my-plan');
    if (account?.snapshot?.answers.length) { setGoal(account.snapshot.goal); setExplanation(account.snapshot.explanation); setScreen('intent'); setClosing(false); setJourneyOpen(true); }
    else setScreen('intent');
  }
  async function updateProfile(profile: Profile) {
    const current = accountRef.current!;
    const saved = await saveProfile(profile, current.storage);
    const next = { ...accountRef.current!, profile: saved }; cacheAccount(next); accountRef.current = next; setAccount(next);
  }
  function recordBenefits(benefits: Benefits) {
    const current = accountRef.current?.snapshot;
    recordSnapshot({ ...(current || { version: 1, goal: '', explanation: '', answers: [], turn: null, history: [], financialState: null, financialDraft: null, documentNames: [] }), benefits });
  }

  if (!account) return <main className="account-loading"><div className="account-loading-brand"><span className="wordmark">PlanPilot</span><ThemeToggle /></div><h1>{loadingError ? 'A moment to reconnect.' : 'Making room for clarity.'}</h1><p role={loadingError ? 'alert' : 'status'}>{loadingError || 'Loading your demo account…'}</p>{loadingError && <button className="primary" onClick={() => void initialize()}>Retry</button>}</main>;
  return <div className="app-shell">
    <AppHeader page={page} profile={account.profile} onNavigate={navigate} />
    {page !== 'benefits' && account.snapshot?.benefits && reminderDue(account.snapshot.benefits) && <aside className="benefits-reminder-bar" role="status"><span>{usage(account.snapshot.benefits).remaining === null ? 'Check unused dental benefits' : `${formatMoney(usage(account.snapshot.benefits).remaining)} in dental benefits remaining`} · Your plan year ends {account.snapshot.benefits.financialState.plan.benefitYearEnd}.</span><button className="text-button" onClick={() => navigate('benefits')}>Review benefits →</button></aside>}
    <div className="save-indicator" role="status">{saveStatus === 'error' ? <><span>Progress couldn’t save. Your current answers are still here.</span><button className="text-button" onClick={() => void flush()}>Retry saving</button></> : saveStatus === 'saving' ? 'Saving your progress…' : account.snapshot ? account.storage === 'supabase' ? 'Your progress is saved' : 'Progress saved on this device' : 'Automatically signed in · Demo account'}</div>
    <JourneyTransition stepKey={`${page}:${page === 'my-plan' ? screen : ''}`}>
      {page === 'overview' ? <OverviewPage profile={account.profile} snapshot={account.snapshot} onContinue={start} onBenefits={() => navigate('benefits')} /> : page === 'benefits' ? <BenefitsPage snapshot={account.snapshot} onChange={recordBenefits} onConsult={start} /> : page === 'settings' ? <SettingsPage profile={account.profile} storage={account.storage} onSave={updateProfile} /> : screen === 'welcome' ? <WelcomeScreen returning={!!account.snapshot?.answers.length} onBegin={start} /> : <IntentScreen showHeader={false} selected={goal} explanation={explanation} onChange={(nextGoal, nextExplanation) => { setGoal(nextGoal); setExplanation(nextExplanation); }} onExit={() => setScreen('welcome')} onContinue={() => { setClosing(false); setJourneyOpen(true); }} />}
    </JourneyTransition>
    <Consultation open={journeyOpen} closing={closing} goal={goal} explanation={explanation} initialSnapshot={account.snapshot} onSnapshot={recordSnapshot} onRequestClose={() => setClosing(true)} onClosed={finishClose} onViewOverview={() => { setClosing(true); navigate('overview'); void flush(); }} />
  </div>;
}
