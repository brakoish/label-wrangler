import { LabelFormat, LabelTemplate, TemplateElement, TextElement, QRElement, BarcodeElement, LineElement, RectangleElement } from './types';

/**
 * Generate ZPL II commands from a label template.
 * Positions are in dots (element coordinates should already be in dots for thermal formats).
 *
 * For multi-across rolls (format.labelsAcross > 1), we emit one ^XA..^XZ
 * whose print width covers the full liner width, and every element is drawn
 * N times — once per across-lane, each shifted by (labelW + gap) dots plus
 * the side margin. This is how Zebra printers natively handle multi-across
 * rolls, so the preview and the actual printout match.
 */
export function generateZPL(template: LabelTemplate, format: LabelFormat, fieldValues?: Record<string, string>): string {
  const dpi = format.dpi || 203;
  const labelWDots = Math.round(format.width * dpi);
  const heightDots = Math.round(format.height * dpi);
  const across = Math.max(1, format.labelsAcross || 1);
  const gapDots = Math.round((format.horizontalGapThermal || 0) * dpi);
  const sideMDots = Math.round((format.sideMarginThermal || 0) * dpi);
  // Total liner width in dots. If the user set linerWidth explicitly, use it;
  // otherwise compute from across + gaps + margins so the preview matches the
  // physical roll exactly.
  const computedLinerDots = sideMDots * 2 + across * labelWDots + (across - 1) * gapDots;
  const linerDots = format.linerWidth
    ? Math.round(format.linerWidth * dpi)
    : computedLinerDots;
  // Effective side margin: if no explicit margin was set but a liner width was,
  // center the label group on the liner (matches LayoutPreview behavior).
  const effectiveSideMDots = (format.sideMarginThermal && format.sideMarginThermal > 0)
    ? sideMDots
    : Math.max(0, Math.round((linerDots - (across * labelWDots + (across - 1) * gapDots)) / 2));

  // Sort by zIndex once — reused for every across-lane.
  const sorted = [...template.elements].sort((a, b) => a.zIndex - b.zIndex);

  const commands: string[] = [];
  commands.push('^XA');
  // Print width covers the full liner so multi-across lays out correctly.
  commands.push(`^PW${linerDots}`);
  commands.push(`^LL${heightDots}`);

  // Draw each element once per lane, offset by the lane origin.
  for (let lane = 0; lane < across; lane++) {
    const laneOriginX = effectiveSideMDots + lane * (labelWDots + gapDots);
    for (const element of sorted) {
      const cmd = elementToZPL(element, format, fieldValues, laneOriginX);
      if (cmd) commands.push(cmd);
    }
  }

  commands.push('^XZ');
  return commands.join('\n');
}

function resolveContent(element: TemplateElement, fieldValues?: Record<string, string>): string {
  if (element.isStatic) {
    return (element as any).content || '';
  }

  const value = (element.fieldName && fieldValues?.[element.fieldName])
    || element.defaultValue
    || '';

  const prefix = element.prefix || '';
  const suffix = element.suffix || '';

  return `${prefix}${value}${suffix}`;
}

function elementToZPL(
  element: TemplateElement,
  format: LabelFormat,
  fieldValues?: Record<string, string>,
  laneOriginX: number = 0,
): string {
  // Round positions to nearest dot. `laneOriginX` shifts every element for
  // multi-across layouts; when across=1 it's 0 and everything behaves as before.
  const x = Math.round(element.x) + laneOriginX;
  const y = Math.round(element.y);

  switch (element.type) {
    case 'text':
      return textToZPL(element as TextElement, x, y, format, fieldValues);
    case 'qr':
      return qrToZPL(element as QRElement, x, y, fieldValues);
    case 'barcode':
      return barcodeToZPL(element as BarcodeElement, x, y, fieldValues);
    case 'line':
      return lineToZPL(element as LineElement, x, y, format);
    case 'rectangle':
      return rectangleToZPL(element as RectangleElement, x, y, format);
    default:
      return '';
  }
}

function textToZPL(element: TextElement, x: number, y: number, format: LabelFormat, fieldValues?: Record<string, string>): string {
  const content = resolveContent(element, fieldValues);
  if (!content) return '';

  const dpi = format.dpi || 203;

  // Convert font size from points to dots.
  // ZPL font height in dots: fontSize (pt) * dpi / 72.
  // Width: controllable via element.charWidth (fontW / fontH ratio).
  // Default 0.5 matches Zebra Font 0's native look when fontW is omitted —
  // narrow/squished and great for fitting dense text in small labels.
  // Bump to 0.6–0.8 for roomier text.
  const fontH = Math.round(element.fontSize * (dpi / 72));
  const widthRatio = element.charWidth ?? 0.5;
  const fontW = Math.max(1, Math.round(fontH * widthRatio));

  const cmds: string[] = [];

  // Field origin
  cmds.push(`^FO${x},${y}`);

  // Font: ^A0 = default scalable font
  // Rotation: N=normal, R=90°, I=180°, B=270°
  let rotation = 'N';
  if (element.rotation === 90) rotation = 'R';
  else if (element.rotation === 180) rotation = 'I';
  else if (element.rotation === 270) rotation = 'B';

  cmds.push(`^A0${rotation},${fontH},${fontW}`);

  // Field block for text wrapping and alignment
  const blockWidth = Math.round(element.width);
  const maxLines = Math.max(1, Math.floor(element.height / (fontH * (element.lineHeight || 1.2))));
  const lineSpacing = Math.round(fontH * ((element.lineHeight || 1.2) - 1));

  // Alignment: L=left, C=center, R=right, J=justified
  let align = 'L';
  if (element.textAlign === 'center') align = 'C';
  else if (element.textAlign === 'right') align = 'R';

  cmds.push(`^FB${blockWidth},${maxLines},${lineSpacing},${align},0`);

  // Field data
  cmds.push(`^FD${escapeZPL(content)}^FS`);

  return cmds.join('');
}

