/**
 * The sheet print page's toolbar, restyled to match the app. The HTML comes
 * from sheetPrint.ts, which stays untouched; this only adds a style block for
 * the on-screen toolbar (hidden when printing) and rewords its text. Label
 * pages, their SVG and the mark-printed script are left exactly as built.
 */
const TOOLBAR_STYLE = `
  <style data-lw-toolbar>
    .toolbar { font-family: Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; font-size: 14px; padding: 12px 16px; background: #18181b; color: #e4e4e7; }
    .toolbar-main { gap: 2px; }
    .print-warning { border: 0; border-radius: 0; padding: 0; background: none; color: #fcd34d; font-weight: 500; text-transform: none; letter-spacing: 0; }
    .toolbar button, .toolbar .back { min-height: 40px; border: 0; border-radius: 8px; padding: 8px 14px; font: inherit; font-weight: 600; cursor: pointer; }
    .toolbar button.secondary, .toolbar .back { background: #27272a; color: #f4f4f5; border: 0; }
    .toolbar button.done { background: #f59e0b; color: #18181b; }
    .toolbar button:focus-visible, .toolbar .back:focus-visible { outline: 2px solid #fbbf24; outline-offset: 2px; }
    .toolbar .back { display: inline-flex; align-items: center; text-decoration: none; }
    .track-status { font-size: 13px; color: #a1a1aa; }
  </style>
`;

export function restyleSheetPrintToolbar(html: string, runId: string): string {
  if (html.includes('data-lw-toolbar')) return html;
  const back = `<a class="back" href="/runs/${encodeURIComponent(runId)}">Back to run</a>`;
  return html
    .replace('</head>', `${TOOLBAR_STYLE}</head>`)
    .replace('Print setting: 100% / Actual size. Do not use Fit to page.', 'Print at 100% (Actual size), not Fit to page')
    .replace('<div class="toolbar-actions">', `<div class="toolbar-actions">\n      ${back}`)
    .replace('>Print / Save PDF</button>', '>Print or save PDF</button>')
    .replace('>Mark printed in run</button>', '>Mark as printed</button>')
    .replace('After the sheet prints, mark it printed to update the run.', 'When the sheet has printed, mark it as printed.');
}
