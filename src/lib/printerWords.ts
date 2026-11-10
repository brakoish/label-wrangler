/**
 * A USB printer's own words ("Printer media out", "A transfer error has
 * occurred.") in plain words with what to do next. Anything else is passed
 * through unchanged.
 */
const PROBLEMS: Record<string, { what: string; fix: string }> = {
  'media out': { what: 'out of labels', fix: 'load a new roll' },
  'ribbon out': { what: 'out of ribbon', fix: 'load a new ribbon' },
  'head open': { what: 'its lid is open', fix: 'close the lid' },
  paused: { what: 'paused', fix: 'press the pause button on the printer' },
};

const join = (items: string[]) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

export function plainPrinterProblem(message: string): string {
  const text = (message || '').trim();
  if (/^Printer ready$/i.test(text)) return 'The printer is ready.';
  const status = text.match(/^Printer (.+)$/i);
  if (status) {
    const found = status[1].split(/,\s*/).map((part) => PROBLEMS[part.toLowerCase()]).filter(Boolean);
    if (found.length) {
      const what = found.map((p, i) => (i === 0 && !p.what.startsWith('its') ? `is ${p.what}` : p.what));
      const fix = join(found.map((p) => p.fix));
      return `The printer ${join(what)}. ${fix.charAt(0).toUpperCase()}${fix.slice(1)}, then resume printing.`;
    }
  }
  if (/transfer error/i.test(text)) return 'The printer stopped answering over USB, so printing stopped. Check the cable, turn the printer off and on, then resume printing.';
  if (/device (was |has been )?disconnected|device unavailable/i.test(text)) return 'The printer was unplugged or turned off. Plug it back in, press Connect printer, then resume printing.';
  return text;
}
