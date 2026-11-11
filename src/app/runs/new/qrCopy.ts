/**
 * "Use a QR code instead" makes a copy of the design with the barcode
 * swapped for a QR code, for one run. A copy made earlier is reused only
 * when it can be proved to be that same copy of the design as it is now:
 * this device saved a record when it made the copy (the copy's id, a
 * fingerprint of what it was made from and of what was saved), the design
 * with its barcode swapped still gives the same fingerprint, and the copy
 * still holds exactly what was saved. A name never picks a design: a stale
 * copy, a copy edited by hand, or another design that happens to share the
 * name gets a fresh copy instead.
 */

export interface QrCopyRecord {
  /** The copy's template id. */
  copyId: string;
  /** Fingerprint of the design with the barcode swapped, when the copy was made. */
  made: string;
  /** Fingerprint of the copy as it was saved. */
  saved: string;
}

interface DesignLike {
  formatId: string;
  thermalRenderMode?: string | null;
  elements: ReadonlyArray<unknown>;
}

export const qrCopyKey = (sourceId: string) => `lw:qr-copy:${sourceId}`;

/** The same text for the same data, whatever order its keys come back in (the database reorders them). */
export function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((item) => (item === undefined ? 'null' : stableJson(item))).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`;
}

/** 53-bit string hash (cyrb53), as 14 hex digits. */
function hash53(text: string, seed: number): string {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

/** What a design prints, as a short fingerprint: label size, renderer and every item. */
export function designFingerprint(design: DesignLike): string {
  const text = stableJson({ formatId: design.formatId, mode: design.thermalRenderMode ?? 'native-v1', elements: design.elements });
  return `${text.length.toString(36)}-${hash53(text, 1)}${hash53(text, 7)}`;
}

export function readQrCopy(storage: Storage | null, sourceId: string): QrCopyRecord | null {
  try {
    const data = JSON.parse(storage?.getItem(qrCopyKey(sourceId)) || 'null') as Partial<QrCopyRecord> | null;
    return data && typeof data.copyId === 'string' && typeof data.made === 'string' && typeof data.saved === 'string'
      ? { copyId: data.copyId, made: data.made, saved: data.saved }
      : null;
  } catch { return null; }
}

export function saveQrCopy(storage: Storage | null, sourceId: string, record: QrCopyRecord): void {
  try { storage?.setItem(qrCopyKey(sourceId), JSON.stringify(record)); } catch { /* storage off: the next press makes a fresh copy */ }
}

/**
 * True only when `copy` is the copy this device made from the design as it
 * is now (`wanted`: the design with its barcode swapped), unchanged since.
 */
export function qrCopyStillMatches(record: QrCopyRecord | null, copy: (DesignLike & { id: string; archivedAt?: string | null }) | null, wanted: DesignLike): boolean {
  if (!record || !copy || copy.id !== record.copyId || copy.archivedAt) return false;
  if ((copy.thermalRenderMode ?? 'native-v1') !== (wanted.thermalRenderMode ?? 'native-v1') || copy.formatId !== wanted.formatId) return false;
  return record.made === designFingerprint(wanted) && record.saved === designFingerprint(copy);
}

/** "Flower 1g (QR code)", or "(QR code 2)" and on when that name is taken, so two copies never share a name. */
export function freshQrCopyName(designName: string, takenNames: ReadonlyArray<string>): string {
  const taken = new Set(takenNames);
  const first = `${designName} (QR code)`;
  if (!taken.has(first)) return first;
  for (let n = 2; ; n++) if (!taken.has(`${designName} (QR code ${n})`)) return `${designName} (QR code ${n})`;
}
