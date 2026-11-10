// Sheet print page: the toolbar matches the app (no all-caps warning, no green
// button, a way back) while the label pages and script stay byte-identical.
require('../thermal/register.cjs');
const assert = require('node:assert/strict');
require('./fake-svg-dom.cjs').install();
const { buildSheetPrintHtml } = require('../../src/lib/sheetPrint.ts');
const { restyleSheetPrintToolbar } = require('../../src/lib/sheetPrintChrome.ts');
(async () => {
  const format = { id: 'f', name: 'f', type: 'sheet', width: 2, height: 1, sheetWidth: 8.5, sheetHeight: 11, columns: 1, rows: 1 };
  const element = { id: 'b', x: 0.1, y: 0.1, width: 1.5, height: 0.5, rotation: 0, zIndex: 0, isStatic: true, type: 'text', content: 'Hello', textAlign: 'left', fontSize: 10 };
  const html = await buildSheetPrintHtml({ id: 'run 1', name: 'Run', sourceData: ['a'], totalLabels: 1, printedCount: 0 }, { elements: [element] }, format, { autoPrint: false });
  const out = restyleSheetPrintToolbar(html, 'run 1');
  assert.match(out, /Print at 100% \(Actual size\), not Fit to page/);
  assert.doesNotMatch(out, /Print setting: 100%/);
  assert.match(out, /<a class="back" href="\/runs\/run%201">Back to run<\/a>/);
  assert.match(out, /text-transform: none/);
  assert.match(out, /\.toolbar button\.secondary \{ background: #f59e0b/, '"Print or save PDF" is the main button first');
  assert.match(out, /\.toolbar\.lw-printed button\.done \{ background: #f59e0b/, '"Mark as printed" becomes the main button after printing');
  assert.match(out, /addEventListener\('afterprint'/);
  assert.match(out, /<title>[^<]* — Label Wrangler<\/title>/, 'the standard title');
  assert.match(out, /id="markPrintedButton"[^>]*>Mark as printed</);
  // Everything from the first label page on is unchanged.
  const pagesAt = html.indexOf('<section class="sheet-page"');
  assert.ok(pagesAt > 0, 'sheet pages present');
  const outPages = out.slice(out.indexOf('<section class="sheet-page"'));
  assert.equal(outPages.replace('</main>\n</body>', '</body>'), html.slice(pagesAt), 'label pages and script untouched (only the main landmark closes before </body>)');
  // Page structure and phone fit (screen only).
  assert.match(out, /<html lang="en">/);
  assert.match(out, /<main>\s*<div class="toolbar">/);
  assert.match(out, /<h1 class="toolbar-title">Run · labels 1–1<\/h1>/, 'an en dash, as everywhere else');
  assert.match(out, /<meta name="viewport" content="width=device-width, initial-scale=1" \/>/, 'phones lay the page out at their own width, so the sheet fits');
  assert.match(out, /@media screen \{\s*\.sheet-page \{ zoom: var\(--sheet-zoom, 1\); \}/);
  assert.match(out, /min-height: 44px/);
  // The print rules (toolbar hidden on paper) are untouched too.
  assert.ok(out.includes('.toolbar { display: none; }'));
  assert.equal(restyleSheetPrintToolbar(out, 'run 1'), out, 'applying twice changes nothing');
  console.log('PASS sheet print toolbar restyled; label pages byte-identical');
})().catch((error) => { console.error(error); process.exit(1); });
