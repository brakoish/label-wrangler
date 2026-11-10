# Office Pi printing (protocol 1)

## Operating model

The website authenticates office users, builds ZPL from saved runs, and stores immutable batches in Neon Postgres. The Pi polls the website over HTTPS and sends each batch through local CUPS. No website request contacts a private IP, CUPS port, p910nd, or SSH. Existing AirPrint/IPP office printing is untouched. Dazzle, WebUSB and PDF export remain available.

Office Pi is selected on a **run's Printer panel**. Designer's **Office Pi run** link starts a run from a saved template. Save edits first. Unsaved designer/test-data changes are not sent remotely. Scan-and-print remains a local transport workflow in v1.

Only `office-zebra-pi` / `black-zebra` is configured. The printer is `Black Zebra - ZD411 (Pi)`, serial `DFJ244801186`, 203 DPI, maximum 448-dot print width. There is no white-printer alias or fallback.

## Authentication and authorization

This installation has one shared office library. Individual enabled office accounts may read that library. Editing and printing are separate explicit account permissions; printing also requires a station/printer ACL entry. Recording a run's print progress and print history needs either permission; creating, renaming, re-sourcing or deleting runs and changing templates, formats, presets or saved blocks needs edit. Every existing library API is protected, including mutations, so anonymous callers cannot alter the templates or run data used by the trusted print generator. Page proxy redirects are only optimistic; actual session validation occurs in API handlers.

Passwords use salted scrypt verifiers. Random sessions are hashed in the database and expire after 12 hours, or after 30 days when "Stay signed in" is chosen. Cookies are Secure (in production), HttpOnly and SameSite=Lax so top-level links from other sites open the app; every mutating browser request still requires an exact Origin match to `OFFICE_APP_ORIGIN` (defaults to the production alias). Login attempts are throttled durably per username (not per IP): after 10 failed attempts the account refuses sign-in until 15 minutes after the first failure, and the message says how long is left. A successful sign-in clears the count. Devices that are already signed in keep working during a lockout. There is no public account registration.

Station credentials are independent, high-entropy bearer tokens. Only their SHA-256 verifiers are stored in the database. Poll/events require both the token and matching station ID; events additionally require job ownership. Station credentials are never returned by browser APIs.

## Queue guarantees and limits

- Creation accepts a saved run ID, printer, physical label range and UUID idempotency key—not raw ZPL, images, URLs, counts, or template bodies.
- A single query snapshots the stored run/template/format. The server checks format/DPI/liner width, element geometry and text, and generates ZPL with the existing generator. Command control characters in field content are rejected.
- Office-only output sets `^PON`, `^LH0,0`, `^LT0`, `^LS0`, `^PQ1`, `^PW`, and `^LL`. No speed/darkness overrides are invented. The existing local generator/output is unchanged.
- Batches contain at most 25 selected labels and 2,097,152 decoded bytes. SHA-256 hashes the exact UTF-8 bytes stored for dispatch. Requests are limited to 10,000 labels and 32 MiB of unencoded printer data; larger requests must use smaller ranges. Range validation fails explicitly, never truncates.
- Multi-across batches preserve lane positions and whole-feed boundaries. Unselected edge lanes stay blank. Counts include only selected labels.
- Browser retries persist an idempotency key; the durable authority is `office_requests` and its unique requester/key constraint. Concurrent retries return the original request. Changed parameters under the same key fail. Overlapping prior work requires an explicit reprint reference/reason (except unclaimed cancelled work).
- All claim/event/cancel/review operations serialize on the station row inside PostgreSQL functions. Only one claimed/submitted job per station is dispatched. A lost poll response causes the same claimed job UUID/payload to be returned. `accept_job:false` always returns no job.
- Submitted or uncertain work is never lease-requeued. Claimed work unresolved for 5 minutes or submitted work unresolved for 30 minutes latches a review flag. Dispatch remains blocked even if a late event reports success. Duplicate event IDs acknowledge idempotently; conflicts are retained for review.
- Offline is indicated after 30 seconds without authenticated contact. Existing queued jobs survive browser closure and outages; reconnect preserves their order and identities.

