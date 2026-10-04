import { useEffect, useRef, useState } from 'react';
import type { Profile } from './accountApi';
import { ThemeToggle } from './Theme';

export type Page = 'overview' | 'my-plan' | 'settings';
const pages: { id: Page; title: string; detail: string; path: string }[] = [
  { id: 'overview', title: 'Overview', detail: 'Your insurance, at a glance', path: 'M3 3h7v7H3V3Zm11 0h7v7h-7V3ZM3 14h7v7H3v-7Zm11 0h7v7h-7v-7Z' },
  { id: 'my-plan', title: 'My Plan', detail: 'Find clarity with Bili', path: 'M6 3h8l4 4v14H6V3Zm8 0v5h4M9 12h6m-6 4h6' },
  { id: 'settings', title: 'Settings', detail: 'Your profile and account', path: 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-3a8 8 0 0 1 16 0v3' },
];
export function AppHeader({ page, profile, onNavigate }: { page: Page; profile: Profile; onNavigate: (page: Page) => void }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const drawer = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (!open) return; const element = drawer.current!; const previous = document.body.style.overflow; document.body.style.overflow = 'hidden'; element.showModal(); return () => { element.close(); document.body.style.overflow = previous; }; }, [open]);
  function close() { setOpen(false); requestAnimationFrame(() => button.current?.focus()); }
  function navigate(next: Page) { close(); onNavigate(next); }
  return <>
    <header className="app-header">
      <button className="menu-toggle" ref={button} onClick={() => setOpen(true)} aria-label="Open navigation menu" aria-expanded={open} aria-controls="app-navigation"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg></button>
      <button className="wordmark brand-button" onClick={() => onNavigate('overview')} aria-label="PlanPilot overview">PlanPilot</button>
      <span className="app-page-label">{pages.find(p => p.id === page)?.title}</span>
      <div className="header-appearance"><ThemeToggle /></div>
      <button className="account-chip" onClick={() => onNavigate('settings')} aria-label="Open your profile"><span className="profile-initials">{profile.name.split(/\s+/).map(s => s[0]).slice(0, 2).join('')}</span><span>{profile.name}<small>Demo account</small></span></button>
    </header>
    {open && <dialog id="app-navigation" ref={drawer} className="navigation-drawer" aria-labelledby="navigation-title" onCancel={event => { event.preventDefault(); close(); }} onClick={event => { if (event.target === event.currentTarget) close(); }}>
      <div className="drawer-heading"><span id="navigation-title" className="wordmark">PlanPilot</span><button className="menu-toggle" onClick={close} aria-label="Close navigation menu"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg></button></div>
      <p className="drawer-intro">Your benefits. A clearer direction.</p>
      <nav aria-label="Main navigation">{pages.map(item => <button key={item.id} aria-label={item.title} className={`navigation-link ${page === item.id ? 'active' : ''}`} aria-current={page === item.id ? 'page' : undefined} onClick={() => navigate(item.id)}><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d={item.path} stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /></svg><span>{item.title}<small>{item.detail}</small></span><span aria-hidden="true">›</span></button>)}</nav>
      <div className="drawer-appearance"><span>Appearance</span><ThemeToggle /></div>
      <div className="drawer-profile"><span className="profile-initials">{profile.name[0]}</span><div><strong>{profile.name}</strong><small>{profile.email}</small><span>Automatically signed in · Demo profile</span></div></div>
    </dialog>}
  </>;
}
