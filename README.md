# PlanPilot

Adaptive dental benefits consultation, built with React, TypeScript, Vite, Node.js, and Gemini.

## Run locally

```sh
npm install
npm run dev
```

Add `GEMINI_API_KEY` to `.env` using `.env.example` as a guide. Node.js 22+ is required. `npm run dev` starts the frontend and API together, preferring ports 5173 and 3001. If either is occupied, it chooses an available port and connects the frontend to that API automatically. Always open the **Local** app URL printed by that invocation. Ctrl+C stops both servers. Frontend edits update through Vite; restart the command after changing server code or `.env`. `npm run build` checks TypeScript and builds `dist`. `npm start` serves the built app and API together at `http://127.0.0.1:3001`. `npm test` runs automated checks. `npm run preview` previews static assets only; use `npm start` to test AI in a production build.

First-time demo visitors open My Plan; returning visitors open Overview. The top-left menu opens Overview, My Plan, Benefits, or Settings. Begin opens the full-page intent screen. Continue opens a horizontal popup where Gemini chooses one relevant question at a time, requests a document when useful, or prepares a plan. Every question includes selectable choices, free text, and browser speech-to-text. Users can skip questions, go Back, request a summary early, edit their answers in the review, and download a text plan.

Profiles and consultation progress are saved to Supabase through the app server. Settings edits the auto-loaded demo profile. Overview shows the latest source-labeled coverage facts and deterministic cost results. My Plan resumes the current question or summary without repeating the initial AI request. Answers, review history, extracted facts, reviewed financial inputs and drafts are persisted; original uploaded files stay in memory for the current visit and are not stored. Confirmed estimates are recalculated when loaded. If no Supabase settings exist, a clearly labeled device-only demo is available, with progress transferred on connection. Configured database errors remain visible and can be retried.

Apply `supabase/migrations/202610040001_planpilot_accounts.sql` in the Supabase SQL Editor, set the server-only `SUPABASE_SECRET_KEY` and `SUPABASE_URL` (or existing `NEXT_PUBLIC_SUPABASE_URL`) in `.env`, then restart the server. Run `npm run db:check` to verify connectivity and table availability. See [storage setup](supabase/README.md) for the complete instructions. The supplied publishable key cannot write these private tables; a server secret or legacy service-role key is required. The demo cookie is signed, HttpOnly, and unique to each browser; it is not production authentication or cross-device sign-in.

Answers and optional documents are sent through the server to Gemini on Continue. Up to five PDF/JPG/PNG documents, 10 MB combined, are validated by MIME type and signature and sent inline for native document understanding. A benefits policy and clinic bill can be retained together during the visit. Resume requests include extracted facts with their original source status rather than claiming absent files have been read again. Google handles provider processing according to your account's terms; no promise of zero provider retention is made.

Every input step must include free text and speech-to-text alongside preset choices. The reusable `FreeResponse` component supports browser speech recognition (including the prefixed API), explicit microphone start/stop, editable final transcripts, interim feedback, and permission/network errors. Unsupported browsers retain the text field. Audio may be processed online by the browser's speech provider; the interface discloses this before activation. Dictation appends to existing text, stops on navigation, and pauses Continue until transcription ends. Real microphone behavior still requires manual testing in a supported browser.

## Year-round benefits tools

Open **Benefits** in the navigation menu or from Overview. The four tabs cover Feature 3 and all three bonus features:

- **Annual usage:** record, edit and remove paid claims; see used and remaining annual benefits and projected usage separately. Enter the annual maximum, actual plan-year dates and benefits used before tracking (excluding logged claims). Claim payments also reduce the remaining deductible. Older claims remain in history when starting a confirmed next plan year.
- **Care sequence:** reuse consultation details or enter treatments, quotes, approved windows and dependencies. Compare treatment schedules across the current and next benefit years, see the potential difference, and apply the approved dates. Remove completed treatments from planned care so they are not projected again.
- **Network costs:** compare separate in-network and out-of-network quotes, contracted/allowed fees, procedure coverage, payment percentages, deductibles and remaining benefits. Both scenarios use the backend calculator; unknowns stay visible and savings are shown only for complete estimates.
- **Reminders:** save a 14-, 30-, 60- or 90-day reminder window. Unused-benefit notices appear inside the app when due, with per-year dismissal. Calendar export includes a general reminder and display alarm without treatment details. Import it into a calendar to receive calendar notifications; PlanPilot does not send email or background notifications.

