# PlanPilot

## AI consultation context

The adapted Bili master prompt is stored in `server/prompts/consultation.md` and sent as Gemini's system instruction. It is loaded server-side on every consultation request. Edit that file to change the live consultation procedure. The seven stages are flexible topics, not a fixed number of questions or screens. Runtime capabilities are supplied separately so Bili cannot assume unimplemented tools exist.

## Goal

Build a dental benefits app with equally considered desktop and mobile experiences that helps people understand their coverage, explore treatment options, and plan their next step with confidence.

Gemini is the API provider for guided assistance. Keep its API key server-side as `GEMINI_API_KEY`; optionally set `GEMINI_MODEL` to choose another supported model. The tested default is `gemini-3.5-flash-lite`. Screen one does not require API access. Account-specific quotas and API availability apply.

Use the supplied three-screen design image as the visual reference. The first implementation should closely reproduce the first welcome screen, using PlanPilot as the brand.

## Design requirements

- Keep the welcome and initial **What brings you here?** question as full-page screens. Only the subsequent consultation opens in a shared large modal over the intent screen. Make desktop popups horizontal and extend across the viewport; fit height to content. Use responsive mobile layouts, keyboard focus containment, Escape/Close controls, background scroll locking, and smooth fade/slide transitions. Respect reduced-motion preferences.
- The AI consultant decides whether another question is needed and what to ask from the user's answers. Never show a fixed number of steps, numbered progress fractions, or a percentage based on an assumed total. Use the current topic and contextual feedback to orient users.
- Present one focused question at a time with short conversational copy, selectable cards, text, and voice. Reveal extra explanation on demand. Aim to keep the prompt, choices, answer field, and primary action visible without scrolling; allow scrolling when viewport size, zoom, keyboard, or content length makes it necessary.

- Every question must offer preset choices where relevant, an editable free-text answer, and speech-to-text input. Users may add their own explanation even after selecting a preset. Voice transcripts must be editable and never automatically submitted. Include microphone permission feedback, stop controls, and a typed fallback for unsupported browsers. Reuse the shared FreeResponse component for future input steps.

- Match the reference's warm, calm visual style: near-black brown backgrounds, cream text, burnt orange accents, and sunset imagery.
- Use Geist Sans throughout, including the brand, headings, supporting text, and controls.
- Preserve the first screen's hierarchy, spacing, rounded corners, image placement, progress indicator, and prominent bottom button.
- Use the exact brand name **PlanPilot** throughout the interface, metadata, and accessibility labels.
- Do not use emojis, generic AI icons, sparkle symbols, or robot imagery.
- Use simple, consistent functional icons only where needed, such as a forward arrow, document, microphone, or lock.
- Keep text readable over the image with a dark gradient overlay.
- Make the layout responsive; follow the reference's stacked composition on mobile and create a full-width, two-column desktop experience with large typography and sunset imagery. Give both layouts equal priority.
- Keep device status bars and the reference's outer orange presentation backdrop out of the actual app interface.

## Phase 1: Recreate the welcome screen

### Content and layout

1. Place the PlanPilot wordmark at the top left and a small **Skip** action at the top right.
2. Display the headline with line breaks matching the reference:

   > Your
   > dental benefits,
   > one clear
   > step at a time.

3. Add the supporting copy: **Understand. Explore. Plan with confidence.**
4. Place a warm sunset landscape with a person viewed from behind in the lower portion of the screen. Use an appropriately licensed image or create an original asset inspired by the reference.
5. Layer translucent orange landscape curves over the image to recreate its visual depth without obscuring the headline or button.
6. Add three short progress marks above the button, with the first highlighted in orange. This phase contains one welcome panel; the marks reproduce the supplied design and do not imply additional implemented slides.
7. Add a wide, rounded orange button labeled **Begin my journey**, with a simple forward arrow.

### Behavior

- Both **Begin my journey** and **Skip** open the first onboarding step once Phase 2 is implemented.
- Support keyboard navigation, visible focus states, and accessible button labels.
- Respect mobile safe areas and keep the primary button reachable on short screens.
- If the first screen is reviewed before onboarding exists, explicitly identify its navigation as pending rather than presenting a nonfunctional button as complete.

### Acceptance criteria

