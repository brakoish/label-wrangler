import { LabelFormat, LabelTemplate, TemplateElement, TextElement, QRElement, BarcodeElement, LineElement, RectangleElement } from './types';

/**
 * Generate ZPL II commands from a label template.
 * Positions are in dots (element coordinates should already be in dots for thermal formats).
 */
export function generateZPL(template: LabelTemplate, format: LabelFormat, fieldValues?: Record<string, string>): string {
  const dpi = format.dpi || 203;
  const widthDots = Math.round(format.width * dpi);
  const heightDots = Math.round(format.height * dpi);

  const commands: string[] = [];

  // Start format
  commands.push('^XA');

  // Label dimensions
  commands.push(`^PW${widthDots}`); // Print width
  commands.push(`^LL${heightDots}`); // Label length

  // Sort by zIndex
  const sorted = [...template.elements].sort((a, b) => a.zIndex - b.zIndex);

  for (const element of sorted) {
    const cmd = elementToZPL(element, format, fieldValues);
    if (cmd) commands.push(cmd);
  }

  // End format
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

function elementToZPL(element: TemplateElement, format: LabelFormat, fieldValues?: Record<string, string>): string {
  // Round positions to nearest dot
  const x = Math.round(element.x);
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

  // QR magnification: approximate from element size
  // Each QR module at mag 1 = ~10 dots at 203dpi
  // Element width in dots / typical QR size (~21 modules for simple data)
  const mag = Math.max(1, Math.min(10, Math.round(element.width / 25)));

  // Error correction: H=ultra-high, Q=high, M=standard, L=high density
  const ec = element.errorCorrection || 'M';

  const cmds: string[] = [];
  cmds.push(`^FO${x},${y}`);
  cmds.push(`^BQN,2,${mag}`);
  cmds.push(`^FDQA,${escapeZPL(content)}^FS`);

  return cmds.join('');
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
