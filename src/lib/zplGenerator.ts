import { LabelFormat, LabelTemplate, TemplateElement, TextElement, QRElement, BarcodeElement, LineElement, RectangleElement, ImageElement } from './types';

export interface PreparedZplImage {
  graphic: string;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
}

export type PreparedZplImages = Record<string, PreparedZplImage>;

export interface GenerateZplOptions {
  imageGraphics?: PreparedZplImages;
}

export interface ZplQrGeometry {
  modules: number;
  magnification: number;
  printedSize: number;
}

/**
 * Generate ZPL II commands from a label template.
 * Positions are in dots (element coordinates should already be in dots for thermal formats).
 *
 * For multi-across rolls (format.labelsAcross > 1), we emit one ^XA..^XZ
 * whose print width covers the full liner width, and every element is drawn
 * N times — once per across-lane, each shifted by (labelW + gap) dots plus
 * the side margin. This is how Zebra printers natively handle multi-across
 * rolls, so the preview and the actual printout match.
 *
 * fieldValues can be:
 * - A single Record<string,string>: same values applied to every lane (useful
 *   when every lane should show the same data, e.g. previews or same-product
 *   batches).
 * - An array of Record<string,string>: one entry per lane. Missing entries
 *   (array shorter than labelsAcross) render as blank lanes. Used by
 *   `generateLabelsForRun` so each lane in a multi-across feed gets its own
 *   unique CSV row.
 */
export function generateZPL(
  template: LabelTemplate,
  format: LabelFormat,
  fieldValues?: Record<string, string> | Array<Record<string, string> | null | undefined>,
  options: GenerateZplOptions = {},
): string {
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

  // Normalize fieldValues into a per-lane array so the draw loop is uniform.
  const perLane: Array<Record<string, string> | undefined> = [];
  if (Array.isArray(fieldValues)) {
    for (let i = 0; i < across; i++) perLane.push(fieldValues[i] ?? undefined);
  } else {
    for (let i = 0; i < across; i++) perLane.push(fieldValues);
  }

  // Draw each element once per lane, offset by the lane origin. Skip a lane
  // entirely if its values slot is undefined — used to pad the last feed of
  // a run when rows don't divide evenly by labelsAcross.
  for (let lane = 0; lane < across; lane++) {
    const laneValues = perLane[lane];
    if (laneValues === undefined) continue;
    const laneOriginX = effectiveSideMDots + lane * (labelWDots + gapDots);
    for (const element of sorted) {
      const cmd = elementToZPL(element, format, laneValues, laneOriginX, options);
      if (cmd) commands.push(cmd);
    }
  }

  commands.push('^XZ');
  return commands.join('\n');
}

export async function generateZPLWithImages(
  template: LabelTemplate,
  format: LabelFormat,
  fieldValues?: Record<string, string> | Array<Record<string, string> | null | undefined>,
): Promise<string> {
  const imageGraphics = await prepareZplImages(template, format);
  return generateZPL(template, format, fieldValues, { imageGraphics });
}

export async function prepareZplImages(template: LabelTemplate, format: LabelFormat): Promise<PreparedZplImages> {
  if (format.type !== 'thermal') return {};
  if (typeof document === 'undefined' || typeof Image === 'undefined') return {};

  const imageElements = template.elements.filter((element): element is ImageElement => (
    element.type === 'image' && !!element.src
  ));
  if (imageElements.length === 0) return {};

  const entries = await Promise.all(imageElements.map(async (element) => {
    const graphic = await imageElementToGraphicField(element, format);
    return [element.id, graphic] as const;
  }));

  return Object.fromEntries(entries);
}

function resolveContent(element: TemplateElement, fieldValues?: Record<string, string>): string {
  if (element.isStatic) {
    if ('content' in element) return element.content || '';
    return '';
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
  options: GenerateZplOptions = {},
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
    case 'image':
      return imageToZPL(element as ImageElement, x, y, options.imageGraphics);
    default:
      return '';
  }
}

function imageToZPL(element: ImageElement, x: number, y: number, imageGraphics?: PreparedZplImages): string {
  const prepared = imageGraphics?.[element.id];
  if (!prepared?.graphic) return '';

  const originX = x + prepared.offsetX;
  const originY = y + prepared.offsetY;

  return `^FO${originX},${originY}${prepared.graphic}^FS`;
}