- The welcome screen closely follows the first reference panel at a comparable mobile viewport size.
- PlanPilot replaces every occurrence of the previous brand.
- The image, overlays, headline, and button remain readable without overlap or horizontal scrolling.
- No emojis or generic AI imagery appear.

## Phase 2: Build the intent selection screen

Implemented: a full-page intent screen with desktop and mobile layouts, five selectable goals, custom text/voice input, validation, and welcome/Exit navigation. Continue opens a wide popup connected to the server-side Gemini consultant. Questions, documents, review, and summary reuse this popup. Answers remain in memory during the visit; reloading clears them.

- Follow the second reference panel's brand header, Exit action, conversational question, and selectable cards. Replace numbered progress with an unnumbered topic label. Keep this screen outside the popup.
- Offer these choices:
  - I have upcoming dental treatment.
  - I want to understand my insurance.
  - I want to reduce my dental expenses.
  - I'm comparing treatment options.
  - I'm not really sure yet.
- Include an alternative text field for the user's own explanation.
- Store the selected intent and custom answer, then open the consultant's next question in the shared popup. The consultant determines whether insurance intake is relevant rather than forcing every user down the same path.
- Provide speech-to-text through the browser speech recognition service, with editable transcripts, explicit start/stop controls, and permission/error feedback. Keep text input available when speech recognition is unsupported.
- Use an original or licensed portrait if retaining the reference's human guide. Do not substitute a generic AI avatar.

## Phase 3: Build the insurance intake screen

Implemented as an optional AI-requested document question: PDF/JPG/PNG selection, drag and drop, 10 MB validation, remove/retry behavior, examples, and typed/spoken alternatives. Files are sent inline to Gemini only on Continue and are not saved by PlanPilot. No separate provider Files API upload is used. Gemini's own data handling applies; avoid promising that provider processing leaves no data.

- Follow the third reference panel with **Upload my plan** and **I'll explain it** choices.
- Let users select a PDF, JPG, or PNG, with a maximum size of 10 MB per file.
- Support drag and drop on desktop and a file picker on mobile.
- Show selected file details, validation errors, file preparation and AI processing status, and a remove or retry action. Use indeterminate feedback rather than a fabricated progress percentage.
- Provide text and speech-to-text alternatives for users who do not have a document available, and allow additional typed or spoken context alongside an uploaded document.
- Add a working **View examples** control that explains which insurance documents are useful.
- Write privacy copy that accurately reflects the implemented storage and retention behavior. Do not copy security promises from the reference before they are verified.

## Phase 4: Define and implement the remaining journey

The reference is visual inspiration, not a fixed questionnaire. Gemini decides which information is missing and whether to ask a question or offer a review/summary. Implemented: dynamic questions, answer history, Back/edit controls, early summary, an answer review, a grounded plan with source excerpts and unknowns, and a downloadable text plan.

- Use the server-side Gemini consultation endpoint `/api/consult`; keys are never sent to the browser. Validate request data and structured responses, handle provider errors without exposing raw details, and retain answers for retry.
- Use structured responses with a question ID, short prompt, relevant selectable choices, optional context, and an action indicating another question or a summary. Render them in the shared modal; do not hardcode a total or fixed order.
- Keep answer history so users can revise earlier responses and the consultant can adapt subsequent questions.
- Avoid repeated questions, long explanations, and asking for information the user already supplied. Let users express uncertainty and correct misunderstandings.

- Establish the minimum information needed to produce a useful dental benefits summary.
- Define a review step so users can correct their information.
- Specify the final output, including coverage details, uncertainties, and next actions.
- Ground any coverage interpretation in supplied plan documents and clearly distinguish missing information from confirmed benefits.

## Implementation sequence

1. Initialize the app. Use React, TypeScript, and Vite as the default stack if no existing application or stack requirements are supplied.
2. Establish shared colors, typography, spacing, corner radii, and button styles.
3. Build and visually review the welcome screen before extending the flow.
4. Add onboarding navigation and shared state for intent and insurance input.
5. Build the intent and insurance screens with working validation and navigation.
6. Define the remaining journey and backend requirements before adding document processing or personalized summaries.
7. Implement document handling only after storage, retention, and processing behavior are defined.
8. Verify the complete implemented flow and document any remaining functionality.

## Verification

- Run `npm test` for provider validation, grounding, file checks, HTTP boundary checks, and consultation interaction tests. Live checks use synthetic examples only.

