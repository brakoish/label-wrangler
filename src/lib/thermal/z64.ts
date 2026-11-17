import { deflateSync, inflateSync } from 'node:zlib';

/**
 * Z64 graphic compression for the Office (server → Pi → ZD411) path only.
 *
 * `^GFA,total,total,rowBytes,<HEX>` becomes
 * `^GFA,total,total,rowBytes,:Z64:<base64(zlib deflate(bytes))>:<CRC16>`.
 * The CRC is CRC-16/XMODEM over the base64 text's ASCII bytes, as four
 * uppercase hex digits. Local/browser printing must keep plain hex: older
 * printers (ZP 450) may not understand Z64.
 *
 * Server-only: uses node:zlib.
 */

// Only plain, uncompressed ASCII hex fields that end at a command or the end
// of the document. ZPL run-length characters (G–Z, g–z, ',', '!', ':') and
// already-compressed :Z64:/:B64: data never match, so they are left alone.
const HEX_FIELD = /\^GFA,(\d+),(\d+),(\d+),([0-9A-Fa-f]+)(?=\^|\s|$)/g;
const Z64_FIELD = /\^GFA,(\d+),(\d+),(\d+),:Z64:([A-Za-z0-9+/=]+):([0-9A-Fa-f]{4})/g;

/** CRC-16/XMODEM: poly 0x1021, init 0x0000, no reflection, no final xor. */
export function crc16Xmodem(data: Uint8Array | string): number {
  const bytes = typeof data === 'string' ? Buffer.from(data, 'latin1') : data;
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}

export function z64Encode(bytes: Uint8Array): string {
  const base64 = deflateSync(bytes).toString('base64');
  return `:Z64:${base64}:${crc16Xmodem(base64).toString(16).toUpperCase().padStart(4, '0')}`;
}

export function compressGraphicFields(zpl: string): string {
  return zpl.replace(HEX_FIELD, (field, total: string, _binary: string, rowBytes: string, hex: string) => {
    const length = Number(total);
    // A mismatched count is not ours to reinterpret; send it exactly as built.
    if (!Number.isSafeInteger(length) || length < 1 || hex.length !== length * 2) return field;
    return `^GFA,${length},${length},${rowBytes},${z64Encode(Buffer.from(hex, 'hex'))}`;
  });
}

/** Inverse of compressGraphicFields (tests and diagnostics). Verifies the CRC and byte count. */
export function expandGraphicFields(zpl: string): string {
  return zpl.replace(Z64_FIELD, (_field, total: string, binary: string, rowBytes: string, base64: string, crc: string) => {
    if (crc16Xmodem(base64) !== parseInt(crc, 16)) throw new Error('Z64 CRC mismatch');
    const bytes = inflateSync(Buffer.from(base64, 'base64'));
    if (bytes.length !== Number(total)) throw new Error('Z64 byte count mismatch');
    return `^GFA,${total},${binary},${rowBytes},${bytes.toString('hex').toUpperCase()}`;
  });
}
