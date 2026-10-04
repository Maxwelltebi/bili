import { z } from 'zod';
import { turnSchema, type Answer } from './consultationApi';
import { financialSchema, estimateSchema, calculateEstimate } from './financeApi';

export const profileSchema = z.object({ id: z.uuid(), name: z.string().min(1).max(80), email: z.email().max(180), phone: z.string().max(40), company: z.string().max(100), createdAt: z.string() });
export type Profile = z.infer<typeof profileSchema>;
const historySchema = z.object({ turn: turnSchema, answer: z.object({ id: z.string(), prompt: z.string(), choice: z.string(), text: z.string() }), financialState: financialSchema.nullable(), financialDraft: financialSchema.nullable() });
export const snapshotSchema = z.object({ version: z.literal(1), goal: z.string(), explanation: z.string(), answers: z.array(historySchema.shape.answer), turn: turnSchema.nullable(), history: z.array(historySchema), financialState: financialSchema.nullable(), financialDraft: financialSchema.nullable(), documentNames: z.array(z.string()), financialResult: estimateSchema.nullable().optional(), updatedAt: z.string().optional() });
export type Snapshot = z.infer<typeof snapshotSchema>;
export type StoredAnswer = Answer;
export const accountSchema = z.object({ profile: profileSchema, snapshot: snapshotSchema.nullable(), firstVisit: z.boolean(), storage: z.enum(['supabase', 'device']) });
export type Account = z.infer<typeof accountSchema>;
const CACHE_KEY = 'planpilot.demo-account.v1';
const deviceSchema = accountSchema.extend({ visited: z.literal(true) });

async function api<T>(path: string, schema: z.ZodType<T>, method = 'GET', body?: unknown): Promise<T> {
  let response;
  try { response = await fetch(path, { method, credentials: 'same-origin', ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) }); }
  catch { throw new Error('Your account could not connect. Please retry.'); }
  let value;
  try { value = await response.json(); } catch { throw new Error('Your saved data could not be read. Please retry.'); }
  if (!response.ok) throw new Error(z.object({ message: z.string() }).safeParse(value).success ? value.message : 'Your saved data could not connect. Please retry.');
  const result = schema.safeParse(value);
  if (!result.success) throw new Error('Your saved data could not be read. Please retry.');
  return result.data;
}
function readDevice() { try { const parsed = deviceSchema.safeParse(JSON.parse(localStorage.getItem(CACHE_KEY) || 'null')); return parsed.success ? parsed.data : null; } catch { return null; } }
export function cacheAccount(account: Account) {
  try {
    // Cloud records live in Supabase; retain browser storage only for the provisional device demo.
    if (account.storage === 'supabase') localStorage.removeItem(CACHE_KEY);
    else localStorage.setItem(CACHE_KEY, JSON.stringify({ ...account, visited: true }));
  } catch { if (account.storage === 'device') throw new Error('This browser could not save your progress. Allow site storage or connect cloud storage, then retry.'); }
}
function snapshotBody(snapshot: Snapshot) {
  const { financialResult: _result, updatedAt: _date, ...body } = snapshot;
  const cleanTurn = (turn: NonNullable<Snapshot['turn']>) => { const { financialResult: _calculation, ...rest } = turn; return rest; };
  return { ...body, turn: body.turn ? cleanTurn(body.turn) : null, history: body.history.map(entry => ({ ...entry, turn: cleanTurn(entry.turn) })) };
}

export async function loadAccount(): Promise<Account> {
  let account = await api('/api/account', accountSchema);
  const cached = readDevice();
  if (account.storage === 'device') {
    if (cached?.profile.id === account.profile.id) account = { ...account, profile: cached.profile, snapshot: cached.snapshot, firstVisit: false };
    if (account.snapshot?.financialState) account.snapshot.financialResult = await calculateEstimate(account.snapshot.financialState);
  } else if (account.firstVisit && cached?.storage === 'device') {
    // Carry this browser's provisional demo progress into its newly connected account.
    account.profile = await saveProfile(cached.profile, 'supabase');
    if (cached.snapshot) account.snapshot = await saveSnapshot(cached.snapshot, 'supabase');
    account.firstVisit = false;
  }
  cacheAccount(account);
  return account;
}
export async function saveProfile(profile: Profile, storage: Account['storage']): Promise<Profile> {
  const { id: _id, createdAt: _created, ...body } = profile;
  return storage === 'device' ? profileSchema.parse(profile) : api('/api/profile', profileSchema, 'PUT', body);
}
export async function saveSnapshot(snapshot: Snapshot, storage: Account['storage']): Promise<Snapshot> {
  return storage === 'device' ? { ...snapshotSchema.parse(snapshot), updatedAt: new Date().toISOString() } : api('/api/snapshot', snapshotSchema, 'PUT', snapshotBody(snapshot));
}
