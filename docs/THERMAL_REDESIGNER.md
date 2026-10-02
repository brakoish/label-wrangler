# Thermal designer rollout — 2026-09-24

Scope: thermal rolls only. Sheets keep their existing rendering. This branch is based on published main `d13551a`; it does not include the inactive continuous-run v2 branch.

## Use

- New thermal templates offer **Exact bitmap** (default) or **Native**. Existing templates always remain native unless you use **Duplicate and convert**; that creates a different template and does not relink saved runs.
- Designer library: **Lemon example** imports the supplied latest user-edited 2 × 1 / 203-DPI design as editable text, rectangle, and QR. **Import Natural label JSON** accepts the documented Natural v1 format, not arbitrary ZPL or OCR.
- Review the old/new proofs when converting. Arial/Helvetica are approximated by bundled Liberation Sans; Times and Courier use Liberation Serif/Mono. Native character width is not a real-font width: conversion resets it to 1 and discloses that change. Bindings/defaults/prefixes/suffixes are retained.
- Double-click text or select it and press Enter. Ctrl/Cmd+Enter commits; Escape cancels. Bound text edits its labeled default, not the selected row or binding. Sample values are saved separately per template in this browser.
- Thermal box resizing leaves type size alone; Shift-corner resizing scales type. Marquee selects; Shift-click toggles selection; Shift during drag locks an axis; Alt-drag duplicates with bindings. Ctrl/Cmd bypasses snapping. Multiple selected objects expose alignment and equal-gap controls.
- One completed gesture is one undo step and one serialized save. Repeated redo retains the rest of the redo stack. Arrow holds save as one transaction; upright arrow directions follow the screen.
- Bitmap proofs require a connection/login. A stale or failed proof cannot authorize a new designer print. Missing symbols, unsupported glyphs, missing assets, and text overflow produce errors rather than substitute output.
- Office designer prints verify every displayed feed's pixel digest. Saved-run Office prints use **Prepare exact range proof**, with feed navigation; the server verifies the aggregate pixel digest before enqueue. Lost-response retries keep the same identity. Existing native pending-request fingerprints are unchanged.

## Authoritative renderer

`src/lib/thermal/render.server.ts` uses the existing Sharp/Pango dependency with explicitly bundled, licensed Liberation fonts. Font bytes, Sharp/library versions, platform/architecture and rendering policy version participate in the input digest. No new production dependency. No browser/system font assumption. Glyph coverage is checked before rendering.

The result includes exact dot dimensions, input/pixel SHA-256, MSB-first packed rows, a PNG reconstructed from those rows, and inspectable ASCII graphic ZPL generated from the same rows. Policy `bitmap-v1-liberation-160-qrpadding4`: composite on white, luminance <160 once, white row padding, graphic strips at most 99,999 bytes. Whole-dot QR and barcode modules include quiet zones; symbols cannot be clipped at the label edge.

Browser preview, thumbnails, layout/run previews, local/Dazzle output, scan generation, ZPL/PDF export, and Office rendering explicitly branch on mode. Synchronous native generation rejects bitmap input. Bitmap ZPL preview decodes its graphics directly rather than invoking the legacy ZPL emulator. PDF dimensions use the actual full-liner dot width / DPI, including the second lane and margins.

Bindings use the existing run resolver, including blank → default, literal string `0`, prefix/suffix, CSV column mappings and pasted values. Occupied empty objects are distinct from blank lanes. Range endpoints preserve original lane positions; excluded lanes remain white. Historical future reprints still use the then-current referenced template, as before; immutable queued jobs remain immutable.

## Limits / rollout

- Additive migration: `scripts/thermal/migrate.mjs` adds `thermal_render_mode`, default `native-v1`. No data is dropped and no existing template is converted.
- Max raster: 12 million pixels. Max render response: 3.5 MB, bounded browser result cache. Browser range generation is on demand and sequential with a 32 MiB ZPL cap (not eager on loading a run).
- Office: unchanged 25 logical labels / 2 MiB per batch and 32 MiB per invocation. Bitmap server preparation stops with an explicit smaller-range error at its 40-second preparation budget, before enqueue. Native controls, pause/review gates, queues and transport services are not replaced.
- Local queues enforce a 2 MiB decoded payload cap and complete-feed boundaries. No automatic replay on an uncertain send. No compression or new continuous-print transport was introduced.
- Pure Lemon rendering was about 0.12 seconds locally; its feed is 20,921 bytes. A 100-feed variable-QR Lemon run generated 2,092,100 ZPL bytes in 7.84 seconds locally. This is software timing, not physical throughput. Large bitmap runs cost more network traffic than native ZPL.