function qrToZPL(element: QRElement, x: number, y: number, fieldValues?: Record<string, string>): string {
  const content = resolveContent(element, fieldValues);
  if (!content) return '';

  // Choose magnification so the QR physically fills element.width regardless
  // of how long the data is. Previously we picked mag from element width
  // alone, which meant short data (e.g. "QR") rendered tiny and long data
  // (40-char URLs) overflowed because the module count jumped from ~21 to
  // ~37+ at the same mag.
  //
  // Strategy: estimate the minimum QR version (and therefore module count)
  // needed for `content` at the chosen error-correction level, then pick the
  // largest mag where moduleCount * mag ≤ elementWidth.
  const ec = element.errorCorrection || 'M';
  const modules = estimateQrModules(content, ec);
  const elementW = Math.round(element.width);
  const mag = Math.max(1, Math.min(10, Math.floor(elementW / modules)));

  const cmds: string[] = [];
  cmds.push(`^FO${x},${y}`);
  // Fifth param of ^BQ sets error correction level: H,Q,M,L.
  cmds.push(`^BQN,2,${mag},${ec}`);
  cmds.push(`^FDQA,${escapeZPL(content)}^FS`);

  return cmds.join('');
}

/**
 * Roughly estimate how many modules per side a QR code needs for a given
 * content string + error-correction level. Based on QR alphanumeric +
 * byte-mode capacity tables. Values are "maximum characters at this version"
 * for the chosen EC, then we pick the first version that fits.
 *
 * We deliberately use byte-mode caps (worst case) since our content is often
 * URLs and tags that mix letters, digits, and symbols. Module count = 21 + 4*(version-1).
 */
function estimateQrModules(content: string, ec: 'L' | 'M' | 'Q' | 'H'): number {
  const len = content.length;
  // Byte-mode capacity per version for each EC level, versions 1..10 (covers
  // everything we realistically print on thermal labels). For lengths beyond
  // version 10 we clamp to version 10's module count (57) — the mag calc will
  // still produce a workable QR even if data is massive.
  const capsByte: Record<'L' | 'M' | 'Q' | 'H', number[]> = {
    L: [17, 32, 53, 78, 106, 134, 154, 192, 230, 271],
    M: [14, 26, 42, 62, 84, 106, 122, 152, 180, 213],
    Q: [11, 20, 32, 46, 60, 74, 86, 108, 130, 151],
    H: [7, 14, 24, 34, 44, 58, 64, 84, 98, 119],
  };
  const caps = capsByte[ec] || capsByte.M;
  let version = caps.findIndex((c) => len <= c) + 1;
  if (version === 0) version = caps.length; // data longer than v10 cap — clamp
  return 21 + 4 * (version - 1);
}

function barcodeToZPL(element: BarcodeElement, x: number, y: number, fieldValues?: Record<string, string>): string {
  const content = resolveContent(element, fieldValues);
  if (!content) return '';

  const height = Math.round(element.height * 0.75); // Barcode height in dots
  const showText = element.showText ? 'Y' : 'N';

  const cmds: string[] = [];
  cmds.push(`^FO${x},${y}`);

  // Module width (narrow bar): ~2 dots default
  const moduleWidth = 2;

  switch (element.barcodeFormat) {
    case 'CODE128':
      cmds.push(`^BCN,${height},${showText},N,N`);
      break;
    case 'CODE39':
      cmds.push(`^B3N,N,${height},${showText},N`);
      break;
    case 'UPC':
      cmds.push(`^BUN,${height},${showText},N`);
      break;
    case 'EAN13':
      cmds.push(`^BEN,${height},${showText},N`);
      break;
    case 'EAN8':
      cmds.push(`^B8N,${height},${showText},N`);
      break;
    case 'ITF14':
      cmds.push(`^BIN,${height},${showText},N`);
      break;
    default:
      cmds.push(`^BCN,${height},${showText},N,N`);
  }

  cmds.push(`^FD${escapeZPL(content)}^FS`);
  cmds.push(`^BY${moduleWidth}`);

  return cmds.join('');
}

function lineToZPL(element: LineElement, x: number, y: number, format: LabelFormat): string {
  const dpi = format.dpi || 203;
  const strokeW = Math.max(1, Math.round(element.strokeWidth * (dpi / 72)));
  const w = Math.max(strokeW, Math.round(element.width));
  const h = Math.max(strokeW, Math.round(element.height));

  // Use graphic box for lines
  return `^FO${x},${y}^GB${w},${h},${strokeW}^FS`;
}

function rectangleToZPL(element: RectangleElement, x: number, y: number, format: LabelFormat): string {
  const dpi = format.dpi || 203;
  const strokeW = Math.max(1, Math.round(element.strokeWidth * (dpi / 72)));
  const w = Math.round(element.width);
  const h = Math.round(element.height);
  const r = Math.round(element.borderRadius);

  return `^FO${x},${y}^GB${w},${h},${strokeW},B,${r}^FS`;
}

function escapeZPL(text: string): string {
  // ZPL special chars that need escaping
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\^/g, '\\^')
    .replace(/~/g, '\\~');
}