- Compare a mobile screenshot of the welcome screen against the supplied first panel.
- Check narrow mobile, typical mobile, and desktop layouts, including short viewport heights.
- Verify keyboard access, focus visibility, text contrast, and reduced-motion behavior if animation is added.
- Test primary navigation, intent selection, text entry, and file validation as each feature is implemented.
- Search app source and metadata for the old brand name before release.
- Run the production build and appropriate checks for the implemented functionality.

## Phase 5: Plain-language consultation, bills and core planning

Focus on Lincoln Financial's core challenge: collect planned care and plan details, explain what the plan pays and what the employee may owe, and compare dentist-approved timing across the plan year. Nearby-city clinic search and price optimization are removed.

- Bili asks one useful, simple question at a time, uses all supplied information, and skips already-answered questions. Unknown answers may signal confusing wording. Offer an insurance-card/file upload or simpler guidance; respect missing files and declined uploads. No fixed question count.
- Accept insurance cards, plan files and benefits summaries through PDF/JPG/PNG. Extract only stated facts; cards may lack coverage rules or current balances. Preserve missing amounts rather than filling defaults.
- Intermittently show an editable ?what we know / still to check? checkpoint, especially after document extraction. Confirmation continues the consultation; corrections return to Bili for validated extraction.
- Ask whether the user has a dentist/clinic bill or price estimate. Accept uploads, typed descriptions and editable voice transcripts. Preserve actual quoted prices for each procedure. Distinguish full fees from already-after-insurance patient estimates, retaining both when present.
- Patients review their extracted financial inputs before the deterministic backend calculates. Show dentist's price, what the patient pays first, the plan's payment and estimated personal cost, with concise explanations of each. Preserve unknowns and consequential assumptions. Never subtract insurance twice from a net clinic estimate.
- Insurance-only goals receive a coverage explanation and useful next actions, without forcing a treatment estimate or empty calculator.
- Keep the wide horizontal modal, Geist Sans, warm cards, short consultant messages, smooth transitions and responsive desktop/mobile layouts. Every question supports choices, typing, speech and uploading. Functional document/microphone icons only; no emojis or generic AI icons.
- Optional date comparisons respect actual yearly reset dates, dentist-approved windows, dependencies and confirmed next-year plan terms. Changing confirmed dates recalculates. Planned benefit usage is distinct from paid claims; calendar-file reminders are available.

The prototype supports USD, up to eight procedures and five documents (10 MB combined), and the current/next plan years. Supabase now stores demo profiles and consultation progress; insurer verification remains unavailable. Unsupported policy rules require verification instead of invented precision.

Verify with `npm test` and `npm run build`. `npm run test:live` sends synthetic consultation/documents only to verify Gemini behavior. `npm run test:visual` checks desktop/mobile screens using synthetic AI responses and the real calculator.

## Initial deliverable

A responsive PlanPilot welcome screen closely matching the first reference panel, with reusable styles ready for the onboarding flow. Subsequent phases extend it into a functional dental benefits journey.


## Phase 6: Account pages and Supabase persistence

- A top-left hamburger opens Overview, My Plan and Settings. Keep Geist Sans, the existing warm palette and responsive desktop/mobile views.
- Automatically load a browser-specific dummy profile. First visitors open My Plan; returning visitors open Overview. No real login form is needed for this demo.
- Overview presents the latest coverage facts, missing details, next actions and calculated treatment costs. Show meaningful empty/in-progress states rather than invented insurance data.
- My Plan keeps the first goal question full-page and later screens in the wide dialog. Resume saved questions or results with prior answers and extracted facts, without re-asking established details.
- Settings displays and edits basic name, email, phone and company information.
- Persist source-labeled extracted details, answer/review history, current question, financial drafts and reviewed inputs. Do not store uploaded file bytes or audio. Recalculate costs on restoration.
- Use the backend Supabase Data API with a server-only secret. Scope access to a validated signed demo cookie; deny public table access. See `supabase/README.md` and its migration for setup.
- Save changes automatically with visible saving/failure/retry states. A provisional device-only mode is available when no database is configured; do not silently replace a failed cloud save.
- Validate first/returning navigation, profile edits, account isolation, document-free persistence, saved consultation resumption, and desktop/mobile layouts.