## Reproduce verification

Use Node 24 and `npm ci`. The independent decoder is test-only, installed outside this repository:

```
npm install --prefix /tmp/lw-bitmap-verification --no-save --ignore-scripts @zxing/library@0.21.3
node scripts/thermal/test.cjs
node --env-file=<private-env-file> scripts/thermal/test-persistence.cjs
node --env-file=<private-env-file> scripts/thermal/test-office.cjs
```

SQL tests create isolated named schemas and no production jobs/templates. They retain their schema evidence; cleanup is separate. Browser/host scripts read the existing private test account locally and never print credentials:

```
node scripts/thermal/verify-ui.mjs http://127.0.0.1:3130
node scripts/thermal/verify-host.cjs http://127.0.0.1:3130
```

Browser verification intercepts every template save, test-run print/event write and Office enqueue. It uses the real authenticated raster endpoint, real UI gestures, and real PDF download code, without sending physical jobs. The host script checks hosted PNG/packed/ZPL equality, repeatability and QR decoding, and reports the local-versus-host digest comparison. Vercel and the development host have different text rasterization; identical font files alone do not guarantee identical host pixels. All client paths request the hosted authority, and Office validates those hosted pixel digests before enqueue.

Verified: 112 assertions covering legacy golden output, exact graphic pixels/strips/odd widths, decoded Lemon QR and all six barcode formats, all QR correction levels, 203/300/600 geometry, font families/bold/italic/rotation, image fits/transparency, defaults/paste/CSV/manual lanes, seven-at-three and range 2–5, 1–4 lanes with margins, byte caps, uncertain-send behavior, resize geometry and redo. Real route SQL tests verify native default, thermal-only mode, blocked in-place conversion, round-trip, archive/restore and run references. Office tests verify matching/mismatched proofs, concurrent/lost-response retries, saved-run digest enforcement, permissions and rollback.

Browser checks cover inline binding-safe edit/cancel, box/type resizing, multi-step undo/redo, Alt-copy binding preservation, save count, reload, upright held-arrow transactions, Office proof/retry, and one-/two-across PDF sizes.

**Physical acceptance remains separate:** no printer job was submitted by this work. Measure and scan one real 203-DPI label, approve the Liberation approximation, then assess representative run throughput and mid-run pause/resume. Software pixel equality does not certify media calibration or physical print speed.

Bitmap text without an explicit autoFit setting fits its box; explicit false remains strict. Transparent text-box padding may extend outside the label, but cropped ink blocks printing. A failed proof shows an explicitly labeled editing approximation instead of hiding all objects. Font substitution still requires visual review of converted layouts.

Conversion retains native character width, bounds unrotated text boxes to the label and next field origin with a 4-dot gap, and enables fitting. Review is required; failed proofs cannot be saved as converted copies. Earlier converted copies discarded character width: reconvert from the untouched original rather than guessing or overwriting edited copies. Horizontal bitmap scaling uses fill (never cover-crop).

Editing requests use a separate non-printable draft response: unaffected objects remain pixel-exact, edge-clipped artwork is shown with per-object warnings, and unrenderable objects are highlighted. Draft responses intentionally contain no ZPL or packed print bytes. Designer canvas and invalid print previews use drafts; conversion, Office, exports and printing continue to use strict validation. Moving an object back into valid geometry clears the warning without changing other objects.

QR allocation padding outside the four-module quiet zone is transparent/non-printing. Edge validation checks the actual QR plus quiet zone, not the outer resize box; the symbol keeps its existing center and module size.
The editor uses server-reported QR quiet-zone bounds for error outlines. “Fit QR inside label” minimally translates an affected QR when its required area fits the label, using the normal edit/undo transaction; it never changes the encoded data or module size.
QR selection/resize handles and warning highlights follow the black module grid, reported separately as qrInkBounds. The surrounding clear margin is not an oversized selection rectangle. Single QR resizing maps the ink-bound gesture proportionally to the saved allocation; required quiet-zone validation remains unchanged.
