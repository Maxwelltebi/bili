import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

type Theme = 'dark' | 'light';
const STORAGE_KEY = 'planpilot.theme';
const ThemeContext = createContext<{ theme: Theme; toggle: () => void } | null>(null);

function savedTheme(): Theme {
  try { return localStorage.getItem(STORAGE_KEY) === 'light' ? 'light' : 'dark'; }
  catch { return 'dark'; }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(savedTheme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#faf5ee' : '#1b0c08');
    try { localStorage.setItem(STORAGE_KEY, theme); } catch { /* The preference still works for this visit when site storage is blocked. */ }
  }, [theme]);
  return <ThemeContext value={{ theme, toggle: () => setTheme(previous => previous === 'dark' ? 'light' : 'dark') }}>{children}</ThemeContext>;
}

export function ThemeToggle() {
  const context = useContext(ThemeContext);
  if (!context) return null;
  const nextTheme = context.theme === 'dark' ? 'light' : 'dark';
  const label = `Switch to ${nextTheme} mode`;
  return <button type="button" className="theme-toggle" onClick={context.toggle} aria-label={label} title={label}>
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">{nextTheme === 'light' ? <><circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.5" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></> : <path d="M20.5 13a8.5 8.5 0 0 1-9.5-9.5A8.5 8.5 0 1 0 20.5 13Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />}</svg>
    <span>{nextTheme === 'light' ? 'Light mode' : 'Dark mode'}</span>
  </button>;
}
