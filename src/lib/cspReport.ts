/**
 * Trimmed, log-safe summaries of Content-Security-Policy violation reports.
 * Handles the legacy report-uri body ({"csp-report": {...}}) and the
 * Reporting API body ([{ type: "csp-violation", body: {...} }]). URLs lose
 * their query and fragment (they can carry tokens), and every field is
 * cut short, so a hostile report can't flood or forge log lines.
 */
const MAX_FIELD = 200;
const MAX_REPORTS = 5;
function clip(value: unknown, url = false): string {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  let text = String(value).replace(/[\u0000-\u001f\u007f]+/g, ' ');
  if (url) text = text.split(/[?#]/)[0];
  return text.slice(0, MAX_FIELD);
}
type Record_ = Record<string, unknown>;
function summary(report: Record_): string {
  const directive = clip(report['effective-directive'] ?? report.effectiveDirective ?? report['violated-directive'] ?? report.violatedDirective);
  const blocked = clip(report['blocked-uri'] ?? report.blockedURL, true);
  const page = clip(report['document-uri'] ?? report.documentURL, true);
  const where = clip(report['source-file'] ?? report.sourceFile, true);
  const line = clip(report['line-number'] ?? report.lineNumber);
  const disposition = clip(report.disposition);
  return [`directive=${directive || '?'}`, `blocked=${blocked || '?'}`, `page=${page || '?'}`, where && `source=${where}${line ? `:${line}` : ''}`, disposition && `disposition=${disposition}`].filter(Boolean).join(' ');
}
export function summarizeCspReports(payload: unknown): string[] {
  const items: Record_[] = [];
  if (Array.isArray(payload)) {
    for (const entry of payload.slice(0, MAX_REPORTS)) {
      const body = entry && typeof entry === 'object' ? (entry as Record_).body : null;
      if (body && typeof body === 'object' && !Array.isArray(body)) items.push(body as Record_);
    }
  } else if (payload && typeof payload === 'object') {
    const report = (payload as Record_)['csp-report'];
    if (report && typeof report === 'object' && !Array.isArray(report)) items.push(report as Record_);
  }
  return items.map(summary);
}