PNG/JPEG/WebP and flattened SVG logos are rasterized server-side using Sharp (already used by Next). External image URLs, SVG external references/entities/embedded HTML are rejected. Upload a flattened SVG or PNG if a logo is rejected. Rasterization is covered by software tests; physical appearance still requires a printer check.

## Status and history

- **Waiting for office**: durable but unclaimed; can be cancelled.
- **Assigned to office**: claimed; the server cannot remotely cancel it.
- **Queued at office**: CUPS accepted submission, not a physical print confirmation.
- **Sent to printer**: CUPS backend reported delivery, still not proof that every label printed.
- **Waiting for office (held)**: the station is online but the control gate is holding dispatch (a pause/resume command is pending, the printer is paused, or the Pi's printer-status reports are stale). `/api/office/stations` returns a read-only `dispatch_hold_reason` (`control_pending`, `printer_paused`, `control_stale` or null) and the run's Office Pi panel explains it in one sentence. Nothing the Pi receives changes.
- **Check printer before retrying**: dispatch blocked. Verify the printer and resolve/cancel pending work locally in CUPS, then record the operator's resolution in the website.

A sent event adds one run-history entry; it is still not a physical-printed confirmation. Nothing changes `printedCount` automatically: not the server, not the Pi and not the browser. The run page and the runs list show office work next to printed progress as **Sent to office printer: X of N** (plus anything still on its way), using a read-only summary of the office tables (`GET /api/office/jobs?runId=` on the run page; an additive `office` field on `GET /api/runs` for the list, scoped to printers the account can use). When the office reports an unbroken stretch as sent right after the current `printedCount`, the run page offers **Mark labels A–B as printed**; after the person confirms, it records that through the ordinary run update (`PUT /api/runs/:id`, a high-water mark) and a `confirmed` print event. A part the office rejected (for example media out) shows as "Labels 51–100 didn't print: the printer is out of labels". Printing it again first records the check (`POST /api/office/review`, which resolves that part), then sends an intentional reprint of the range after the person checks the labels. A range that overlaps finished office work is sent as a reprint; one that overlaps work still on its way, or a part that needs a check, waits, so the browser never offers a send the server refuses. Suggested ranges are capped to a size the server accepts (at most 10,000 labels and well under 32 MiB, estimated from a few sample labels; 500 at a time for bitmap designs), and each send then offers the next chunk. One tap never sends more than one request.

A page that finds a saved send it didn't make itself (after a reload, or in a second tab) asks `GET /api/office/jobs?runId=&key=` first: an additive, read-only lookup that answers `{keyRequestId}` for the signed-in account's own request with that idempotency key, or null. It shows "Checking whether the office got labels A–B…" meanwhile, and "not sure" only once the lookup can't confirm the send and no tab is sending it (tabs mark a send on its way under the separate key `lw:office-sending:<run>`; the saved request itself is unchanged). The runs list also returns an additive `countedSpans` per run (confirmed office ranges and scanned labels after the latest go-back), so the list and the run page count printed labels the same way.

When the office API refuses a send before queuing anything (400, 404, 409, 413, for example "awaiting verified pairing" or "Check printer before retrying"), the browser clears its saved request instead of offering a resend, shows the reason in plain words, and remembers the refusal across a refresh for a short time; live status (pairing finished, check done) always wins over that memory. Any other outcome keeps the saved request and its idempotency key for **Send again**: no answer, timeout, 5xx, and also 401 (signed out), 403 (no access, or opened at the wrong address) and 429 (busy), because those can follow an earlier try that did arrive. Pause/Resume clears its saved request on a 4xx from the controls route (all of which happen before a control is created) and keeps it otherwise.

Cancellation affects only unclaimed batches. Reviewing a job does not itself resend it. An intentional reprint uses new UUIDs linked to the original request and a reason; pending original work must first be resolved. No exactly-once physical-printing claim is made.

## Provisioning and activation

From the app checkout, with the deployment's DATABASE_URL available:

```sh
node scripts/office/admin.mjs migrate
node scripts/office/admin.mjs provision-station
node scripts/office/admin.mjs create-user chilly --admin
```

The migration is additive and transactional; its SQL functions are versioned in `scripts/office/schema.sql`, and table definitions are also tracked in Drizzle's schema. Do not replace this migration with `db:push`: the transactional functions must be installed too.

Provisioning writes credentials only to mode-0600 files in the parent workspace's mode-0700 `private/office-printing/` directory. The CLI reports paths, never values. Keep these files outside the repository, chat, screenshots, and deployment bundle. Transfer the station token through a trusted private channel to the setup agent's root-only Pi file. Initial user credentials likewise require private delivery.

The station starts with dispatch disabled. Website job creation stays blocked until pairing is verified. The Pi setup agent must install the station credential, enable its config/service, and verify a direct authenticated empty poll at:

`https://label-wrangler.vercel.app/api/print-stations/v1/poll`

Then, only after that agent confirms actual pairing and the black printer advertisement, run:

```sh
node scripts/office/admin.mjs activate --pairing-verified
```

Activation requires a healthy authenticated black-printer advertisement within 30 seconds. It creates no print jobs. Coordinate ONE clearly marked physical label through the website after activation.

Other trusted operator commands:

```sh
node scripts/office/admin.mjs status
node scripts/office/admin.mjs disable
node scripts/office/admin.mjs revoke-station
node scripts/office/admin.mjs rotate-station
node scripts/office/admin.mjs create-user another-user
node scripts/office/admin.mjs disable-user another-user
```

Disabling/revoking stops future dispatch but does not cancel already assigned CUPS work. Rotation disables dispatch and requires pairing again; it preserves outstanding job IDs.

## Verification

```sh
node scripts/office/test.cjs
node scripts/office/verify-http.mjs http://127.0.0.1:3120
node scripts/office/verify-ui.mjs http://127.0.0.1:3120
npm run lint
npm run build
```

The database suite uses isolated `office_verify_*` schemas and synthetic fixtures, not production jobs or printer calls. HTTP/UI checks require initial credential files and dispatch disabled. The HTTP poll identifies itself as `website-contract-check-not-pi` with no printers; it verifies the API contract, **not physical station pairing**. Do not treat that contact as activation evidence. The UI check uses an isolated headless Chrome profile, inspects controls without printing, and logs no credentials. Test sessions and temporary authorization fixtures are cleaned up.

## Physical pause / resume

Office Pi now includes physical **Pause printer / Resume printer** controls. They affect all work on the configured black Zebra after its current label, not just the website queue. No cancel-buffer command is exposed. Hardware control delivery is polled, not instantaneous.

The additive `controls.sql` migration is included by `admin.mjs migrate`. `office_users.can_control` is an explicit, default-false permission in addition to printer ACL. The Manifest operator has this grant. Control requests themselves are immutable audit records with requester, action, timestamps, and durable result, separate from print events. Browser creation uses persistent idempotency keys; station control poll/events use the station credential and fixed printer binding.

Only fresh control polls determine physical status. Null means unknown; stale is shown separately. Pending controls or paused/unknown/stale observations hold label dispatch; control polling continues independently. Resume requires a fresh unpaused observation after result receipt and retains existing print-review gates. Expired unclaimed controls terminate without dispatch; claimed controls keep their IDs for worker journal recovery. No desired-state enforcement or automatic replacement control exists. Duplicate result events never overwrite newer observations.

## Optional end-of-run blank

On the run’s Office Pi panel, **Blank label after this run** defaults off. When checked, one empty ZPL feed follows the entire selected range (including saved copies), inside the final immutable v1 job. Multi-across stock feeds a blank row, not a single lane. It is not a source record and does not change product counts, snapshots, bitmap proof digests or progress. This option is not offered for local printing, PDF, designer preview or inactive v2 preparation.

The option is captured in the pending browser request and its server idempotency fingerprint; retry/reload preserves the original payload and identity. Old pending requests remain compatible. Cancellation of an unclaimed final batch removes its blank too; claimed/submitted work cannot be recalled and uncertain delivery still requires review. Intentional reprints use the current opt-in choice. A full final payload that cannot accommodate the blank is rejected before enqueue rather than creating a separate blank job. No station protocol/schema change is needed; label_count remains selected product labels, as with existing multi-across payloads. Physical blank-feed behavior has not been printer-tested.
