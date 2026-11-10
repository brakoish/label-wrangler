import type { LabelFormat, LabelTemplate } from './types';
import { checkRunBarcodes, valuesFor, type BarcodeIssue } from './barcodeCheck';
import { barcodeAutoFix, barcodeToQr, type BarcodeAutoFix } from './barcodeAutoFix';
import { bitmapLayoutProblems } from './bitmapLayout';
import { runLayoutIssues } from './runLayoutCheck';

type RunData = Parameters<typeof checkRunBarcodes>[1];
type Template = Pick<LabelTemplate, 'elements'> & Partial<Pick<LabelTemplate, 'thermalRenderMode'>>;

export interface RunBarcodeFixes {
  /** The barcode the fixes change. */
  elementId: string;
  /** "Fix it for me": move / widen / turn, checked on every label. */
  fix: BarcodeAutoFix | null;
  /** "Use a QR code instead", sized for the longest value, checked on every label. */
  qr: BarcodeAutoFix | null;
}

/** The values of the label whose `field` is longest (the QR code is sized for it). */
function longestValues(run: RunData, field: string | undefined, rows: number): Record<string, string> {
  let best = valuesFor(run, 0);
  if (!field) return best;
  for (let i = 1; i < rows; i++) {
    const values = valuesFor(run, i);
    if ((values[field] ?? '').length > (best[field] ?? '').length) best = values;
  }
  return best;
}

/**
 * The new-run page's "Fix it for me" / "Use a QR code instead" for a barcode
 * that won't print whole: the designer's fixes, offered only when the changed
 * design prints that barcode whole on every label, lands on nothing and adds
 * no other problem. A fix changes that one item of the design and nothing
 * else (never how labels are printed).
 */
export function runBarcodeFixes(template: Template | null | undefined, run: RunData, format: LabelFormat | null | undefined, issues: ReadonlyArray<BarcodeIssue>, limit = 2000): RunBarcodeFixes | null {
  if (!template || !format || format.type !== 'thermal') return null;
  const target = issues.find((issue) => issue.kind === 'too-long' && issue.elementId && issue.fit);
  if (!target?.elementId) return null;
  const el = template.elements.find((e) => e.id === target.elementId);
  if (!el || el.type !== 'barcode' || el.locked) return null;
  const bitmap = template.thermalRenderMode === 'bitmap-v1';
  const rows = Math.max(1, Math.min(run.sourceData.length, limit));
  // Fix for the widest value the check found.
  const widest = issues.filter((i) => i.elementId === el.id && i.fit && i.kind !== 'characters').reduce((a, b) => ((b.fit?.barsDots ?? 0) > (a.fit?.barsDots ?? 0) ? b : a), target);
  const widestValues = valuesFor(run, Math.max(0, (widest.label || 1) - 1));
  const valueProblems = issues.filter((i) => i.kind === 'characters').length;
  const layoutBefore = runLayoutIssues(run, template, format, rows).length;
  const holds = (fix: BarcodeAutoFix | null, sized: Record<string, string>): BarcodeAutoFix | null => {
    if (!fix) return null;
    const after = { ...template, elements: fix.elements };
    const check = checkRunBarcodes(after, run, format);
    // On every label: no barcode left that won't print whole, nothing new.
    if (check.issues.some((i) => i.kind !== 'characters') || check.issues.length > valueProblems) return null;
    if (runLayoutIssues(run, after, format, rows).length > layoutBefore) return null;
    if (bitmap && bitmapLayoutProblems(fix.elements, format, sized).some((p) => p.ids.includes(el.id))) return null;
    return fix;
  };
  const fix = holds(barcodeAutoFix(template.elements, el.id, format, widestValues, bitmap), widestValues);
  const longest = longestValues(run, el.fieldName, rows);
  const qr = fix ? null : holds(barcodeToQr(template.elements, el.id, format, longest, bitmap), longest);
  if (!fix && !qr) return null;
  return { elementId: el.id, fix, qr };
}
