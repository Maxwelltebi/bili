import { useState, type FormEvent } from 'react';
import type { Account, Profile } from './accountApi';

export function SettingsPage({ profile, storage, onSave }: { profile: Profile; storage: Account['storage']; onSave: (profile: Profile) => Promise<void> }) {
  const [draft, setDraft] = useState(profile);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  function change(field: 'name' | 'email' | 'phone' | 'company', value: string) { setDraft(previous => ({ ...previous, [field]: value })); setMessage(''); setError(''); }
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    try { await onSave({ ...draft, name: draft.name.trim(), email: draft.email.trim(), phone: draft.phone.trim(), company: draft.company.trim() }); setMessage('Your profile is saved.'); }
    catch (err) { setError(err instanceof Error ? err.message : 'Your profile could not be saved. Please retry.'); }
    finally { setBusy(false); }
  }
  return <main className="account-page settings-page"><div className="page-heading"><div><p className="eyebrow"><span /> A LITTLE ABOUT YOU</p><h1>Your profile.</h1><p>The basics, all in one place.</p></div></div><div className="settings-layout"><aside className="profile-card"><span className="profile-initials large">{profile.name.split(/\s+/).map(s => s[0]).slice(0, 2).join('')}</span><h2>{profile.name}</h2><p>{profile.email}</p><span className="status-pill">Demo account</span><p className="finance-note">You’re automatically signed in to this browser’s demo profile.</p><dl><dt>Member since</dt><dd>{new Date(profile.createdAt).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</dd><dt>Plan progress</dt><dd>{storage === 'supabase' ? 'Saved to your account' : 'Saved on this device'}</dd></dl></aside><form className="profile-form" onSubmit={submit}><h2>Basic information</h2><p>Keep your name and contact details up to date.</p><div className="profile-fields"><label>Full name<input autoComplete="name" value={draft.name} onChange={event => change('name', event.target.value)} maxLength={80} required /></label><label>Email address<input type="email" autoComplete="email" value={draft.email} onChange={event => change('email', event.target.value)} maxLength={180} required /></label><label>Phone number <span>Optional</span><input type="tel" autoComplete="tel" value={draft.phone} onChange={event => change('phone', event.target.value)} maxLength={40} /></label><label>Company <span>Optional</span><input autoComplete="organization" value={draft.company} onChange={event => change('company', event.target.value)} maxLength={100} /></label></div><div className="profile-save"><button className="primary" disabled={busy} type="submit">{busy ? 'Saving…' : 'Save changes'}<span aria-hidden="true">→</span></button>{message && <p role="status">{message}</p>}</div>{error && <p className="form-error" role="alert">{error}</p>}</form></div></main>;
}
