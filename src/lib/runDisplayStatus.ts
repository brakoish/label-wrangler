import type { RunStatus } from './types';

/** What the office printer has done for a run (display only; never progress). */
export interface RunOfficeSummary { sent: number; onTheWay: number; failed: number }

export type RunDisplayTone = 'done' | 'active' | 'attention' | 'paused' | 'cancelled' | 'idle';

/**
 * One status line for a run, shared by the run header and the Runs list.
 * Office deliveries are shown as "Sent", never as "Printed": the office
 * reports labels sent to the printer, which is not proof they printed.
 * A run is never called "Ready to print" while labels are on their way.
 */
export function runDisplayStatus(run: { status: RunStatus | string; printedCount?: number | null; totalLabels: number }, office?: RunOfficeSummary | null): { label: string; tone: RunDisplayTone } {
  const printed = run.printedCount ?? 0;
  const total = run.totalLabels;
  if (run.status === 'cancelled') return { label: 'Cancelled', tone: 'cancelled' };
  if (total > 0 && printed >= total) return { label: 'Done', tone: 'done' };
  if (office && office.failed > 0) return { label: 'Office print needs a check', tone: 'attention' };
  if (office && office.onTheWay > 0) return { label: 'Sending to office printer', tone: 'active' };
  if (run.status === 'printing') return { label: 'Printing', tone: 'active' };
  if (run.status === 'completed') return { label: 'Done', tone: 'done' };
  if (office && total > 0 && office.sent >= total) return { label: 'Sent to office printer', tone: 'paused' };
  if (office && office.sent > 0) return { label: printed > 0 ? 'Partly printed' : 'Partly sent', tone: 'paused' };
  if (printed > 0 || run.status === 'paused') return { label: printed > 0 ? 'Partly printed' : 'Paused', tone: 'paused' };
  if (run.status === 'draft') return { label: 'Draft', tone: 'idle' };
  return { label: 'Ready to print', tone: 'idle' };
}

/** "Sent to office printer: X of N" — the office line next to printed progress. */
export function officeSentLine(office: RunOfficeSummary | null | undefined, total: number): string | null {
  if (!office || (office.sent === 0 && office.onTheWay === 0 && office.failed === 0)) return null;
  const parts = [`Sent to office printer: ${office.sent.toLocaleString()} of ${total.toLocaleString()}`];
  if (office.onTheWay > 0) parts.push(`${office.onTheWay.toLocaleString()} on the way`);
  return parts.join(' · ');
}
