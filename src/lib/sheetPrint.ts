import QRCode from 'qrcode';
import JsBarcode from 'jsbarcode';
import type {
  BarcodeElement,
  ImageElement,
  LabelFormat,
  LabelTemplate,
  LineElement,
  QRElement,
  RectangleElement,
  Run,
  TemplateElement,
  TextElement,
} from './types';
import { previewLabelValues } from './runBuilder';

interface SheetPrintOptions {
  from?: number;
  to?: number;
  autoPrint?: boolean;
}

interface SheetPosition {
  x: number;
  y: number;
}

export async function openSheetPrintWindow(
  run: Run,
  template: LabelTemplate,
  format: LabelFormat,
  options: SheetPrintOptions = {},
): Promise<void> {
  if (format.type !== 'sheet') {
    throw new Error('Sheet print output requires a sheet label format.');
  }

  const win = window.open('', '_blank');
  if (!win) {
    throw new Error('Popup blocked. Allow popups for Label Wrangler, then try again.');
  }

  win.document.open();
  win.document.write(buildLoadingHtml(run.name || 'Sheet labels'));
  win.document.close();

  const html = await buildSheetPrintHtml(run, template, format, options);
  win.document.open();
  win.document.write(html);
  win.document.close();
}

function buildLoadingHtml(title: string): string {
  const safeTitle = escapeHtml(title);
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${safeTitle}</title>
  <style>
    html, body { height: 100%; margin: 0; background: #18181b; color: #e4e4e7; }
    body { display: grid; place-items: center; font-family: Arial, Helvetica, sans-serif; }
    .box { display: grid; gap: 8px; text-align: center; font-size: 13px; }
    .title { color: #f59e0b; font-weight: 700; }
    .sub { color: #a1a1aa; }
  </style>
</head>
<body>
  <div class="box">
    <div class="title">Preparing sheet output...</div>
    <div class="sub">${safeTitle}</div>
  </div>
</body>
</html>`;
}

export async function buildSheetPrintHtml(
  run: Run,
  template: LabelTemplate,
  format: LabelFormat,
  options: SheetPrintOptions,
): Promise<string> {
  const sheetW = format.sheetWidth || 8.5;
  const sheetH = format.sheetHeight || 11;
  const labelW = format.width;
  const labelH = format.height;
  const positions = getSheetPositions(format);
  if (positions.length === 0) {
    throw new Error('This sheet format has no printable label positions.');
  }

  const from = Math.max(1, options.from || 1);
  const to = Math.min(run.sourceData.length, options.to || run.sourceData.length);
  const sorted = [...template.elements].sort((a, b) => a.zIndex - b.zIndex);

  const pages: string[] = [];
  for (let labelIndex = from - 1; labelIndex <= to - 1; labelIndex += positions.length) {
    const cells: string[] = [];
    for (let slot = 0; slot < positions.length; slot++) {
      const runIndex = labelIndex + slot;
      if (runIndex > to - 1) break;
      const pos = positions[slot];
      const values = previewLabelValues(run, runIndex);
      const labelSvg = await renderLabelSvg(sorted, format, values);
      cells.push(`
        <div class="label-cell" style="left:${pos.x}in;top:${pos.y}in;width:${labelW}in;height:${labelH}in">
          ${labelSvg}
        </div>
      `);
    }
    pages.push(`<section class="sheet-page">${cells.join('')}</section>`);
  }

  const safeTitle = escapeHtml(run.name || 'Sheet labels');
  const autoPrintScript = options.autoPrint === false
    ? ''
    : '<script>window.addEventListener("load",()=>setTimeout(()=>window.print(),250));</script>';

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${safeTitle}</title>
  <style>
    @page { size: ${sheetW}in ${sheetH}in; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #f4f4f5; color: #18181b; }
    body { font-family: Arial, Helvetica, sans-serif; }
    .toolbar {
      position: sticky;
      top: 0;
      z-index: 10;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 12px 14px;
      background: #18181b;
      color: #e4e4e7;
      font-size: 12px;
    }
    .toolbar-main {
      display: grid;
      gap: 4px;
    }
    .print-warning {
      display: inline-flex;
      align-items: center;
      width: fit-content;
      border: 1px solid #f59e0b;
      border-radius: 6px;
      padding: 4px 8px;
      background: #451a03;
      color: #fde68a;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .toolbar button {
      border: 0;
      border-radius: 6px;
      padding: 7px 12px;
      background: #f59e0b;
      color: #18181b;
      font-weight: 700;
      cursor: pointer;
    }
    .sheet-page {
      position: relative;
      width: ${sheetW}in;
      height: ${sheetH}in;
      margin: 18px auto;
      background: #fff;
      overflow: hidden;
      print-color-adjust: exact;
      -webkit-print-color-adjust: exact;
    }
    .label-cell {
      position: absolute;
      overflow: hidden;
    }
    .label-cell svg {
      display: block;
      width: 100%;
      height: 100%;
    }
    @media print {
      html, body { background: #fff; }
      .toolbar { display: none; }
      .sheet-page {
        margin: 0;
        break-after: page;
        page-break-after: always;
        box-shadow: none;
      }
      .sheet-page:last-child {
        break-after: auto;
        page-break-after: auto;
      }
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <div class="toolbar-main">
      <div>${safeTitle} · labels ${from}-${to}</div>
      <div class="print-warning">Print setting: 100% / Actual size. Do not use Fit to page.</div>
    </div>
    <button onclick="window.print()">Print / Save PDF</button>
  </div>
  ${pages.join('')}
  ${autoPrintScript}
</body>
</html>`;
}

export async function buildSheetPrintPdf(
  run: Run,
  template: LabelTemplate,
  format: LabelFormat,
  options: SheetPrintOptions,
  onProgress?: (progress: number) => void,
): Promise<Uint8Array> {
  if (format.type !== 'sheet') {
    throw new Error('Sheet PDF output requires a sheet label format.');
  }

  const { PDFDocument } = await import('pdf-lib');
  const pdfDoc = await PDFDocument.create();
  const sheetW = format.sheetWidth || 8.5;
  const sheetH = format.sheetHeight || 11;
  const positions = getSheetPositions(format);
  if (positions.length === 0) {
    throw new Error('This sheet format has no printable label positions.');
  }

  const from = Math.max(1, options.from || 1);
  const to = Math.min(run.sourceData.length, options.to || run.sourceData.length);
  const sorted = [...template.elements].sort((a, b) => a.zIndex - b.zIndex);
  const totalPages = Math.max(1, Math.ceil((to - from + 1) / positions.length));
  let pageNumber = 0;

  for (let labelIndex = from - 1; labelIndex <= to - 1; labelIndex += positions.length) {
    const pageSvg = await renderSheetPageSvg(run, sorted, format, positions, labelIndex, to);
    const pngBytes = await svgToPngBytes(pageSvg, sheetW, sheetH);
    const png = await pdfDoc.embedPng(pngBytes);
    const page = pdfDoc.addPage([sheetW * 72, sheetH * 72]);
    page.drawImage(png, { x: 0, y: 0, width: sheetW * 72, height: sheetH * 72 });
    pageNumber += 1;
    onProgress?.(Math.round((pageNumber / totalPages) * 100));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  return pdfDoc.save();
}

function getSheetPositions(format: LabelFormat): SheetPosition[] {
  const cols = format.columns || 1;
  const rows = format.rows || 1;
  const sheetW = format.sheetWidth || 8.5;
  const sheetH = format.sheetHeight || 11;
  const labelW = format.width;
  const labelH = format.height;
  const sideM = format.sideMargin || 0;
  const topM = format.topMargin || 0;
  const gapX = format.horizontalGap || 0;
  const gapY = format.verticalGap || 0;
  const positions: SheetPosition[] = [];

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = sideM + col * (labelW + gapX);
      const y = topM + row * (labelH + gapY);
      if (x + labelW > sheetW + 0.01 || y + labelH > sheetH + 0.01) continue;
      positions.push({ x, y });
    }
  }

  return positions;
}

async function renderSheetPageSvg(
  run: Run,
  elements: TemplateElement[],
  format: LabelFormat,
  positions: SheetPosition[],
  labelIndex: number,
  to: number,
): Promise<string> {
  const sheetW = format.sheetWidth || 8.5;
  const sheetH = format.sheetHeight || 11;
  const cells: string[] = [];

  for (let slot = 0; slot < positions.length; slot++) {
    const runIndex = labelIndex + slot;
    if (runIndex > to - 1) break;

    const pos = positions[slot];
    const values = previewLabelValues(run, runIndex);
    const labelSvg = await renderLabelSvg(elements, format, values);
    cells.push(`<svg x="${pos.x}" y="${pos.y}" width="${format.width}" height="${format.height}" viewBox="0 0 ${format.width} ${format.height}" preserveAspectRatio="none">${extractSvgBody(labelSvg)}</svg>`);
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${sheetW}in" height="${sheetH}in" viewBox="0 0 ${sheetW} ${sheetH}"><rect width="${sheetW}" height="${sheetH}" fill="#ffffff"/>${cells.join('')}</svg>`;
}

export async function renderSheetLabelSvg(
  elements: TemplateElement[],
  format: LabelFormat,
  values: Record<string, string>,
): Promise<string> {
  const sorted = [...elements].sort((a, b) => a.zIndex - b.zIndex);
  return renderLabelSvg(sorted, format, values);
}

async function svgToPngBytes(svg: string, sheetW: number, sheetH: number): Promise<Uint8Array> {
  const dpi = 300;
  const width = Math.round(sheetW * dpi);
  const height = Math.round(sheetH * dpi);
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  try {
    const img = new Image();
    img.decoding = 'async';
    const loaded = new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Could not render the sheet PDF image.'));
    });
    img.src = url;
    await loaded;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not prepare the sheet PDF canvas.');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);

    const pngBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => {
        if (result) resolve(result);
        else reject(new Error('Could not encode the sheet PDF image.'));
      }, 'image/png');
    });

    return new Uint8Array(await pngBlob.arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
  }
}