These tools persist in the existing private consultation snapshot in Supabase (or the device-only fallback). No additional SQL migration is needed. Consultation updates preserve the independent tracker. `POST /api/network-estimate` validates `{ state, network }` and calculates both scenarios without a provider call.

## Journey presentation

Welcome and the initial intent question are full-page screens. Continue opens subsequent consultation content in a horizontal, viewport-wide native dialog over the intent screen. Its height fits the content; mobile stacks the columns. Copy is kept short, with scrolling available only if the content cannot fit. Opening, closing, and question changes use fade and slide effects with reduced-motion support. Native dialog focus containment, Escape/Close, and background scroll locking are preserved. Future questions should reuse `JourneyModal` and `JourneyTransition`.

There is no fixed questionnaire length or numbered progress. Gemini selects the next question or when to produce a summary. The server uses structured JSON output and validates it with Zod. Unsubstantiated user facts and document claims made without a document are converted to unknowns. Document excerpts are model extracted; users should check the displayed sources and confirm coverage with their insurer. The app provides benefits guidance, not clinical treatment decisions.

## Gemini configuration

### Consultation procedure

The cleaned Bili master system prompt lives in `server/prompts/consultation.md`. It is loaded server-side and supplied as Gemini's system instruction on every request. Saved prompt edits apply to the next answer without restarting the server. `plan.md` links to this canonical file; build notes and integration examples are not sent as consultation instructions. No prompt database is configured.

The prompt defines flexible consultation decisions and plain-language explanations, one-question decision-driven questioning, source attribution, professional boundaries, and the actual Zod response contract. Every request also includes the full answer history, latest interaction, unknown or declined answers, and supported interface/tool capabilities. Questions are not a fixed sequence. Missing, empty, or oversized prompts produce a configuration error rather than silently reverting to generic instructions. The prompt limit is 48,000 characters.

The app supports adaptive choices, typed/browser-transcribed input, native document understanding, editable quote confirmation, deterministic cost calculations, two-benefit-year scheduling, projected benefit usage, text-plan downloads, and calendar-file reminder exports. It has no insurer verification or automated reminder delivery. Supabase stores profiles and consultation progress; runtime context includes previously captured facts on resume. Runtime flags distinguish implemented tools from unavailable operations.

## Quote-based estimates and optimization

For a treatment-cost goal, Bili must collect the dentist's actual quote for each procedure through upload, typed input, or an editable voice transcript. Gemini proposes structured facts; patients confirm or correct them before the backend calculates. The draft preserves unknowns and distinguishes full fees from clinic-provided after-insurance patient estimates. Net patient estimates are displayed as supplied, never discounted a second time. Procedure-specific eligibility and insurer payment percentages are required; generic major/basic percentages are not automatically mapped to a crown or filling.

`server/finance.mjs` validates inputs with Zod and calculates in integer cents. For an eligible full-fee quote, the engine applies the remaining deductible to the insurer-recognized fee, multiplies the remaining eligible amount by the insurer's payment percentage, then limits that payment by remaining annual benefits. Personal cost is the payable fee minus that calculated contribution. Supplied in-network negotiated fees replace billed fees; out-of-network comparisons retain any amount above the allowable fee. Deductibles and benefits are consumed in treatment order within each benefit year. This implements the [deductible, coinsurance and allowable-fee relationship described by CMS](https://www.cms.gov/initiatives/your-patient-rights/medical-bill-rights/get-help/medical-bill-guides-resources/health-insurance-terms-you-should-know), together with the user's dental annual-benefit cap. It supports these modeled rules, not every possible policy restriction, copay, lifetime maximum or coordination-of-benefits rule. Confirm procedure eligibility and restrictions with the applicable insurer.

Missing required figures produce incomplete rows. Unknown annual balances or allowable fees can produce explicitly conditional results; they are never silently treated as zero or verified unlimited benefits. Quoted fee, eligible fee, deductible, insurer contribution, personal cost, cap effects, and assumptions are available in the breakdown. Editing an amount invalidates stale results. Bili receives backend-recalculated results on subsequent requests and explains those actual figures. The financial draft is unconfirmed user/document information; schema validation and patient confirmation do not establish insurer verification.

