// Read-only configuration check. Never print keys, response bodies or user records.
const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !secret) {
  console.error('Add SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and a server-only SUPABASE_SECRET_KEY to .env. A publishable key cannot access the private PlanPilot tables.');
  process.exitCode = 1;
} else {
  try {
    const base = new URL(url);
    if (base.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(base.hostname)) throw new Error();
    for (const table of ['planpilot_profiles', 'planpilot_consultations']) {
      const response = await fetch(`${url.replace(/\/$/, '')}/rest/v1/${table}?select=*&limit=0`, { headers: { apikey: secret, ...(secret.startsWith('eyJ') ? { Authorization: `Bearer ${secret}` } : {}) }, signal: AbortSignal.timeout(15000) });
      if (!response.ok) { console.error(response.status === 404 ? `Missing ${table}. Run supabase/migrations/202610040001_planpilot_accounts.sql in the Supabase SQL Editor.` : 'Supabase access failed. Check the server secret key and table permissions.'); process.exitCode = 1; break; }
    }
    if (!process.exitCode) console.log('Supabase connected. Both PlanPilot tables are ready.');
  } catch { console.error('Supabase could not connect. Check the project URL and retry.'); process.exitCode = 1; }
}
