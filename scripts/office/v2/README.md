# Inactive v2 preparation fixtures

Run from repository root: `node scripts/office/v2/test.cjs`.

These files have no API routes, service installation, database access, environment loading or printer transport. They do not change v1. `manifest.mjs` is an offline preparation/validation prototype, not an executable dispatch worker. It consumes complete trusted feed spans, uses bounded chunk assembly, calls an injected storage callback, then seals exact manifest bytes. The callback does NOT provide transactional durability by itself. Rejects may leave provisional chunks; a future durable worker must own their lifecycle and never publish an unsealed run.

The fixture uses the existing ZPL generator and server SVG conversion, synthetic unique QR strings, and a tiny synthetic logo. It validates 5,000 records at each of 1–4 across (20,000 logical records total), excluded lanes, hundreds of forced 4-KiB transport boundaries, hashes and repeat downloads. These 4-KiB boundaries are test parameters, not transport watermarks. `fixture-results.json` records measured fixture sizes; these are not representative production logo sizing or printer performance.

Descriptor ceiling measures 5,000 descriptors with 25 lane slots: deliberately conservative serialized shape, NOT a valid contiguous 5,000-record manifest. Maximum 2-MiB chunk response envelope is checked separately. The validator checks original lane positions in addition to ordered record coverage.

Not implemented/tested: immutable DB snapshots, Postgres preparation ownership/fencing/checkpoints, restart recovery, disk-full faults, spool reservations, durable events/start handshake, production authorization endpoints, retention or execution. No durability or restart guarantee is claimed by repeated-download checks. These are the next inactive implementation steps; do not install a service using this fixture.

## Durable preparation implementation (subsequent milestone)

`preparation.sql` adds isolated preparation tables and atomic submit/claim/renew/append/seal functions. `preparation.mjs` implements the checkpointed worker orchestration; `generator.cjs` pins the actual generator/dependency source digest and emits self-contained feeds using embedded assets. `worker.mjs --once --schema=v2_prepare_test_<timestamp>` performs preparation only. `--serve` is explicit and no service has been installed. `--revision` prints the required generator digest without opening the database.

`node scripts/office/v2/test-preparation.mjs` uses DATABASE_URL via existing local environment configuration and creates a NEW synthetic test schema. It never submits production jobs or migrates the public/v1 schema. Test schemas are retained for evidence and must be explicitly cleaned up later. Tests cover concurrent idempotency/claims, stale fencing, lost append/seal acknowledgements, atomic rollback on injected storage failure, checkpoint resume, quota/hash rejection and a fresh-process 5,000-record QR/100x100 logo run. `preparation-results.json` records the latest successful schema/checks. This is SQL fault injection, not a real disk-full or host power-cut test.

This milestone supersedes the earlier statement that preparation fencing/checkpoints are unimplemented. Remaining: authenticated snapshot submission API integration, global database/spool reservation policies, station download/start/events lifecycle, execution-state cross-version locking, UI integration, service installation/monitoring, production sizing/retention and Pi transport readiness. No production v2 migration, route, service or activation exists yet. Do not expose the low-level store directly to browsers; existing user/printer authorization must wrap it.
