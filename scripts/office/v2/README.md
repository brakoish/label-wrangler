# Inactive v2 preparation fixtures

Run from repository root: `node scripts/office/v2/test.cjs`.

These files have no API routes, service installation, database access, environment loading or printer transport. They do not change v1. `manifest.mjs` is an offline preparation/validation prototype, not an executable dispatch worker. It consumes complete trusted feed spans, uses bounded chunk assembly, calls an injected storage callback, then seals exact manifest bytes. The callback does NOT provide transactional durability by itself. Rejects may leave provisional chunks; a future durable worker must own their lifecycle and never publish an unsealed run.

The fixture uses the existing ZPL generator and server SVG conversion, synthetic unique QR strings, and a tiny synthetic logo. It validates 5,000 records at each of 1–4 across (20,000 logical records total), excluded lanes, hundreds of forced 4-KiB transport boundaries, hashes and repeat downloads. These 4-KiB boundaries are test parameters, not transport watermarks. `fixture-results.json` records measured fixture sizes; these are not representative production logo sizing or printer performance.

Descriptor ceiling measures 5,000 descriptors with 25 lane slots: deliberately conservative serialized shape, NOT a valid contiguous 5,000-record manifest. Maximum 2-MiB chunk response envelope is checked separately. The validator checks original lane positions in addition to ordered record coverage.

Not implemented/tested: immutable DB snapshots, Postgres preparation ownership/fencing/checkpoints, restart recovery, disk-full faults, spool reservations, durable events/start handshake, production authorization endpoints, retention or execution. No durability or restart guarantee is claimed by repeated-download checks. These are the next inactive implementation steps; do not install a service using this fixture.
