import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { AppError, answerSchema, turnSchema } from './consultation.mjs';
import { financialSchema, financialDraftSchema, estimate } from './finance.mjs';
import { benefitsSchema } from './benefits.mjs';

export const profileInputSchema = z.object({ name: z.string().trim().min(1).max(80), email: z.email().max(180), phone: z.string().trim().max(40), company: z.string().trim().max(100) }).strict();
const savedTurn = turnSchema.extend({ id: z.string().min(1).max(100) });
const historyEntry = z.object({ turn: savedTurn, answer: answerSchema, financialState: financialSchema.nullable(), financialDraft: financialDraftSchema.nullable() }).strict();
export const snapshotSchema = z.object({ version: z.literal(1), goal: z.string().max(100), explanation: z.string().max(1000), answers: z.array(answerSchema).max(200), turn: savedTurn.nullable(), history: z.array(historyEntry).max(200), financialState: financialSchema.nullable(), financialDraft: financialDraftSchema.nullable(), documentNames: z.array(z.string().max(180)).max(5), benefits: benefitsSchema.optional() }).strict();
const defaultProfile = id => ({ id, name: 'Alex Morgan', email: 'alex.morgan@example.com', phone: '', company: 'Example Company', createdAt: new Date().toISOString() });
const profileFromRow = row => ({ id: row.id, name: row.display_name, email: row.email, phone: row.phone || '', company: row.company || '', createdAt: row.created_at });

export function createAccountStore({ url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL, secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY, fetchImpl = fetch } = {}) {
  const configured = !!(url && secret);
  const partial = !!(url || secret) && !configured;
  async function request(table, { query = '', method = 'GET', body, preference } = {}) {
    if (partial) throw new AppError(503, 'storage_config', 'Add both SUPABASE_URL and SUPABASE_SECRET_KEY to the server configuration.');
    let endpoint;
    try { endpoint = new URL(`${url.replace(/\/$/, '')}/rest/v1/${table}${query}`); if (endpoint.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(endpoint.hostname)) throw new Error(); }
    catch { throw new AppError(503, 'storage_config', 'Check SUPABASE_URL in the server configuration.'); }
    let response;
    try { response = await fetchImpl(endpoint, { method, headers: { apikey: secret, ...(secret.startsWith('eyJ') ? { Authorization: `Bearer ${secret}` } : {}), 'Content-Type': 'application/json', ...(preference ? { Prefer: preference } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000) }); }
    catch { throw new AppError(503, 'storage_unavailable', 'Your saved data could not connect. Please retry; your current answers are still here.'); }
    if (!response.ok) throw new AppError(503, 'storage_unavailable', response.status === 404 ? 'The Supabase tables are not ready. Apply the migration in supabase/migrations and retry.' : 'Your saved data could not be read or saved. Check the Supabase connection and retry.');
    if (response.status === 204) return null;
    try { return await response.json(); } catch { throw new AppError(503, 'storage_response', 'Saved data could not be read. Please retry.'); }
  }
  return {
    configured,
    async bootstrap(id) {
      if (!configured && !partial) return { profile: defaultProfile(id), snapshot: null, firstVisit: true, storage: 'device' };
      let [row] = await request('planpilot_profiles', { query: `?id=eq.${id}&select=*` });
      const firstVisit = !row;
      if (!row) {
        const profile = defaultProfile(id);
        const rows = await request('planpilot_profiles', { method: 'POST', query: '?on_conflict=id', preference: 'resolution=ignore-duplicates,return=representation', body: { id, display_name: profile.name, email: profile.email, phone: profile.phone, company: profile.company } });
        [row] = rows.length ? rows : await request('planpilot_profiles', { query: `?id=eq.${id}&select=*` });
      }
      const [saved] = await request('planpilot_consultations', { query: `?user_id=eq.${id}&select=snapshot,updated_at` });
      const snapshot = saved ? snapshotSchema.parse(saved.snapshot) : null;
      return { profile: profileFromRow(row), snapshot: snapshot ? { ...snapshot, updatedAt: saved.updated_at, financialResult: snapshot.financialState ? estimate({ state: snapshot.financialState }) : null } : null, firstVisit, storage: 'supabase' };
    },
    async saveProfile(id, raw) {
      const profile = profileInputSchema.parse(raw);
      const [row] = await request('planpilot_profiles', { method: 'PATCH', query: `?id=eq.${id}`, preference: 'return=representation', body: { display_name: profile.name, email: profile.email, phone: profile.phone, company: profile.company } });
      if (!row) throw new AppError(401, 'session_expired', 'Reload the app to restore your demo account.');
      return profileFromRow(row);
    },
    async saveSnapshot(id, raw) {
      const snapshot = snapshotSchema.parse(raw);
      const updatedAt = new Date().toISOString();
      await request('planpilot_consultations', { method: 'POST', query: '?on_conflict=user_id', preference: 'resolution=merge-duplicates,return=minimal', body: { user_id: id, snapshot, status: snapshot.turn?.kind === 'ready' ? 'ready' : 'in_progress', updated_at: updatedAt } });
      return { ...snapshot, updatedAt, financialResult: snapshot.financialState ? estimate({ state: snapshot.financialState }) : null };
    },
  };
}

export function createDemoSessions({ secret = process.env.SESSION_SECRET || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || 'planpilot-local-demo-no-cloud-storage', secure = process.env.NODE_ENV === 'production' } = {}) {
  const sign = id => createHmac('sha256', secret).update(`planpilot-demo:${id}`).digest('hex');
  function read(req) {
    const value = req.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith('planpilot_demo='))?.slice('planpilot_demo='.length);
    if (!value) return null;
    const [id, signature] = value.split('.');
    if (!z.uuid().safeParse(id).success || !/^[a-f0-9]{64}$/.test(signature || '')) return null;
    return timingSafeEqual(Buffer.from(signature), Buffer.from(sign(id))) ? id : null;
  }
  return { read, start(req, res) { const existing = read(req); if (existing) return existing; const id = randomUUID(); res.setHeader('Set-Cookie', `planpilot_demo=${id}.${sign(id)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000${secure ? '; Secure' : ''}`); return id; } };
}
