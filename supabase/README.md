# PlanPilot storage setup

1. Open the project's Supabase **SQL Editor** and run the contents of `migrations/202610040001_planpilot_accounts.sql`. It creates `planpilot_profiles` and `planpilot_consultations`, enables row-level security, and restricts table access to the backend service role. It does not remove existing tables or records.
2. In **Project Settings → API Keys**, copy the server secret key into the local `.env` as `SUPABASE_SECRET_KEY`. Legacy `SUPABASE_SERVICE_ROLE_KEY` is also supported. Do not use a publishable key as the server secret. Keep secrets out of chat, browser-prefixed variables, and source control.
3. Set `SUPABASE_URL` to the project URL. Existing `NEXT_PUBLIC_SUPABASE_URL` is accepted as a fallback; this project uses Vite, not Next.js. The publishable key is not needed for this server-based demo.
4. Optionally set a stable random `SESSION_SECRET` to keep demo sessions valid when the Supabase key rotates. Without it, the server secret signs the demo cookie.
5. Run `npm run db:check`, then restart `npm run dev` to load saved environment changes. The check queries no user records and prints no credentials.

Supabase [secret keys are server-only](https://supabase.com/docs/guides/api/api-keys). The backend uses the [Supabase Data API](https://supabase.com/docs/guides/api), so no new SDK is required. Public keys cannot write these tables. The Data API cannot execute this SQL migration; applying it requires the SQL Editor or an authenticated database migration tool.

The demo automatically loads Alex Morgan with an HttpOnly, signed browser cookie. Each browser receives its own random account ID; request bodies cannot choose whose data to access. First visits open My Plan. Returning visits open Overview, including when a user has not completed the journey. This is a browser-specific demo session, not production authentication or cross-device sign-in.

Profile name, email, phone and company are editable. Consultations save answers, the current question, review history, extracted source-labeled facts, reviewed financial inputs, drafts, and document names. Original document bytes and audio are never saved to Supabase. Restored estimates are calculated afresh from reviewed inputs. Original files may need to be uploaded again if their contents are needed beyond previously extracted details.

If no Supabase URL or key is configured, a provisional demo uses device storage and clearly labels that location. On connection, that browser's device progress transfers to its new Supabase account. Configured cloud failures show a retry state and do not silently claim a successful save. Cloud consultation records are not duplicated in localStorage. Clearing cookies creates a new demo account; keep the signing secret stable for development continuity.
