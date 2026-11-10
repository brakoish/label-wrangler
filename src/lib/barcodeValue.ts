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
  const shown = Array.from(new Set(chars.map((ch) => {
    if (ch === ' ') return 'space';
    if (ch === '\t') return 'a tab';
    if (ch === '\r' || ch === '\n') return 'a line break';
    if (/\s/u.test(ch)) return 'a special space (retype it as a plain space)';
    if (/[\p{Cc}\p{Cf}]/u.test(ch)) return 'a hidden character';
    return ch;
  })));
  return shown.slice(0, 4).join(', ') + (shown.length > 4 ? ' and others' : '');
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

/**
 * What the exact (bitmap) renderer refuses besides JsBarcode's own refusal
 * (thermal/render.server, read-only mirror): control characters other than
 * a tab or a line break, or an oversized value; and, when the number is
 * printed under the bars, a character the bundled font has no glyph for
 * (of what JsBarcode encodes, only DEL).
 */
const EXACT_RENDER_REFUSED = /[\x00-\x08\x0b\x0c\x0e-\x1f]/;

export function exactRendererRefusesValue(value: string, showText = false): boolean {
  return value.length > 8192 || EXACT_RENDER_REFUSED.test(value) || (showText && value.includes('\x7f'));
}

/** The go-ahead sentence for lowercase letters in a Code 39 value the exact renderer draws. */
export const UPPERCASE_NOTE = 'Lowercase letters will scan as UPPERCASE';
/** The go-ahead sentence when what is drawn differs from the value in more than one way. */
export const NOT_AS_WRITTEN_NOTE = 'The barcode won’t scan exactly as written';

/**
 * For a value barcodeValueProblem flags but the exact renderer still draws
 * (JsBarcode encodes it; the caller checks that first): what the printed
 * barcode really holds, in plain words. `problem` follows the value's name
 * ("has lowercase letters (a, t), which this barcode type doesn’t have.
 * They will scan as UPPERCASE"); `note` is one sentence for the go-ahead.
 * Null when there is nothing to say (the value is fine as written).
 */
export function drawnValueNote(format: BarcodeFormat | undefined, value: string): { problem: string; note: string } | null {
  if (!value || !barcodeValueProblem(format, value)) return null;
  if ((format ?? 'CODE128') === 'CODE39') {
    const lower = unsupportedCharacters(value, (ch) => !/[a-z]/.test(ch));
    if (!lower.length) return null;
    return { problem: `has lowercase letters (${listCharacters(lower)}), which this barcode type doesn’t have. ${UPPERCASE_NOTE}`, note: UPPERCASE_NOTE };
  }
  if ((format ?? 'CODE128') !== 'CODE128') return null;
  const has: string[] = [];
  const sentences: string[] = [];
  if (value.includes('\t')) { has.push('a tab'); sentences.push('The tab will scan as a Tab key press'); }
  if (/[\r\n]/.test(value)) { has.push('a line break'); sentences.push('The line break will scan as an Enter key press'); }
  if (value.includes('\x7f')) { has.push('a hidden character (DEL)'); sentences.push('The hidden character is printed in the barcode, so the scan won’t match the text you see'); }
  const special = unsupportedCharacters(value, (ch) => !/[\xC8-\xD3]/.test(ch));
  if (special.length) {
    has.push(listCharacters(special));
    sentences.push(`${special.length === 1 ? 'It is' : 'They are'} printed as ${special.length === 1 ? 'a special scanner code' : 'special scanner codes'}, not as ${special.length === 1 ? 'a letter' : 'letters'}`);
  }
  if (!has.length) return null;
  const list = has.length === 1 ? has[0] : `${has.slice(0, -1).join(', ')} and ${has[has.length - 1]}`;
  return { problem: `has ${list} in it. ${sentences.join('. ')}`, note: sentences.length === 1 ? sentences[0] : NOT_AS_WRITTEN_NOTE };
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
