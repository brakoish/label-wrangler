/**
 * Show an Excel number the way Excel shows it, from the cell's number format:
 * dates as dates (11/1/2026), prices with their symbol and decimals ($20.00),
 * percentages with "%". Covers the built-in formats and the common custom
 * ones; anything it can't read falls back to the plain number.
 */

// Built-in format ids (ECMA-376 18.8.30), as Excel shows them in US English.
const BUILT_IN: Record<number, string> = {
  0: 'General', 1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00',
  5: '"$"#,##0_);("$"#,##0)', 6: '"$"#,##0_);[Red]("$"#,##0)', 7: '"$"#,##0.00_);("$"#,##0.00)', 8: '"$"#,##0.00_);[Red]("$"#,##0.00)',
  9: '0%', 10: '0.00%', 11: '0.00E+00', 12: '# ?/?', 13: '# ??/??',
  14: 'm/d/yyyy', 15: 'd-mmm-yy', 16: 'd-mmm', 17: 'mmm-yy', 18: 'h:mm AM/PM', 19: 'h:mm:ss AM/PM',
  20: 'h:mm', 21: 'h:mm:ss', 22: 'm/d/yyyy h:mm',
  37: '#,##0_);(#,##0)', 38: '#,##0_);[Red](#,##0)', 39: '#,##0.00_);(#,##0.00)', 40: '#,##0.00_);[Red](#,##0.00)',
  44: '_("$"* #,##0.00_);_("$"* (#,##0.00);_("$"* "-"??_);_(@_)',
  45: 'mm:ss', 46: '[h]:mm:ss', 47: 'mm:ss.0', 48: '##0.0E+0', 49: '@',
};

export function builtInFormat(id: number): string | undefined {
  return BUILT_IN[id];
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function plainNumber(n: number): string {
  // Avoid float noise such as 27.410000000000004.
  return String(Math.round(n * 1e9) / 1e9);
}

/** Split on ";" outside quotes and brackets. */
function sections(code: string): string[] {
  const out: string[] = [];
  let current = '';
  let quoted = false;
  let bracket = false;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (ch === '\\' && !quoted) { current += ch + (code[i + 1] ?? ''); i++; continue; }
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch === '[') bracket = true;
    else if (!quoted && ch === ']') bracket = false;
    if (ch === ';' && !quoted && !bracket) { out.push(current); current = ''; continue; }
    current += ch;
  }
  out.push(current);
  return out;
}

/** The format with colours, conditions and locale tags removed; [$€-407] → €. */
function cleaned(section: string): string {
  return section.replace(/\[\$([^\]-]*)(?:-[^\]]*)?\]/g, (_m, symbol: string) => (symbol ? `"${symbol}"` : ''))
    .replace(/\[(?:[a-z]+\d*|[<>=]+[\d.]+)\]/gi, '');
}

/** The format's characters outside quoted literals, for spotting date codes. */
function unquoted(section: string): string {
  return section.replace(/"[^"]*"/g, '').replace(/\\./g, '').replace(/_.|\*./g, '');
}