function extractSvgBody(svg: string): string {
  const start = svg.indexOf('>');
  const end = svg.lastIndexOf('</svg>');
  if (start === -1 || end === -1 || end <= start) return svg;
  return svg.slice(start + 1, end);
}

async function renderLabelSvg(
  elements: TemplateElement[],
  format: LabelFormat,
  values: Record<string, string>,
): Promise<string> {
  const body: string[] = [];
  for (const element of elements) {
    body.push(await renderElement(element, format, values));
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${format.width} ${format.height}" preserveAspectRatio="none">${body.join('')}</svg>`;
}

async function renderElement(
  element: TemplateElement,
  format: LabelFormat,
  values: Record<string, string>,
): Promise<string> {
  const rotation = element.rotation
    ? ` transform="rotate(${element.rotation} ${element.x} ${element.y})"`
    : '';

  switch (element.type) {
    case 'text':
      return renderText(element as TextElement, values, rotation);
    case 'qr':
      return renderQr(element as QRElement, values, rotation);
    case 'barcode':
      return renderBarcode(element as BarcodeElement, values, rotation);
    case 'line':
      return renderLine(element as LineElement, format, rotation);
    case 'rectangle':
      return renderRectangle(element as RectangleElement, format, rotation);
    case 'image':
      return renderImage(element as ImageElement, rotation);
    default:
      return '';
  }
}

function resolveContent(element: TemplateElement, values: Record<string, string>): string {
  if (element.isStatic) {
    if ('content' in element) return element.content || '';
    return '';
  }

  const value = (element.fieldName && values[element.fieldName])
    || element.defaultValue
    || '';

  return `${element.prefix || ''}${value}${element.suffix || ''}`;
}

function renderText(element: TextElement, values: Record<string, string>, rotation: string): string {
  const content = resolveContent(element, values);
  if (!content) return '';

  const fontSize = element.fontSize / 72;
  const lineHeight = fontSize * (element.lineHeight || 1.2);
  const charW = fontSize * 0.5;
  const maxCharsPerLine = Math.max(1, Math.floor(element.width / charW));
  const lines = wrapText(content, maxCharsPerLine);
  const anchor = element.textAlign === 'center' ? 'middle' : element.textAlign === 'right' ? 'end' : 'start';
  const x = element.textAlign === 'center'
    ? element.x + element.width / 2
    : element.textAlign === 'right'
      ? element.x + element.width
      : element.x;
  const y = element.y + fontSize * 0.85;

  const tspans = lines.map((line, i) => (
    `<tspan x="${x}" y="${y + i * lineHeight}">${escapeHtml(line)}</tspan>`
  )).join('');

  return `<text font-family="${escapeAttr(element.fontFamily || 'Arial')}" font-size="${fontSize}" font-weight="${element.fontWeight}" text-anchor="${anchor}" fill="${escapeAttr(element.color || '#000000')}"${rotation}>${tspans}</text>`;
}

async function renderQr(element: QRElement, values: Record<string, string>, rotation: string): Promise<string> {
  const content = resolveContent(element, values);
  if (!content) return '';
  const dataUrl = await QRCode.toDataURL(content, {
    errorCorrectionLevel: element.errorCorrection,
    width: 512,
    margin: 0,
    color: { dark: '#000000', light: '#ffffff' },
  });
  return `<image href="${escapeAttr(dataUrl)}" x="${element.x}" y="${element.y}" width="${element.width}" height="${element.height}" preserveAspectRatio="xMidYMid meet"${rotation} />`;
}

function renderBarcode(element: BarcodeElement, values: Record<string, string>, rotation: string): string {
  const content = resolveContent(element, values);
  if (!content || typeof document === 'undefined') return '';

  try {
    const tempSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    JsBarcode(tempSvg, content, {
      format: element.barcodeFormat,
      width: 2,
      height: 80,
      displayValue: element.showText,
      margin: 0,
      fontSize: 14,
    });
    const w = tempSvg.getAttribute('width') || '200';
    const h = tempSvg.getAttribute('height') || '100';
    return `<svg x="${element.x}" y="${element.y}" width="${element.width}" height="${element.height}" viewBox="0 0 ${escapeAttr(w)} ${escapeAttr(h)}" preserveAspectRatio="xMidYMid meet"${rotation}>${tempSvg.innerHTML}</svg>`;
  } catch {
    return '';
  }
}

function renderLine(element: LineElement, format: LabelFormat, rotation: string): string {
  const sw = element.strokeWidth / 72;
  return `<line x1="${element.x}" y1="${element.y}" x2="${element.x + element.width}" y2="${element.y + element.height}" stroke="${escapeAttr(element.color || '#000000')}" stroke-width="${sw}"${rotation} />`;
}

function renderRectangle(element: RectangleElement, format: LabelFormat, rotation: string): string {
  const sw = element.strokeWidth / 72;
  const radius = element.borderRadius / 72;
  const fill = element.fillColor || 'none';
  return `<rect x="${element.x}" y="${element.y}" width="${element.width}" height="${element.height}" rx="${radius}" ry="${radius}" fill="${escapeAttr(fill)}" stroke="${escapeAttr(element.strokeColor || '#000000')}" stroke-width="${sw}"${rotation} />`;
}

function renderImage(element: ImageElement, rotation: string): string {
  const preserveAspectRatio = element.objectFit === 'fill'
    ? 'none'
    : element.objectFit === 'cover'
      ? 'xMidYMid slice'
      : 'xMidYMid meet';
  return `<image href="${escapeAttr(element.src)}" x="${element.x}" y="${element.y}" width="${element.width}" height="${element.height}" preserveAspectRatio="${preserveAspectRatio}"${rotation} />`;
}

function wrapText(text: string, maxCharsPerLine: number): string[] {
  if (text.length <= maxCharsPerLine) return [text];
  const lines: string[] = [];
  const words = text.split(' ');
  let current = '';

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxCharsPerLine) {
      current = next;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [text];
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(value: string): string {
  return escapeHtml(value);
}
