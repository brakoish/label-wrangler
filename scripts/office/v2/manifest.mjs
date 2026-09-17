// Inactive preparation fixture. No database, endpoint, printer or service imports.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
export const limits = Object.freeze({ labels: 5000, chunk: 2097152, payload: 268435456, manifest: 4194304, response: 6291456, chunkResponse: 3145728 });
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const keys = (value, expected) => assert.deepEqual(Object.keys(value).sort(), expected.split(' ').sort());
const integer = (value, low, high) => assert.ok(Number.isSafeInteger(value) && value >= low && value <= high);
const uuid = value => assert.match(value, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const sha = value => assert.match(value, /^[0-9a-f]{64}$/);

// Producer supplies trusted, complete, independently dispatchable feeds; never split by scanning ZPL.
// onChunk must durably persist bytes in a future worker; this module does not claim durability.
export async function prepare(metadata, feeds, onChunk, chunkLimit = limits.chunk) {
  integer(chunkLimit, 1, limits.chunk);
  const manifest = { protocol: 2, ...metadata, label_count: metadata.range_to - metadata.range_from + 1, feed_count: 0, total_bytes: 0, chunks: [] };
  integer(manifest.label_count, 1, limits.labels);
  let parts = [], descriptors = [], size = 0, labels = 0;
  async function flush() {
    if (!parts.length) return;
    const bytes = Buffer.concat(parts);
    const chunk = { chunk_id: randomUUID(), ordinal: manifest.chunks.length, label_count: labels, feed_count: descriptors.length, byte_count: size, sha256: hash(bytes), feeds: descriptors };
    await onChunk(chunk, bytes);
    manifest.chunks.push(chunk);
    parts = []; descriptors = []; size = 0; labels = 0;
  }
  for await (const feed of feeds) {
    assert.ok(Buffer.isBuffer(feed.bytes));
    integer(feed.bytes.length, 1, chunkLimit);
    if (size + feed.bytes.length > chunkLimit) await flush();
    assert.ok(manifest.total_bytes + feed.bytes.length <= limits.payload, 'payload quota');
    assert.ok(manifest.feed_count < limits.labels, 'feed quota');
    descriptors.push({ feed_ordinal: manifest.feed_count++, byte_offset: size, byte_count: feed.bytes.length, lanes: [...feed.lanes] });
    parts.push(Buffer.from(feed.bytes)); size += feed.bytes.length;
    labels += feed.lanes.filter(lane => lane !== null).length;
    manifest.total_bytes += feed.bytes.length;
  }
  await flush();
  validate(manifest);
  const bytes = Buffer.from(JSON.stringify(manifest));
  assert.ok(bytes.length <= limits.manifest, 'manifest quota');
  const response = Buffer.from(JSON.stringify({ protocol: 2, manifest_bytes: bytes.length, manifest_sha256: hash(bytes), manifest_base64: bytes.toString('base64') }));
  assert.ok(response.length <= limits.response, 'response quota');
  return { manifest, bytes, response, sha256: hash(bytes) };
}

export function validate(m) {
  keys(m, 'protocol print_run_id snapshot_sha256 station_id printer_id range_from range_to label_count labels_across feed_count total_bytes chunks');
  assert.equal(m.protocol, 2); uuid(m.print_run_id); sha(m.snapshot_sha256);
  for (const id of [m.station_id, m.printer_id]) assert.ok(typeof id === 'string' && id.length > 0);
  integer(m.range_from, 1, Number.MAX_SAFE_INTEGER); integer(m.range_to, m.range_from, Number.MAX_SAFE_INTEGER);
  integer(m.label_count, 1, limits.labels); assert.equal(m.label_count, m.range_to - m.range_from + 1);
  integer(m.labels_across, 1, 25); integer(m.feed_count, 1, 5000); integer(m.total_bytes, 1, limits.payload);
  assert.ok(Array.isArray(m.chunks)); integer(m.chunks.length, 1, 5000);
  let ordinal = 0, next = m.range_from, total = 0;
  const ids = new Set();
  for (const [index, c] of m.chunks.entries()) {
    keys(c, 'chunk_id ordinal label_count feed_count byte_count sha256 feeds');
    uuid(c.chunk_id); assert.ok(!ids.has(c.chunk_id)); ids.add(c.chunk_id); sha(c.sha256);
    assert.equal(c.ordinal, index); integer(c.byte_count, 1, limits.chunk);
    assert.ok(Array.isArray(c.feeds)); integer(c.feeds.length, 1, 5000); assert.equal(c.feed_count, c.feeds.length);
    let offset = 0, count = 0;
    for (const f of c.feeds) {
      keys(f, 'feed_ordinal byte_offset byte_count lanes');
      assert.equal(f.feed_ordinal, ordinal++); assert.equal(f.byte_offset, offset);
      integer(f.byte_count, 1, c.byte_count); offset += f.byte_count;
      assert.ok(Array.isArray(f.lanes)); assert.equal(f.lanes.length, m.labels_across);
      const physicalStart = Math.floor((m.range_from - 1) / m.labels_across) * m.labels_across + f.feed_ordinal * m.labels_across + 1;
      for (const [lane, record] of f.lanes.entries()) {
        const original = physicalStart + lane;
        const expected = original >= m.range_from && original <= m.range_to ? original : null;
        assert.equal(record, expected, 'original lane position');
        if (record !== null) { assert.equal(record, next++); count++; }
      }
    }
    assert.equal(offset, c.byte_count); assert.equal(count, c.label_count); total += offset;
  }
  assert.equal(ordinal, m.feed_count); assert.equal(next, m.range_to + 1); assert.equal(total, m.total_bytes);
}

export function verifyChunk(c, bytes) {
  assert.ok(Buffer.isBuffer(bytes)); assert.equal(bytes.length, c.byte_count); assert.equal(hash(bytes), c.sha256);
  const response = Buffer.from(JSON.stringify({ protocol: 2, chunk_id: c.chunk_id, byte_count: bytes.length, sha256: c.sha256, payload_base64: bytes.toString('base64') }));
  assert.ok(response.length < limits.chunkResponse);
  return response;
}

export function decodeManifest(responseBytes) {
  assert.ok(responseBytes.length <= limits.response, 'response quota');
  const r = JSON.parse(responseBytes.toString('utf8'));
  keys(r, 'protocol manifest_bytes manifest_sha256 manifest_base64');
  assert.equal(r.protocol, 2); integer(r.manifest_bytes, 1, limits.manifest); sha(r.manifest_sha256);
  assert.equal(typeof r.manifest_base64, 'string');
  const bytes = Buffer.from(r.manifest_base64, 'base64');
  assert.equal(bytes.toString('base64'), r.manifest_base64, 'canonical base64');
  assert.equal(bytes.length, r.manifest_bytes); assert.equal(hash(bytes), r.manifest_sha256);
  assert.ok(Buffer.from(bytes.toString('utf8')).equals(bytes), 'valid UTF-8');
  const manifest = JSON.parse(bytes.toString('utf8')); validate(manifest);
  return { manifest, bytes };
}