The date view uses actual benefit-year dates, including non-January resets. The optimizer evaluates original and earliest feasible dates in the current and next benefit years, respects supplied dependencies and dentist-approved windows, and compares complete estimates using confirmed renewal inputs. It reports the lowest cost among evaluated schedules, not a global clinical optimum. Missing approval or unresolved financial assumptions block a schedule recommendation. Editing a planned date after confirmation recalculates immediately; applying a compared schedule also recalculates. Projected benefit usage is separate from paid claims. The optional `.ics` export creates a generic calendar reminder two weeks before the supplied benefit-year end; the user imports it into their calendar. No reminder service or claims synchronization is implied.

The two planning tabs reuse the wide responsive dialog with Geist Sans and reduced-motion support. The consultant uses short conversational cards, insurance/bill uploads, and intermittent editable checkpoints showing captured details and what remains needed. Every question retains Bili's actual choices, typed input, voice input, and an upload alternative. After ?No? to knowing coverage, the backend offers insurance-card/file intake even if the model proposes another coverage question. ?No? to having insurance is distinct. Declining uploads or preferring simple guidance prevents repeated upload offers. This supports the consultant without imposing a fixed question sequence.

Insurance cards are accepted, but only details actually present can be extracted; a plan booklet may be needed for coverage rules. Bili asks about a dentist's bill or estimate when useful and respects insurance-only goals. Insurance-only results display coverage and next actions, without an empty calculator. Cost results explain the dentist's price, what the user pays first, the plan's contribution, and the user's estimated share. Unknown values remain unknown.

Nearby-clinic discovery and city-price optimization have been removed. The core optimizer compares dentist-approved treatment dates across plan years only.

`POST /api/estimate` accepts `{ state, budget? }` and returns validated calculation/schedule results. `POST /api/consult` accepts full answer history, documents, previously captured source-labeled facts, an optional unconfirmed draft, and optional patient-confirmed financial state. Its validated output uses question, document, review, or ready; documentPurpose distinguishes insurance and bill intake. The provider schema projects the financial object's shape to fit Gemini's schema-complexity limits; full Zod validation still enforces monetary ranges, precision, dates, sizes and cross-field rules after generation.

Keep `GEMINI_API_KEY` server-side; never use a `VITE_` prefix. `GEMINI_MODEL` defaults to the live-tested `gemini-3.5-flash-lite`. Configure another model if your account supports it. Quota, authentication, malformed responses, and temporary provider failures show retry messages without deleting answers. The local server has same-origin checks, payload limits and per-IP rate limiting. It binds to localhost; add deployment authentication and suitable limits before exposing this development app publicly.

API behavior follows [Google's structured output documentation](https://ai.google.dev/gemini-api/docs/generate-content/structured-output) and [native document input documentation](https://ai.google.dev/gemini-api/docs/generate-content/file-input-methods).

`npm run test:live` explicitly sends a synthetic goal, benefits PDF and complete dentist quote to Gemini, checks extraction, and verifies the deterministic result. It uses your account quota. `npm test` makes no provider calls and exercises financial math, scheduling, source validation, API boundaries and user interactions. `npm run test:visual` uses isolated headless Chrome/Edge with synthetic consultation responses and the running app's real calculator, checks desktop/mobile horizontal overflow and browser exceptions, and saves screenshots under ignored `tests/artifacts/`. Set `PLANPILOT_TEST_URL` to your running app URL and `CHROME_PATH` if Chromium is elsewhere. Real microphone permission/audio behavior still needs manual testing.

## Hero asset

`public/images/sunset-hero.png` is an original image generated with the built-in imagegen tool. Prompt: cinematic warm sunset over layered mountain ridges; a woman with long dark brown hair in a cream linen blouse viewed from behind in the lower right; portrait composition, amber sky, burnt orange and deep chocolate palette, atmospheric film grain; no text, logos, UI, or icons.


## Appearance

Use the sun/moon button in the top bar, navigation menu, or consultation popup to switch between dark and light mode. Dark mode preserves the original warm design; light mode uses cream surfaces, dark text and orange accents across every page and input. The choice is stored on the device and applied before the initial paint, including while an account is loading or cannot connect. Theme changes do not restart the consultation.