async function imageElementToGraphicField(element: ImageElement, format: LabelFormat): Promise<PreparedZplImage> {
  const width = Math.max(1, Math.round(element.width));
  const height = Math.max(1, Math.round(element.height));
  const maxDots = Math.max(1, (format.dpi || 203) * 6);
  const baseCanvas = document.createElement('canvas');
  baseCanvas.width = Math.min(width, maxDots);
  baseCanvas.height = Math.min(height, maxDots);

  const baseContext = baseCanvas.getContext('2d', { willReadFrequently: true });
  if (!baseContext) return { graphic: '', width: baseCanvas.width, height: baseCanvas.height, offsetX: 0, offsetY: 0 };

  baseContext.fillStyle = '#ffffff';
  baseContext.fillRect(0, 0, baseCanvas.width, baseCanvas.height);

  const image = await loadImage(element.src);
  const { sx, sy, sw, sh, dx, dy, dw, dh } = imageDrawBox(image, baseCanvas, element.objectFit);
  baseContext.drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh);

  const rotatedCanvas = rotateCanvasForZpl(baseCanvas, element.rotation);
  const origin = centeredRotatedOrigin(
    Math.round(element.x),
    Math.round(element.y),
    width,
    height,
    rotatedCanvas.width,
    rotatedCanvas.height,
  );
  const { canvas, x, y } = cropCanvasToLabel(rotatedCanvas, origin.x, origin.y, format);
  const graphic = canvasToGraphicField(canvas);
  return {
    graphic,
    width: canvas.width,
    height: canvas.height,
    offsetX: x - Math.round(element.x),
    offsetY: y - Math.round(element.y),
  };
}

function canvasToGraphicField(canvas: HTMLCanvasElement): string {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return '';
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const bytesPerRow = Math.ceil(canvas.width / 8);
  const totalBytes = bytesPerRow * canvas.height;
  const bytes = new Uint8Array(totalBytes);

  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const idx = (y * canvas.width + x) * 4;
      const alpha = imageData.data[idx + 3] / 255;
      const red = imageData.data[idx];
      const green = imageData.data[idx + 1];
      const blue = imageData.data[idx + 2];
      const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) * alpha + 255 * (1 - alpha);
      if (luminance < 180) {
        bytes[y * bytesPerRow + Math.floor(x / 8)] |= 0x80 >> (x % 8);
      }
    }
  }

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0').toUpperCase()).join('');
  return `^GFA,${totalBytes},${totalBytes},${bytesPerRow},${hex}`;
}

function rotateCanvasForZpl(source: HTMLCanvasElement, rotation: number): HTMLCanvasElement {
  const normalized = normalizeRotation(rotation);
  if (normalized === 0) return source;

  const canvas = document.createElement('canvas');
  canvas.width = normalized === 90 || normalized === 270 ? source.height : source.width;
  canvas.height = normalized === 90 || normalized === 270 ? source.width : source.height;

  const context = canvas.getContext('2d');
  if (!context) return source;

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);

  if (normalized === 90) {
    context.translate(canvas.width, 0);
    context.rotate(Math.PI / 2);
  } else if (normalized === 180) {
    context.translate(canvas.width, canvas.height);
    context.rotate(Math.PI);
  } else if (normalized === 270) {
    context.translate(0, canvas.height);
    context.rotate(-Math.PI / 2);
  }

  context.drawImage(source, 0, 0);
  return canvas;
}

function cropCanvasToLabel(
  source: HTMLCanvasElement,
  x: number,
  y: number,
  format: LabelFormat,
): { canvas: HTMLCanvasElement; x: number; y: number } {
  const dpi = format.dpi || 203;
  const labelWidth = Math.round(format.width * dpi);
  const labelHeight = Math.round(format.height * dpi);

  const cropLeft = Math.max(0, -x);
  const cropTop = Math.max(0, -y);
  const cropRight = Math.max(0, x + source.width - labelWidth);
  const cropBottom = Math.max(0, y + source.height - labelHeight);
  const croppedWidth = source.width - cropLeft - cropRight;
  const croppedHeight = source.height - cropTop - cropBottom;

  if (croppedWidth <= 0 || croppedHeight <= 0) {
    const empty = document.createElement('canvas');
    empty.width = 1;
    empty.height = 1;
    return { canvas: empty, x: Math.max(0, x), y: Math.max(0, y) };
  }

  if (cropLeft === 0 && cropTop === 0 && cropRight === 0 && cropBottom === 0) {
    return { canvas: source, x, y };
  }

  const canvas = document.createElement('canvas');
  canvas.width = croppedWidth;
  canvas.height = croppedHeight;
  const context = canvas.getContext('2d');
  if (!context) return { canvas: source, x, y };

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(
    source,
    cropLeft,
    cropTop,
    croppedWidth,
    croppedHeight,
    0,
    0,
    croppedWidth,
    croppedHeight,
  );

  return {
    canvas,
    x: x + cropLeft,
    y: y + cropTop,
  };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not load logo image for ZPL output.'));
    image.src = src;
  });
}

