# Reliability release (2026-10-06)

## Operator behavior
- Local printing: pause/cancel before in-app navigation. Back/route teardown cancels future sends. A batch already handed to Dazzle/WebUSB may still print; this is not a hardware emergency stop.
- Progress uses a durable browser outbox. Pending sync/storage problems remain visible. Do not clear browser storage with pending updates. A new local batch waits only for that run's pending progress to sync; other runs are not blocked.
- Network errors, 401 (sign in again), 408, 429 and 5xx keep retrying in order per run. Permanent refusals (400, 403, 404, 409, 410, 422, e.g. the run was deleted elsewhere) are set aside with a plain-language reason and Export/Discard buttons; they never block printing.
- Run progress is a high-water mark for progress-only updates: the server keeps the highest `printedCount` it has seen, so a late or stale progress update cannot move the resume position back. On this build, an update that also carries a status is held to the same rule; only "Go back to label N" rewinds it, with an explicit `resetProgress` that applies only if progress hasn't moved since the person tapped it (compare-and-set). On main (`ffda577`), and from any tab that has no `X-LW-Client` header, an update that carries a status is an exact write (see Rollback procedure).
- Deleting a run with print history, a preset used by runs, or a format used by designs is refused with a 409 and an explanation; the item is kept. Templates are archived rather than deleted.
- Runs retain an immutable template/format snapshot. Template edits affect new runs, not reprints of existing runs. Pre-release runs are marked as captured from the design available during this update; this cannot reconstruct original artwork that was already overwritten.
- Template saves require their loaded revision. Conflicts leave the local draft intact; recover/save as a separate template instead of silently replacing someone else's edits. Failed saves stay in the tab, and recoverable drafts are offered when reopening a template. Recovery copies do not overwrite the saved design.
- Old tabs without revision support receive a refresh-required error. Duplicate unsaved work before refreshing; do not discard unsaved edits.
- Libraries load metadata in bounded pages. Artwork is loaded on opening a template; full native-run output is prepared only for an explicit print/export range. Initial counts/search results fill as the remaining metadata pages arrive.
- API errors retain last-good lists; failed deletions do not remove records locally. Retry/session-expiry controls are visible.

## Verification and release
- `npm test`: deterministic offline regressions; no database/printer access. Included in `npm run build`, so failed checks block deployment.
- `npm run typecheck`: compile-time validation.
- `node scripts/production/verify-browser.mjs http://localhost:3150`: synthetic browser check. ALL API and Dazzle requests intercepted; never prints physical labels.
- `node scripts/production/verify-database.cjs`: opt-in real database integration in a uniquely named isolated schema, synthetic rows only. Verifies snapshots, atomic save conflicts, validation and stale-progress rejection. Test schema retained for inspection.
- `node scripts/production/measure-loads.cjs`: read-only list payload comparison (not an end-to-end timing claim).
- Vercel build gates on regressions and its own TypeScript compilation. GitHub Actions is staged at `docs/pending/github-checks.yml`: current OAuth authorization lacks workflow scope, so it cannot yet be installed at `.github/workflows/checks.yml`. After activation and a passing run, require the `checks` status on main. Do not claim GitHub CI/branch protection is enabled until then.

## Migration / rollback
- Run `node scripts/production/backup-verify.cjs /absolute/private/backup/directory` before migration. Backups are confidential, mode 0600, outside the repository. This script reads six application-data tables under a consistent snapshot, then rehearses exact restore into transaction-local temporary tables. It does not back up office credentials, printer-pairing state, or the entire provider instance.
- `node scripts/production/migrate.cjs` adds nullable `runs.design_snapshot` and captures CURRENT designs for unsnapshotted existing runs. Idempotent; no progress/template updates and no removed columns. Run before deploying code that reads that column.
- Rollback can restore the previous application deployment without removing the additive column. Older code does not enforce snapshots/revision checks, so rollback weakens those guarantees. Do not drop the snapshot column.

