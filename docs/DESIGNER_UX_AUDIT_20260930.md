# Designer laptop / desktop UX audit — 2026-09-30

## Scope and outcome

Audit and simplify the current designer without changing template data, rendering,
print delivery, or sheet-label behavior. Independent validator inspected source,
exercised the browser with intercepted synthetic template/print writes, reviewed
screenshots, and challenged the implementation. No feature usage analytics exist;
therefore features were reorganized, not deleted based on guesswork.

## Findings closed

- Crowded laptop rails: responsive 248/264px rails (280px on larger screens),
  full available desktop width, wrapping header with one format selector.
- Competing Layers/Test Data scroll areas: separate persistent panels; switching
  preserves selection and values. Reusable elements are a secondary disclosure.
- Repeated tiny layer actions: ordering consolidated above selection; duplicate,
  delete, and unlock remain discoverable on selected/locked rows. Layer names
  have native keyboard buttons and selected state.
- Oversized stacked canvases: editor fits viewport with print proof disclosure
  visible; expanded print proof has a bounded independent workspace.
- Weak save feedback: Saving / All changes saved / Not saved plus existing Retry.
  Pending/error navigation waits for a queued save, including header links and
  sign-out. Failed saves keep edits in the editor. Closing/reloading warns while
  a save is pending or failed; this is not a claim of offline durable editing.
- Inspector rotation overflow: full-width rotation control with state labels;
  compact numeric controls now have descriptive accessible labels and tooltips.
- Keyboard conflict caught independently: Enter on a layer button no longer
  opens the previously selected text. Focused controls own their arrow keys;
  layer selections retain nudging and normal Undo remains available.

## Measured viewport checks

| Viewport | Whole layer rows with selection controls | Page horizontal overflow |
|---|---:|---|
| 1366 × 768 | 5 | none |
| 1440 × 900 | 7 | none |
| 1920 × 1080 | 10 | none |

The fixture contains 15 layers and a long name. The canvas, layer controls, and
collapsed Print Preview are visible initially. All layers remain scrollable.
Screenshots were inspected, not only DOM geometry. Expanded proof and printer
controls are reachable through the center panel's scroll region.

## Verification

- `node --require ./scripts/thermal/register.cjs scripts/thermal/test-designer.cjs`
- `node scripts/thermal/verify-designer.mjs <base>`: ordering, group copies,
  format Undo/Redo, save recovery, locks, library search/archive/filter.
- `node scripts/thermal/verify-ui.mjs <base>`: text edit/cancel, resize, held
  pointer/proof responses, QR warnings, sample-data bindings, conversion,
  exact Office proof/retry, sheet-size PDF geometry and saved-run proof.
- `node scripts/thermal/verify-ux-validator.mjs <base>`: three viewport checks,
  keyboard selection, panel-state persistence, failed-save retry, held-save
  navigation, failed-save header navigation. Captures `/tmp/lw-ux-<width>.png`.
- TypeScript, targeted ESLint, production build.

Browser harnesses require Chrome and the existing private account file; credentials
are not included. Template and print writes are intercepted; only test login/logout
sessions and read-only renderer requests reach the server.

Independent review verdict: materially clearer and easier to use; no remaining
release-blocking finding in tested scope. This is not a claim of perfection or a
complete accessibility-conformance certification. Phone layouts and physical
printer performance are outside this laptop/desktop UX task.