function imageDrawBox(
  image: HTMLImageElement,
  canvas: HTMLCanvasElement,
  objectFit: ImageElement['objectFit'],
) {
  const imageW = image.naturalWidth || image.width || canvas.width;
  const imageH = image.naturalHeight || image.height || canvas.height;

  if (objectFit === 'fill') {
    return { sx: 0, sy: 0, sw: imageW, sh: imageH, dx: 0, dy: 0, dw: canvas.width, dh: canvas.height };
  }

  const sourceAspect = imageW / imageH;
  const targetAspect = canvas.width / canvas.height;

  if (objectFit === 'cover') {
    if (sourceAspect > targetAspect) {
      const sw = imageH * targetAspect;
      return { sx: (imageW - sw) / 2, sy: 0, sw, sh: imageH, dx: 0, dy: 0, dw: canvas.width, dh: canvas.height };
    }
    const sh = imageW / targetAspect;
    return { sx: 0, sy: (imageH - sh) / 2, sw: imageW, sh, dx: 0, dy: 0, dw: canvas.width, dh: canvas.height };
  }

  if (sourceAspect > targetAspect) {
    const dh = canvas.width / sourceAspect;
    return { sx: 0, sy: 0, sw: imageW, sh: imageH, dx: 0, dy: (canvas.height - dh) / 2, dw: canvas.width, dh };
  }

  const dw = canvas.height * sourceAspect;
  return { sx: 0, sy: 0, sw: imageW, sh: imageH, dx: (canvas.width - dw) / 2, dy: 0, dw, dh: canvas.height };
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

  const blockWidth = Math.round(element.width);
  const maxLines = Math.max(1, Math.floor(element.height / (fontH * (element.lineHeight || 1.2))));
  const lineSpacing = Math.round(fontH * ((element.lineHeight || 1.2) - 1));

  // Alignment: L=left, C=center, R=right, J=justified
  let align = 'L';
  if (element.textAlign === 'center') align = 'C';
  else if (element.textAlign === 'right') align = 'R';

  const rotation = normalizeRotation(element.rotation);
  const orientation = rotationToZplOrientation(rotation);

  const cmds: string[] = [];

  // Field origin
  cmds.push(`^FO${x},${y}`);

  // Font: ^A0 = default scalable font
  cmds.push(`^A0${orientation},${fontH},${fontW}`);

  // Field block for text wrapping and alignment
  cmds.push(`^FB${blockWidth},${maxLines},${lineSpacing},${align},0`);

  // Field data
  cmds.push(`^FD${escapeZPL(content)}^FS`);

  return cmds.join('');
}

function normalizeRotation(rotation: number | undefined): 0 | 90 | 180 | 270 {
  const normalized = (((Math.round(rotation || 0) % 360) + 360) % 360);
  if (normalized === 90 || normalized === 180 || normalized === 270) return normalized;
  return 0;
}

function rotationToZplOrientation(rotation: 0 | 90 | 180 | 270): 'N' | 'R' | 'I' | 'B' {
  if (rotation === 90) return 'R';
  if (rotation === 180) return 'I';
  if (rotation === 270) return 'B';
  return 'N';
}

function centeredRotatedOrigin(
  x: number,
  y: number,
  originalWidth: number,
  originalHeight: number,
  renderedWidth: number,
  renderedHeight: number,
): { x: number; y: number } {
  return {
    x: Math.round(x + originalWidth / 2 - renderedWidth / 2),
    y: Math.round(y + originalHeight / 2 - renderedHeight / 2),
  };
}

