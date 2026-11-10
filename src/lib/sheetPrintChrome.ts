/**
 * The sheet print page's toolbar, restyled to match the app. The HTML comes
 * from sheetPrint.ts, which stays untouched; this only adds a style block for
 * the on-screen toolbar (hidden when printing), rewords its text, gives the
 * page a language, a viewport, a main landmark and a heading, and shrinks the sheet to
 * fit a phone screen (screen only: paper always prints at 100%). Label pages,
 * their SVG and the mark-printed script are left exactly as built.
 */
const TOOLBAR_STYLE = `
  <style data-lw-toolbar>
    .toolbar { font-family: Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; font-size: 14px; padding: 12px 16px; background: #18181b; color: #e4e4e7; }
    .toolbar-main { gap: 2px; }
    .print-warning { border: 0; border-radius: 0; padding: 0; background: none; color: #fcd34d; font-weight: 500; text-transform: none; letter-spacing: 0; }
    .toolbar-title { margin: 0; font-size: 14px; font-weight: 600; color: #f4f4f5; }
    .toolbar button, .toolbar .back { min-height: 44px; border: 0; border-radius: 8px; padding: 8px 14px; font: inherit; font-weight: 600; cursor: pointer; }
    .toolbar .back, .toolbar button.done { background: #27272a; color: #f4f4f5; border: 0; }
    /* One main button at a time: print first, then mark it printed once the print dialog closes. */
    .toolbar button.secondary { background: #f59e0b; color: #18181b; }
    .toolbar.lw-printed button.secondary { background: #27272a; color: #f4f4f5; }
    .toolbar.lw-printed button.done { background: #f59e0b; color: #18181b; }
    .toolbar button:focus-visible, .toolbar .back:focus-visible { outline: 2px solid #fbbf24; outline-offset: 2px; }
    .toolbar .back { display: inline-flex; align-items: center; text-decoration: none; }
    .track-status { font-size: 13px; color: #a1a1aa; }
    @media screen {
      .sheet-page { zoom: var(--sheet-zoom, 1); }
    }
    @media screen and (max-width: 640px) {
      .toolbar { flex-direction: column; align-items: stretch; }
      .toolbar-actions { justify-content: flex-start; }
      .track-status { text-align: left; }
    }
  </style>
`;

/** Shrink the on-screen sheet to the window width (never on paper). */
function fitScript(sheetWidthInches: number): string {
  const px = Math.round(sheetWidthInches * 96);
  return `
  <script data-lw-fit>
    (function () {
      function fit() { document.documentElement.style.setProperty('--sheet-zoom', String(Math.min(1, (window.innerWidth - 24) / ${px}))); }
      fit();
      window.addEventListener('resize', fit);
    })();
  </script>
`;
}

/** After the print dialog closes, "Mark as printed" becomes the main button. */
const AFTER_PRINT_SCRIPT = `
  <script data-lw-afterprint>
    window.addEventListener('afterprint', function () {
      var bar = document.querySelector('.toolbar');
      if (bar) bar.classList.add('lw-printed');
    });
  </script>
`;

/** "labels 1-90" reads "labels 1–90", as everywhere else in the app. */
const enDash = (text: string) => text.replace(/(\d)-(\d)/g, '$1–$2');

export function restyleSheetPrintToolbar(html: string, runId: string): string {
  if (html.includes('data-lw-toolbar')) return html;
  const back = `<a class="back" href="/runs/${encodeURIComponent(runId)}">Back to run</a>`;
  const sheetWidth = Number(/\.sheet-page \{\s*position: relative;\s*width: ([\d.]+)in;/.exec(html)?.[1] ?? '8.5') || 8.5;
  return html
    .replace('<html>', '<html lang="en">')
    .replace(/<title>([^<]*)<\/title>/, (m, title: string) => (/Label Wrangler/.test(title) ? m : `<title>${enDash(title)} — Label Wrangler</title>`))
    // Without a viewport, a phone lays the page out 980px wide and the sheet
    // never shrinks to the screen, so the page scrolls sideways.
    .replace('</head>', `  <meta name="viewport" content="width=device-width, initial-scale=1" />\n${TOOLBAR_STYLE}${fitScript(sheetWidth)}${AFTER_PRINT_SCRIPT}</head>`)
    .replace(/<body>\s*<div class="toolbar">\s*<div class="toolbar-main">\s*<div>([^<]*)<\/div>/, (_m, title: string) => `<body>\n  <main>\n  <div class="toolbar">\n    <div class="toolbar-main">\n      <h1 class="toolbar-title">${enDash(title)}</h1>`)
    .replace(/<\/body>(?![\s\S]*<\/body>)/, '</main>\n</body>')
    .replace('Print setting: 100% / Actual size. Do not use Fit to page.', 'Print at 100% (Actual size), not Fit to page')
    .replace('<div class="toolbar-actions">', `<div class="toolbar-actions">\n      ${back}`)
    .replace('>Print / Save PDF</button>', '>Print or save PDF</button>')
    .replace('>Mark printed in run</button>', '>Mark as printed</button>')
    .replace('After the sheet prints, mark it printed to update the run.', 'When the sheet has printed, mark it as printed.');
}
