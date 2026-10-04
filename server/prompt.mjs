import { readFile } from 'node:fs/promises';
import { interactionStatus, journeySignals } from './journey.mjs';

export async function readSystemPrompt(path = new URL('./prompts/consultation.md', import.meta.url)) {
  const prompt = (await readFile(path, 'utf8')).replace(/^\uFEFF/, '').trim();
  if (!prompt || prompt.length > 48000) throw new Error('The consultation system prompt must contain between 1 and 48000 characters.');
  return prompt;
}

export function buildRuntimeContext(request, financialResult = null) {
  const previouslyAskedQuestions = request.answers.map(answer => ({ id: answer.id, question: answer.prompt, answerStatus: interactionStatus(answer), askAgain: false }));
  return {
    currentStage: request.mode === 'summary' ? 'results_requested' : request.answers.length === 1 ? 'understand_goal' : 'adaptive_consultation',
    userGoals: [request.answers[0].choice].filter(Boolean),
    latestUserInteraction: request.answers.at(-1),
    journeySignals: journeySignals(request),
    previouslyAskedQuestions,
    unresolvedInformation: previouslyAskedQuestions.filter(question => ['unknown', 'declined'].includes(question.answerStatus)),
    validatedFinancialState: request.financialState || null,
    unconfirmedFinancialDraft: request.financialDraft || null,
    previouslyCapturedFacts: request.savedFacts || [],
    savedFactGuidance: 'Previously captured facts are source-labeled consultation records, not new documents or insurer verification. Original file contents may be unavailable after resuming. Preserve exact source excerpts and never claim to have freshly read an absent file. Use corrected confirmed financial inputs for calculations.',
    sourceStatus: { answers: 'user_reported', document: request.document || request.documents?.length ? 'available_for_model_extraction_not_independently_verified' : 'not_provided', financialState: request.financialState ? 'patient_confirmed_inputs_not_insurer_verified' : 'not_confirmed' },
    latestCalculation: financialResult?.calculation || null, evaluatedSchedulingScenarios: financialResult?.optimization || null, currentTimeline: request.financialState?.procedures.map(p => ({ id: p.id, date: p.date })) || null,
    locale: 'en-US', currency: request.financialState?.currency || null,
    availableCapabilities: {
      typedInput: true, browserSpeechToText: true, editableTranscript: true, choiceCards: true,
      documentUpload: true, nativeDocumentUnderstanding: true, answerReviewAndEditing: true, coverageCheckpoints: true, sourceExcerpts: true, textPlanExport: true,
      multiSelectGoalCards: false, numericInput: true, dateSelector: true,
      costCalculator: true, uncertaintyAnalysis: false, scheduleOptimizer: true, interactiveTimeline: true,
      networkComparisonTool: false, benefitsTracking: true, nearbyClinicSearch: false, publishedClinicPrices: false, reminderCalendarExport: true,
      reminderScheduling: false, persistentConsultations: true, insurerVerification: false, pdfExport: false,
    },
    availableTools: ['deterministic_cost_calculator', 'two_benefit_year_schedule_comparison'],
  };
}
