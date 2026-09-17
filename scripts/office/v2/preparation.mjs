import { hash, validate, limits } from './manifest.mjs';
import { randomUUID } from 'node:crypto';

// q is an injected parameterized SQL executor. It must return committed results.
export function preparationStore(q) {
  return {
    async submit({ requester, key, snapshot, revision, station, printer, from, to, across }) {
      const bytes = Buffer.from(JSON.stringify(snapshot));
      const rows = await q('SELECT office_v2_prepare_submit($1,$2,$3,decode($4,\'hex\'),$5,$6,$7,$8,$9,$10) AS id', [randomUUID(), requester, key, bytes.toString('hex'), revision, station, printer, from, to, across]);
      return rows[0].id;
    },
    async claim(revision) {
      const rows = await q("SELECT id,fence,station_id,printer_id,range_from,range_to,labels_across,snapshot_sha256,generator_revision,encode(snapshot,'hex') AS snapshot_hex FROM office_v2_prepare_claim($1)", [revision]);
      if (!rows.length) return null;
      const task = rows[0];
      const bytes = Buffer.from(task.snapshot_hex, 'hex');
      if (hash(bytes) !== task.snapshot_sha256) throw new Error('snapshot_integrity');
      return { ...task, snapshot: JSON.parse(bytes.toString('utf8')) };
    },
    async renew(task) {
      const rows = await q('SELECT office_v2_prepare_renew($1,$2) AS renewed', [task.id, task.fence]);
      if (!rows[0].renewed) throw new Error('stale_preparation_owner');
    },
    async chunks(task) {
      // Metadata only; payloads remain in Postgres, not accumulated in worker RAM.
      return (await q('SELECT descriptor FROM office_v2_prepared_chunks WHERE run_id=$1 ORDER BY ordinal', [task.id])).map(row => row.descriptor);
    },
    async append(task, descriptor, bytes) {
      await q("SELECT office_v2_prepare_append($1,$2,$3::jsonb,decode($4,'hex'))", [task.id, task.fence, JSON.stringify(descriptor), bytes.toString('hex')]);
    },
    async seal(task, bytes) {
      await q("SELECT office_v2_prepare_seal($1,$2,decode($3,'hex'))", [task.id, task.fence, bytes.toString('hex')]);
    },
    async fail(task, code) {
      if (!['invalid_snapshot','payload_quota','feed_quota','render_failed'].includes(code)) throw new Error('invalid_failure_code');
      await q("UPDATE office_v2_preparations SET state='failed',failure_code=$3,lease_until=NULL WHERE id=$1 AND fence=$2 AND state='preparing' AND lease_until>clock_timestamp()", [task.id, task.fence, code]);
    }
  };
}

// Resumes only PREPARATION: committed chunks are never rendered again or replaced.
// feedSource(snapshot, nextFeed) must yield pinned, independently dispatchable feeds.
export async function prepareTask(store, task, feedSource) {
  const chunks = await store.chunks(task);
  let feedOrdinal = chunks.reduce((n,c) => n+c.feed_count, 0);
  let total = chunks.reduce((n,c) => n+c.byte_count, 0);
  let parts = [], feeds = [], size = 0, count = 0;
  async function flush() {
    if (!size) return;
    const bytes = Buffer.concat(parts);
    const descriptor = { chunk_id: randomUUID(), ordinal: chunks.length, label_count: count, feed_count: feeds.length, byte_count: bytes.length, sha256: hash(bytes), feeds };
    // Do not retry a failed call with new identity: let the lease expire and reload checkpoint.
    await store.append(task, descriptor, bytes);
    chunks.push(descriptor); parts = []; feeds = []; size = 0; count = 0;
  }
  await store.renew(task);
  for await (const feed of feedSource(task.snapshot, feedOrdinal)) {
    if (!Buffer.isBuffer(feed.bytes) || feed.bytes.length < 1 || feed.bytes.length > limits.chunk) throw new Error('feed_quota');
    if (size + feed.bytes.length > limits.chunk) await flush();
    if (total + feed.bytes.length > limits.payload || feedOrdinal >= 5000) throw new Error('payload_quota');
    if (feedOrdinal % 100 === 0) await store.renew(task);
    feeds.push({ feed_ordinal: feedOrdinal++, byte_offset: size, byte_count: feed.bytes.length, lanes: [...feed.lanes] });
    parts.push(feed.bytes); size += feed.bytes.length; total += feed.bytes.length;
    count += feed.lanes.filter(n => n !== null).length;
  }
  await flush();
  const manifest = { protocol: 2, print_run_id: task.id, snapshot_sha256: task.snapshot_sha256, station_id: task.station_id, printer_id: task.printer_id, range_from: task.range_from, range_to: task.range_to, label_count: task.range_to-task.range_from+1, labels_across: task.labels_across, feed_count: feedOrdinal, total_bytes: total, chunks };
  validate(manifest);
  const bytes = Buffer.from(JSON.stringify(manifest));
  if (bytes.length > limits.manifest) throw new Error('manifest_quota');
  await store.seal(task, bytes);
  return { bytes, sha256: hash(bytes) };
}
