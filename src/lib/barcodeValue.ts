import type { BarcodeFormat } from './types';

/**
 * Whether a barcode type can hold a value at all, in plain words. Shared by
 * the barcode fit verdict (barcodeFit), the new-run check and scan mode.
 */

const CODE39 = /^[0-9A-Z \-.$/+%]*$/;

function checkDigitOk(digits: string): boolean {
  // GS1 mod-10 over everything but the last digit.
  const body = digits.slice(0, -1);
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    const n = Number(body[body.length - 1 - i]);
    sum += i % 2 === 0 ? n * 3 : n;
  }
  return (10 - (sum % 10)) % 10 === Number(digits[digits.length - 1]);
}

function unsupportedCharacters(value: string, allowed: (ch: string) => boolean): string[] {
  const bad: string[] = [];
  for (const ch of value) if (!allowed(ch) && !bad.includes(ch)) bad.push(ch);
  return bad;
}

function listCharacters(chars: string[]): string {
  const shown = chars.slice(0, 4).map((ch) => {
    if (ch === ' ') return 'space';
    if (ch === '\t') return 'a tab';
    if (/\s/u.test(ch)) return 'a special space (retype it as a plain space)';
    if (/[\p{Cc}\p{Cf}]/u.test(ch)) return 'a hidden character';
    return ch;
  });
  return shown.join(', ') + (chars.length > 4 ? ' and others' : '');
}

/**
 * Why a barcode can't print `value`, in plain words, or null when it can.
 * `noun` names the field ("the SKU").
 */
export function barcodeValueProblem(format: BarcodeFormat | undefined, value: string): string | null {
  if (!value) return null;
  switch (format ?? 'CODE128') {
    case 'CODE128': {
      const bad = unsupportedCharacters(value, (ch) => {
        const code = ch.codePointAt(0) ?? 0;
        return code >= 32 && code <= 126;
      });
      return bad.length ? `has characters a barcode can't hold (${listCharacters(bad)})` : null;
    }
    case 'CODE39': {
      if (CODE39.test(value)) return null;
      const bad = unsupportedCharacters(value, (ch) => CODE39.test(ch));
      return `has characters this barcode type can't hold (${listCharacters(bad)}). It takes capital letters, numbers, spaces and - . $ / + %`;
    }
    case 'UPC':
      return digitsProblem(value, [11, 12], 'UPC', 'UPC needs 11 or 12 digits');
    case 'EAN13':
      return digitsProblem(value, [12, 13], 'EAN-13', 'EAN-13 needs 12 or 13 digits');
    case 'EAN8':
      return digitsProblem(value, [7, 8], 'EAN-8', 'EAN-8 needs 7 or 8 digits');
    case 'ITF14':
      return /^\d+$/.test(value) ? null : `isn’t valid for ITF-14, which takes numbers only; this value has ${whatElse(value)}`;
    default:
      return null;
  }
}

/** "letters and a space", "letters, a space and other characters": what a numbers-only value has besides digits. */
function whatElse(value: string): string {
  const parts: string[] = [];
  if (/\p{L}/u.test(value)) parts.push('letters');
  const spaces = (value.match(/ /g) ?? []).length;
  if (spaces) parts.push(spaces === 1 ? 'a space' : 'spaces');
  if (/[^\p{L}\d ]/u.test(value)) parts.push(parts.length ? 'other characters' : 'characters other than numbers');
  if (parts.length <= 1) return parts[0] ?? 'characters other than numbers';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** Problems with a numbers-only barcode value, described from the value itself. */
function digitsProblem(value: string, lengths: [number, number], name: string, rule: string): string | null {
  if (!/^\d+$/.test(value)) return `isn’t a valid ${name}: ${rule}; this value has ${whatElse(value)}`;
  if (!lengths.includes(value.length)) return `isn’t a valid ${name}: ${rule}; this value has ${value.length} digit${value.length === 1 ? '' : 's'}`;
  if (value.length === lengths[1] && !checkDigitOk(value)) return `isn’t a valid ${name}: its last digit (the check digit) doesn’t match the others. Check the number`;
  return null;
}
