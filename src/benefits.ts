import { z } from 'zod';
import { emptyFinancialState, financialSchema, calculationSchema, type FinancialState } from './financeApi';

const money = z.number().finite().nonnegative();
const quoteSchema = z.object({ procedureId: z.string(), quote: money.nullable(), allowedAmount: money.nullable(), insurancePercent: z.number().min(0).max(100).nullable(), covered: z.boolean().nullable(), deductibleApplies: z.boolean().nullable() });
const scenarioSchema = z.object({ remainingDeductible: money.nullable(), remainingBenefit: money.nullable(), quotes: z.array(quoteSchema) });
export const benefitsSchema = z.object({ financialState: financialSchema, confirmed: z.boolean(), openingUsed: money.nullable(), openingDeductible: money.nullable(), claims: z.array(z.object({ id: z.string(), name: z.string(), date: z.string(), insurerPaid: money, deductiblePaid: money })), network: z.object({ in: scenarioSchema, out: scenarioSchema }), reminders: z.object({ enabled: z.boolean(), leadDays: z.union([z.literal(14), z.literal(30), z.literal(60), z.literal(90)]), dismissedYearEnd: z.string().nullable() }) });
export type Benefits = z.infer<typeof benefitsSchema>;
export type Claim = Benefits['claims'][number];
export type NetworkQuote = z.infer<typeof quoteSchema>;
export const networkResultSchema = z.object({ inNetwork: calculationSchema, outOfNetwork: calculationSchema, difference: z.number().nullable() });
export type NetworkResult = z.infer<typeof networkResultSchema>;
export function createBenefits(state: FinancialState | null = null, confirmed = false): Benefits {
  const financialState = structuredClone(state || emptyFinancialState);
  return { financialState, confirmed, openingUsed: financialState.plan.annualMaximum !== null && financialState.plan.remainingBenefit !== null ? Math.max(0, financialState.plan.annualMaximum - financialState.plan.remainingBenefit) : null, openingDeductible: financialState.plan.remainingDeductible, claims: [], network: { in: { remainingDeductible: null, remainingBenefit: null, quotes: [] }, out: { remainingDeductible: null, remainingBenefit: null, quotes: [] } }, reminders: { enabled: true, leadDays: 30, dismissedYearEnd: null } };
}
export function currentClaims(data: Benefits) {
  const { benefitYearStart: start, benefitYearEnd: end } = data.financialState.plan;
  return start && end ? data.claims.filter(claim => claim.date >= start && claim.date <= end) : [];
}
export function usage(data: Benefits) {
  const paid = currentClaims(data).reduce((total, claim) => total + Math.round(claim.insurerPaid * 100), 0) / 100;
  const used = data.openingUsed === null ? null : Math.round((data.openingUsed + paid) * 100) / 100;
  const maximum = data.financialState.plan.annualMaximum;
  return { paid, used, remaining: maximum === null ? data.financialState.plan.remainingBenefit : used === null ? null : Math.max(0, Math.round((maximum - used) * 100) / 100), maximum };
}
export function normalizeBenefits(data: Benefits): Benefits {
  return { ...data, financialState: { ...data.financialState, plan: { ...data.financialState.plan, remainingBenefit: usage(data).remaining, remainingDeductible: data.openingDeductible === null ? null : Math.max(0, Math.round((data.openingDeductible - currentClaims(data).reduce((sum, claim) => sum + claim.deductiblePaid, 0)) * 100) / 100) } } };
}
export function localToday(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
export function daysUntil(end: string, today = localToday()) {
  return Math.round((Date.parse(`${end}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86400000);
}
export function reminderDue(data: Benefits, today = localToday()) {
  const end = data.financialState.plan.benefitYearEnd;
  return !!end && data.reminders.enabled && data.reminders.dismissedYearEnd !== end && daysUntil(end, today) >= 0 && daysUntil(end, today) <= data.reminders.leadDays && (usage(data).remaining === null || usage(data).remaining! > 0);
}
export function calendarReminder(end: string, leadDays: number, now = new Date()) {
  const date = new Date(`${end}T12:00:00Z`); date.setUTCDate(date.getUTCDate() - leadDays);
  const start = date.toISOString().slice(0, 10).replaceAll('-', '');
  date.setUTCDate(date.getUTCDate() + 1);
  const finish = date.toISOString().slice(0, 10).replaceAll('-', '');
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//PlanPilot//Benefits reminder//EN', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT', `UID:planpilot-benefits-${end}-${leadDays}@planpilot.local`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${start}`, `DTEND;VALUE=DATE:${finish}`, 'SUMMARY:Review unused dental benefits', 'DESCRIPTION:Review your remaining benefits before your plan year ends.', ' Discuss dentist-recommended care and confirm coverage with your insurer.', 'BEGIN:VALARM', 'TRIGGER:PT9H', 'ACTION:DISPLAY', 'DESCRIPTION:Review unused dental benefits', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n');
}
export function downloadCalendar(end: string, leadDays: number) {
  const url = URL.createObjectURL(new Blob([calendarReminder(end, leadDays)], { type: 'text/calendar;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = 'PlanPilot-benefits-reminder.ics'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function compareNetworkCosts(state: FinancialState, network: Benefits['network'], signal?: AbortSignal): Promise<NetworkResult> {
  const response = await fetch('/api/network-estimate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state, network }), signal });
  const value = await response.json();
  if (!response.ok) throw new Error(value.message || 'Could not compare network costs. Please retry.');
  return networkResultSchema.parse(value);
}