function rotatedBoxOrigin(
  x: number,
  y: number,
  width: number,
  height: number,
  rotation: 0 | 90 | 180 | 270,
): { x: number; y: number } {
  if (rotation === 90) {
    return {
      x: Math.round(x + width / 2 + height / 2),
      y: Math.round(y + height / 2 - width / 2),
    };
  }

  if (rotation === 180) {
    return {
      x: Math.round(x + width),
      y: Math.round(y + height),
    };
  }

  if (rotation === 270) {
    return {
      x: Math.round(x + width / 2 - height / 2),
      y: Math.round(y + height / 2 + width / 2),
    };
  }

  return { x, y };
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
  const { magnification: mag, printedSize } = zplQrGeometry(content, ec, element.width);
  const rotation = normalizeRotation(element.rotation);
  const orientation = rotationToZplOrientation(rotation);
  const centered = centeredRotatedOrigin(
    x,
    y,
    Math.round(element.width),
    Math.round(element.height),
    printedSize,
    printedSize,
  );
  const { x: originX, y: originY } = rotatedBoxOrigin(centered.x, centered.y, printedSize, printedSize, rotation);

  const cmds: string[] = [];
  cmds.push(`^FO${originX},${originY}`);
  // Fifth param of ^BQ sets error correction level: H,Q,M,L.
  cmds.push(`^BQ${orientation},2,${mag},${ec}`);
  cmds.push(`^FDQA,${escapeZPL(content)}^FS`);

  return cmds.join('');
}

export function zplQrGeometry(content: string, ec: 'L' | 'M' | 'Q' | 'H' = 'M', requestedSize: number): ZplQrGeometry {
  const modules = estimateQrModules(content, ec);
  const elementW = Math.max(1, Math.round(requestedSize));
  const magnification = Math.max(1, Math.min(10, Math.floor(elementW / modules)));
  return {
    modules,
    magnification,
    printedSize: modules * magnification,
  };
}

export function snapZplQrSize(content: string, ec: 'L' | 'M' | 'Q' | 'H' = 'M', requestedSize: number): number {
  return zplQrGeometry(content, ec, requestedSize).printedSize;
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
  const rotation = normalizeRotation(element.rotation);
  const orientation = rotationToZplOrientation(rotation);
  const { x: originX, y: originY } = rotatedBoxOrigin(
    x,
    y,
    Math.round(element.width),
    Math.round(element.height),
    rotation,
  );

  const cmds: string[] = [];
  cmds.push(`^FO${originX},${originY}`);

  // Module width (narrow bar): ~2 dots default
  const moduleWidth = 2;

  switch (element.barcodeFormat) {
    case 'CODE128':
      cmds.push(`^BC${orientation},${height},${showText},N,N`);
      break;
    case 'CODE39':
      cmds.push(`^B3${orientation},N,${height},${showText},N`);
      break;
    case 'UPC':
      cmds.push(`^BU${orientation},${height},${showText},N`);
      break;
    case 'EAN13':
      cmds.push(`^BE${orientation},${height},${showText},N`);
      break;
    case 'EAN8':
      cmds.push(`^B8${orientation},${height},${showText},N`);
      break;
    case 'ITF14':
      cmds.push(`^BI${orientation},${height},${showText},N`);
      break;
    default:
      cmds.push(`^BC${orientation},${height},${showText},N,N`);
  }

  cmds.push(`^FD${escapeZPL(content)}^FS`);
  cmds.push(`^BY${moduleWidth}`);

  return cmds.join('');
}

function lineToZPL(element: LineElement, x: number, y: number, format: LabelFormat): string {
  const dpi = format.dpi || 203;
  const strokeW = Math.max(1, Math.round(element.strokeWidth * (dpi / 72)));
  const rotation = normalizeRotation(element.rotation);
  const originalW = Math.max(strokeW, Math.round(element.width));
  const originalH = Math.max(strokeW, Math.round(element.height));
  const w = rotation === 90 || rotation === 270 ? originalH : originalW;
  const h = rotation === 90 || rotation === 270 ? originalW : originalH;
  const { x: originX, y: originY } = centeredRotatedOrigin(x, y, originalW, originalH, w, h);

  // Use graphic box for lines
  return `^FO${originX},${originY}^GB${w},${h},${strokeW}^FS`;
}

function rectangleToZPL(element: RectangleElement, x: number, y: number, format: LabelFormat): string {
  const dpi = format.dpi || 203;
  const strokeW = Math.max(1, Math.round(element.strokeWidth * (dpi / 72)));
  const rotation = normalizeRotation(element.rotation);
  const originalW = Math.round(element.width);
  const originalH = Math.round(element.height);
  const w = rotation === 90 || rotation === 270 ? originalH : originalW;
  const h = rotation === 90 || rotation === 270 ? originalW : originalH;
  const { x: originX, y: originY } = centeredRotatedOrigin(x, y, originalW, originalH, w, h);
  const r = Math.round(element.borderRadius);

  return `^FO${originX},${originY}^GB${w},${h},${strokeW},B,${r}^FS`;
}

function escapeZPL(text: string): string {
  // ZPL special chars that need escaping
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\^/g, '\\^')
    .replace(/~/g, '\\~');
}
