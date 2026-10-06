# Reliability release (2026-10-06)

## Operator behavior
- Local printing: pause/cancel before in-app navigation. Back/route teardown cancels future sends. A batch already handed to Dazzle/WebUSB may still print; this is not a hardware emergency stop.
- Progress uses a durable browser outbox. Pending sync/storage problems remain visible. Do not clear browser storage with pending updates. New local batches wait for previously pending progress to sync.
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

## Monitoring / operational boundaries
- Client JavaScript failures and >500ms main-thread tasks emit bounded, authenticated structured Vercel logs (at most 10 reports per document). No label values, package tags, query strings or stack traces are transmitted by this instrumentation.
- Hosting alert routing, provider point-in-time recovery retention and scheduled off-machine backup policy are not established by this code change. The verified private backup/restore rehearsal is not a replacement for those operator settings. They require provider-level configuration/access and remain explicit operational follow-ups.
- Physical printer behavior is not certified by mocked tests. Delivery acceptance is not physical-label confirmation.