## Rollback procedure
1. In Vercel, promote the previous production deployment `dpl_8jXofwmB9VdFPqYaRiQPsH4XaMPv` (main, `ffda577`). No database step: this branch has no schema change or migration, and the Pi API and printed bytes are the same, so office stations keep polling and printing.
2. Right away, reload every open Label Wrangler tab (shop tablets, office computers, phones) so each runs main's page code. Do not clear browser storage on any device. Until a tab is reloaded it runs this build's page code against main's server (see below).
3. Tell the people printing that, on main, a busy run's progress can move back (next section), and to check the run's progress before they resume.

What happens to work still queued on a device:
- Ordinary progress and print events saved offline stay in main's outbox keys (`lw:run-op:`), so main's code sends them after the reload. On main only progress-only updates are a high-water mark. An update that carries a status (for example `{printedCount: 40, status: 'printing'}` from a laptop that was offline) is an exact write on main: if it lands after another device reached 60, progress drops to 40. Main behaves this way today; this build doesn't make it worse, but it can happen during a rollback while devices catch up.
- A "Go back to label N" still waiting on a device is stored apart (`lw:run-op-v2:`), with its print-history entry. Main's code never reads or sends it, so it cannot stall main's outbox or hold up new batches. If you need that go-back on main, do it again there (Reprint from). If the deployment is later rolled forward, that device sends it then; it is applied only if the run's progress hasn't moved since, otherwise it is set aside with a plain "wasn't applied" notice.
- A tab of this build that was not reloaded sends a go-back as a guarded rewind. Main refuses it ("Invalid field resetProgress"), and this build never resends it as an unguarded exact write, because that could erase progress made in between. It is set aside with a plain notice: "wasn't applied, because Label Wrangler was changed back to an earlier version. Reload the page, then go back again." Its print-history entry is never sent. Updates set aside earlier stay in Export/Discard.
- Office sends waiting for an answer (`lw:office-pending:<run>`) carry over unchanged: same key, same payload, same idempotency key, so a retry from main can't print twice. A printer control (pause/resume) waiting for an answer stays readable by main too: this build keeps the old device-wide key until that control is answered.
- Print history keeps any "Went back to label N" entries (event type `rewind`). Main has no words for that type, so it lists them as "Went back to label N labels A–B"; it otherwise ignores them. The cancel entries this build records (what was stopped at the office, what was never sent) are ordinary `cancelled` events, which main lists as plain history lines.

## Permissions notes
- A print-only account can change a run's progress fields through `PUT /api/runs/[id]` (`print-or-edit`): `printedCount`, `status` and `completedAt`. That includes completing or cancelling a run, which is intended: an operator finishes or cancels the run they print. Everything else on a run (name, data, design) needs an edit account.

## Browser hardening
- `next.config.ts` sends nosniff, Referrer-Policy, X-Frame-Options DENY, a Permissions-Policy that keeps WebUSB (`usb=(self)`), and a report-only CSP on every path except `/api/print-stations/*` (Pi responses are unchanged). The CSP is not enforced because the app uses WASM, a pdf.js worker, inline scripts in the sheet print tab and the Dazzle localhost bridge.
- The pdf.js worker in `public/` is copied from the installed `pdfjs-dist` by `scripts/copy-pdf-worker.cjs` (run by `npm run dev`/`npm run build`); `npm test` fails if they differ. Keep pdf.js on v4.

## Monitoring / operational boundaries
- Client JavaScript failures and >500ms main-thread tasks emit bounded, authenticated structured Vercel logs (at most 10 reports per document). No label values, package tags, query strings or stack traces are transmitted by this instrumentation.
- Hosting alert routing, provider point-in-time recovery retention and scheduled off-machine backup policy are not established by this code change. The verified private backup/restore rehearsal is not a replacement for those operator settings. They require provider-level configuration/access and remain explicit operational follow-ups.
- Physical printer behavior is not certified by mocked tests. Delivery acceptance is not physical-label confirmation.