function isDateFormat(section: string): boolean {
  return /[ymdhs]/i.test(unquoted(cleaned(section)).replace(/General/gi, '')) && !/[#0?]/.test(unquoted(cleaned(section)).replace(/\.0+(?![0-9#?])/g, ''));
}

function excelDate(serial: number, date1904: boolean): Date {
  const days = date1904 ? serial + 1462 : serial;
  // Day 0 is 1899-12-30 once Excel's 1900 leap-year bug is accounted for.
  const ms = Math.round((days - 25569) * 86400000);
  return new Date(ms);
}

function formatDate(section: string, serial: number, date1904: boolean): string {
  const date = excelDate(serial, date1904);
  const code = cleaned(section);
  const ampm = /AM\/PM|A\/P/i.test(code);
  const tokens = code.match(/"[^"]*"|\\.|_.|\*.|yyyy|yy|mmmmm|mmmm|mmm|mm|m|dddd|ddd|dd|d|hh|h|ss|s|AM\/PM|A\/P|\.0+|./gi) ?? [];
  const parts: string[] = [];
  const hours = date.getUTCHours();
  let lastWasHour = false;
  tokens.forEach((token, index) => {
    const lower = token.toLowerCase();
    const nextTime = tokens.slice(index + 1).find((t) => /^[a-z]/i.test(t) && !/^(am\/pm|a\/p)$/i.test(t))?.toLowerCase() ?? '';
    if (token.startsWith('"')) { parts.push(token.slice(1, -1)); return; }
    if (token.startsWith('\\')) { parts.push(token.slice(1)); return; }
    if (token.startsWith('_')) { parts.push(' '); return; }
    if (token.startsWith('*')) return;
    switch (lower) {
      case 'yyyy': parts.push(String(date.getUTCFullYear())); break;
      case 'yy': parts.push(String(date.getUTCFullYear()).slice(-2)); break;
      case 'mmmmm': parts.push(MONTHS[date.getUTCMonth()][0]); break;
      case 'mmmm': parts.push(MONTHS[date.getUTCMonth()]); break;
      case 'mmm': parts.push(MONTHS[date.getUTCMonth()].slice(0, 3)); break;
      case 'mm':
      case 'm': {
        // "m" after an hour or before seconds means minutes.
        const minutes = lastWasHour || nextTime.startsWith('s');
        const value = minutes ? date.getUTCMinutes() : date.getUTCMonth() + 1;
        parts.push(lower === 'mm' ? String(value).padStart(2, '0') : String(value));
        break;
      }
      case 'dddd': parts.push(DAYS[date.getUTCDay()]); break;
      case 'ddd': parts.push(DAYS[date.getUTCDay()].slice(0, 3)); break;
      case 'dd': parts.push(String(date.getUTCDate()).padStart(2, '0')); break;
      case 'd': parts.push(String(date.getUTCDate())); break;
      case 'hh':
      case 'h': {
        const value = ampm ? ((hours + 11) % 12) + 1 : hours;
        parts.push(lower === 'hh' ? String(value).padStart(2, '0') : String(value));
        break;
      }
      case 'ss': parts.push(String(date.getUTCSeconds()).padStart(2, '0')); break;
      case 's': parts.push(String(date.getUTCSeconds())); break;
      case 'am/pm': parts.push(hours < 12 ? 'AM' : 'PM'); break;
      case 'a/p': parts.push(hours < 12 ? 'A' : 'P'); break;
      default: parts.push(token);
    }
    if (/^h+$/.test(lower)) lastWasHour = true;
    else if (/^[a-z]/i.test(token)) lastWasHour = false;
  });
  return parts.join('');
}

/**
 * `n` (not negative) to `decimals` places the way Excel rounds: on the
 * decimal value it shows (15 significant digits), half away from zero. Plain
 * toFixed works on the binary float, so 1.005 became 1.00 and 2.675 became
 * 2.67 where Excel shows 1.01 and 2.68.
 */
export function roundLikeExcel(n: number, decimals: number): string {
  const d = Math.max(0, Math.min(20, Math.floor(decimals)));
  const shown = Math.abs(n).toPrecision(15);
  if (/e/i.test(shown)) return Math.abs(n).toFixed(d);
  const scaled = Math.round(Number(`${shown}e${d}`));
  if (!Number.isFinite(scaled) || scaled >= 1e21) return Math.abs(n).toFixed(d);
  return Number(`${scaled}e-${d}`).toFixed(d);
}

interface NumberOptions {
  /** Digits only: no thousands separators, currency or other text from the format. */
  plain?: boolean;
}

function formatNumberSection(section: string, value: number, options: NumberOptions = {}): string {
  const code = cleaned(section);
  if (/^general$/i.test(code.trim())) return plainNumber(value);
  if (code.trim() === '@') return plainNumber(value);
  // Fractions ("# ?/?") are rare on labels: show the plain number.
  if (unquoted(code).includes('/')) return plainNumber(value);
  if (/E[+-]/i.test(unquoted(code))) {
    const decimals = (unquoted(code).split(/E/i)[0].split('.')[1] ?? '').replace(/[^0#?]/g, '').length;
    return value.toExponential(decimals).toUpperCase().replace(/E([+-])(\d)$/, 'E$10$2');
  }
  const percent = (unquoted(code).match(/%/g) ?? []).length;
  let n = value * 100 ** percent;
  // Trailing commas after the digits scale by thousands ("#,##0,").
  const scale = unquoted(code).match(/[0#?](,+)(?![0#?])/);
  if (scale) n /= 1000 ** scale[1].length;
  const numeric = unquoted(code).match(/[0#?,.]+/g)?.join('') ?? '0';
  const [intPart, decPart = ''] = numeric.split('.');
  const decimals = decPart.replace(/[^0#?]/g, '').length;
  const minDecimals = decPart.replace(/[^0]/g, '').length;
  const minInt = intPart.replace(/[^0]/g, '').length;
  const grouping = !options.plain && /[0#?],[0#?]/.test(intPart);
  let fixed = roundLikeExcel(n, decimals);
  if (decimals > minDecimals) fixed = fixed.replace(new RegExp(`(\\.\\d{${minDecimals}}\\d*?)0+$`), '$1').replace(/\.$/, '');
  const [wholeDigits, frac] = fixed.split('.');
  let whole = wholeDigits;
  if (whole === '0' && minInt === 0) whole = '';
  whole = whole.padStart(minInt, '0');
  if (grouping) whole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const digits = frac !== undefined ? `${whole}.${frac}` : whole;
  // A section with no digit placeholder is shown as its text alone
  // (the "-" of 0.00;-0.00;"-" for zero).
  const hasDigits = /[0#?]/.test(unquoted(code));
  if (options.plain) return hasDigits ? digits || '0' : plainNumber(n);

  // Put the digits where the number placeholders are, keeping literals around them.
  const tokens = code.match(/"[^"]*"|\\.|_.|\*.|[0#?,.]+|./g) ?? [];
  let placed = false;
  const out: string[] = [];
  for (const token of tokens) {
    if (token.startsWith('"')) out.push(token.slice(1, -1));
    else if (token.startsWith('\\')) out.push(token.slice(1));
    else if (token.startsWith('_') || token.startsWith('*')) continue;
    else if (/^[0#?,.]+$/.test(token) && /[0#?]/.test(token)) { if (!placed) { out.push(digits); placed = true; } }
    else if (token === ',' || token === '.') continue;
    else out.push(token);
  }
  if (!placed && hasDigits) out.push(digits);
  return out.join('').trim();
}

/**
 * The text Excel shows for `raw` (the stored number) with format `code`.
 * `date1904` is the workbook's date system. With `plain`, only the digits
 * (and sign) Excel shows: "$1,234.50" → "1234.50", for barcodes and for
 * templates that add their own "$". Dates stay as dates.
 */
export function formatExcelNumber(raw: string, code: string | undefined, date1904 = false, options: NumberOptions = {}): string {
  const value = Number(raw);
  if (!Number.isFinite(value)) return raw;
  if (!code || /^general$/i.test(code.trim())) return plainNumber(value);
  try {
    const parts = sections(code);
    let section = parts[0];
    let n = value;
    if (value < 0 && parts.length > 1) { section = parts[1]; n = -value; }
    else if (value === 0 && parts.length > 2) section = parts[2];
    if (isDateFormat(section)) return value < 0 ? plainNumber(value) : formatDate(section, value, date1904);
    if (options.plain) {
      // Digits as Excel shows them, with the sign the value really has.
      const digits = formatNumberSection(section, Math.abs(n), options);
      return digits && value < 0 && /[1-9]/.test(digits) ? `-${digits}` : digits;
    }
    const text = formatNumberSection(section, n);
    return value < 0 && parts.length === 1 && n < 0 ? `-${text}` : text;
  } catch {
    return plainNumber(value);
  }
}
