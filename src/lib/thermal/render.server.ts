import sharp from 'sharp';
import QRCode from 'qrcode';
import JsBarcode from 'jsbarcode';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import type { LabelFormat, LabelTemplate, TemplateElement, TextElement } from '../types';
import { thermalRenderGeometry } from './geometry';
import { BITMAP_VERSION, bitmapZpl, packMonochrome, rasterSize, resolveThermalContent, unpackMonochrome, type FeedValues } from './bitmap';

const hash = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');
const xml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]!));
const finite = (n: unknown, min: number, max: number, name: string) => {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max) throw new Error(`Invalid ${name}`);
  return n;
};
const colour = (s: string | undefined, fallback = '#000000') => {
  if (!s) return fallback;
  if (!/^#[a-f\d]{3}([a-f\d]{3})?$/i.test(s)) throw new Error('Use a hex artwork colour');
  return s;
};
const fontFamilies: Record<string, string> = { 'Liberation Sans': 'Sans', 'Liberation Serif': 'Serif', 'Liberation Mono': 'Mono' };

const fontFiles = new Map<string, Promise<Buffer>>();
function fontBytes(file: string) {
  if (!fontFiles.has(file)) fontFiles.set(file, readFile(file));
  return fontFiles.get(file)!;
}
// Reject missing glyphs instead of quietly using host-installed fallback fonts.
function hasGlyph(font: Buffer, cp: number) {
  let cmap = 0;
  for (let i = 0; i < font.readUInt16BE(4); i++) {
    const p = 12 + i * 16;
    if (font.toString('ascii', p, p + 4) === 'cmap') cmap = font.readUInt32BE(p + 8);
  }
  for (let i = 0; i < font.readUInt16BE(cmap + 2); i++) {
    const table = cmap + 4 + i * 8, sub = cmap + font.readUInt32BE(table + 4);
    const format = font.readUInt16BE(sub);
    if (format === 12) {
      for (let j = 0; j < font.readUInt32BE(sub + 12); j++) {
        const p = sub + 16 + j * 12, start = font.readUInt32BE(p), end = font.readUInt32BE(p + 4);
        if (cp >= start && cp <= end) return font.readUInt32BE(p + 8) + cp - start !== 0;
      }
    }
    if (format === 4 && cp <= 0xffff) {
      const n = font.readUInt16BE(sub + 6) / 2;
      for (let j = 0; j < n; j++) {
        const end = font.readUInt16BE(sub + 14 + j * 2), start = font.readUInt16BE(sub + 16 + n * 2 + j * 2);
        if (cp < start || cp > end) continue;
        const delta = font.readInt16BE(sub + 16 + n * 4 + j * 2), p = sub + 16 + n * 6 + j * 2, offset = font.readUInt16BE(p);
        if (!offset) return ((cp + delta) & 0xffff) !== 0;
        const glyph = font.readUInt16BE(p + offset + (cp - start) * 2);
        return glyph !== 0 && ((glyph + delta) & 0xffff) !== 0;
      }
    }
  }
  return false;
}
let fontIdentity: Promise<string> | null = null;
function fontsDigest() {
  if (!fontIdentity) fontIdentity = Promise.all(Object.values(fontFamilies).flatMap(family => ['Regular', 'Bold', 'Italic', 'BoldItalic'].map(style => fontBytes(path.join(process.cwd(), 'assets/thermal-fonts', `Liberation${family}-${style}.ttf`))))).then(files => hash(Buffer.concat(files)));
  return fontIdentity;
}

export function validateBitmapDesign(template: LabelTemplate, format: LabelFormat) {
  if (template.thermalRenderMode !== 'bitmap-v1' || format.type !== 'thermal') throw new Error('Bitmap rendering requires a bitmap thermal template');
  if (![203, 300, 600].includes(format.dpi || 203)) throw new Error('Choose 203, 300 or 600 DPI');
  finite(format.width, .01, 56, 'label width'); finite(format.height, .01, 20, 'label height');
  const across = finite(format.labelsAcross ?? 1, 1, 25, 'labels across');
  if (!Number.isInteger(across)) throw new Error('Labels across must be an integer');
  finite(format.horizontalGapThermal ?? 0, 0, 4, 'lane gap'); finite(format.sideMarginThermal ?? 0, 0, 4, 'side margin');
  if (format.linerWidth != null) finite(format.linerWidth, .01, 56, 'liner width');
  const geo = thermalRenderGeometry(format);
  const used = 2 * geo.effectiveSideMDots + across * geo.labelWDots + (across - 1) * Math.round((format.horizontalGapThermal || 0) * (format.dpi || 203));
  if (used > geo.linerDots + 1) throw new Error('Labels, margins and gaps exceed the liner width');
  rasterSize(geo.linerDots, geo.heightDots);
  if (!Array.isArray(template.elements) || template.elements.length > 200) throw new Error('Invalid template elements');
  const ids = new Set<string>();
  for (const e of template.elements) {
    if (!e || typeof e.id !== 'string' || ids.has(e.id)) throw new Error('Invalid element ID'); ids.add(e.id);
    if (!['text', 'qr', 'barcode', 'image', 'line', 'rectangle'].includes(e.type)) throw new Error('Unsupported artwork');
    finite(e.x, -12000, 12000, 'x'); finite(e.y, -12000, 12000, 'y'); finite(e.zIndex, -10000, 10000, 'layer');
    finite(e.width, 1, 12000, 'element width'); finite(e.height, 1, 12000, 'element height');
    if (![0, 90, 180, 270].includes(e.rotation)) throw new Error('Use right-angle artwork rotation');
    if (e.width * e.height > 12_000_000) throw new Error('Artwork is too large');
    for (const name of ['content', 'defaultValue', 'prefix', 'suffix', 'fieldName'] as const) {
      const value = (e as unknown as Record<string, unknown>)[name];
      if (value != null && (typeof value !== 'string' || value.length > 8192)) throw new Error(`Invalid ${name}`);
    }
  }
  return geo;
}

type Artwork = { png: Buffer; width: number; height: number };
async function textArtwork(e: TextElement, content: string, dpi: number): Promise<Artwork> {
  const family = fontFamilies[e.fontFamily];
  if (!family) throw new Error(`Font "${e.fontFamily}" is not bundled. Choose Liberation Sans, Serif or Mono.`);
  if (!['normal', 'bold'].includes(e.fontWeight) || !['normal', 'italic'].includes(e.fontStyle ?? 'normal')) throw new Error('Invalid font style');
  if (!['left', 'center', 'right'].includes(e.textAlign) || !['top', 'middle', 'bottom'].includes(e.verticalAlign ?? 'top')) throw new Error('Invalid text alignment');
  const style = `${e.fontWeight === 'bold' ? 'Bold' : ''}${e.fontStyle === 'italic' ? 'Italic' : ''}` || 'Regular';
  const fontfile = path.join(process.cwd(), 'assets', 'thermal-fonts', `Liberation${family}-${style}.ttf`);
  const font = await fontBytes(fontfile);
  for (const char of new Set(content)) if (!/\s/.test(char) && !hasGlyph(font, char.codePointAt(0)!)) throw new Error(`The bundled font has no glyph for ${char}`);
  const fontSize = finite(e.fontSize, .5, 200, 'font size');
  // Converted legacy text often omits this flag. Bitmap defaults to fitting the
  // complete value; an explicit false still requests strict fixed-size text.
  const min = e.autoFit !== false ? finite(e.minFontSize ?? Math.min(4, fontSize), .5, fontSize, 'minimum font size') : fontSize;
  const leading = finite(e.lineHeight ?? 1.2, .1, 10, 'line height');
  const tracking = finite(e.letterSpacing ?? 0, -20, 100, 'tracking');
  const scaleX = finite(e.charWidth ?? 1, .1, 3, 'character scale');
  let size = fontSize;
  for (;;) {
    const markup = `<span foreground="${colour(e.color)}" letter_spacing="${Math.round(tracking / scaleX * 1024)}" line_height="${leading}" fallback="false">${xml(content)}</span>`;
    const { data, info } = await sharp({ text: {
      text: markup, font: `Liberation ${family} ${style === 'Regular' ? '' : style.replace('BoldItalic', 'Bold Italic')} ${size}`,
      fontfile, dpi, width: Math.max(1, Math.floor(e.width / scaleX)), wrap: 'word-char', align: e.textAlign, rgba: true,
    } }).png().toBuffer({ resolveWithObject: true });
    const width = Math.max(1, Math.round(info.width * scaleX));
    if (width <= Math.round(e.width) && info.height <= Math.round(e.height)) {
      return { png: scaleX === 1 ? data : await sharp(data).resize(width, info.height).png().toBuffer(), width, height: info.height };
    }
    if (size <= min) throw new Error('Text overflows its box. Enlarge the box, reduce type size, or enable Auto-fit.');
    size = Math.max(min, Math.round((size - .25) * 100) / 100);
  }
}

async function symbolArtwork(e: Extract<TemplateElement, { type: 'qr' | 'barcode' }>, value: string, dpi: number): Promise<Artwork> {
  const width = Math.round(e.width), height = Math.round(e.height);
  let shapes = '';
  if (e.type === 'qr') {
    if (!['L', 'M', 'Q', 'H'].includes(e.errorCorrection)) throw new Error('Invalid QR correction');
    const qr = QRCode.create(value, { errorCorrectionLevel: e.errorCorrection });
    const modules = qr.modules.size, scale = Math.floor(Math.min(width, height) / (modules + 8));
    if (scale < 1) throw new Error(`QR needs at least ${modules + 8} dots including its quiet zone`);
    const x0 = Math.floor((width - (modules + 8) * scale) / 2) + 4 * scale;
    const y0 = Math.floor((height - (modules + 8) * scale) / 2) + 4 * scale;
    for (let y = 0; y < modules; y++) for (let x = 0; x < modules; x++) if (qr.modules.get(y, x)) shapes += `<rect x="${x0 + x * scale}" y="${y0 + y * scale}" width="${scale}" height="${scale}"/>`;
  } else {
    if (!['CODE128', 'CODE39', 'UPC', 'EAN13', 'EAN8', 'ITF14'].includes(e.barcodeFormat)) throw new Error('Unsupported barcode');
    const target = {} as { encodings?: Array<{ data: string }> };
    JsBarcode(target, value, { format: e.barcodeFormat, displayValue: false, margin: 0, width: 1 });
    const bits = target.encodings?.map(v => v.data).join('') || '';
    if (!bits || /[^01]/.test(bits)) throw new Error('Invalid barcode content');
    const scale = Math.floor(width / (bits.length + 20)), textHeight = e.showText ? Math.round(10 * dpi / 72) : 0;
    if (scale < 1 || height - textHeight < 8) throw new Error('Barcode box is too small for whole-dot modules and quiet zones');
    const left = Math.floor((width - bits.length * scale) / 2);
    for (let i = 0; i < bits.length; i++) if (bits[i] === '1') shapes += `<rect x="${left + i * scale}" y="0" width="${scale}" height="${height - textHeight}"/>`;
  }
  const base = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="white"/><g fill="black">${shapes}</g></svg>`)).png().toBuffer();
  if (e.type === 'barcode' && e.showText) {
    const label = await textArtwork({ ...e, type: 'text', fontFamily: 'Liberation Sans', fontSize: 8, minFontSize: 4, autoFit: true, fontWeight: 'normal', textAlign: 'center', color: '#000000', lineHeight: 1, height: Math.round(10 * dpi / 72) }, value, dpi);
    return { png: await sharp(base).composite([{ input: label.png, left: Math.floor((width - label.width) / 2), top: height - label.height }]).png().toBuffer(), width, height };
  }
  return { png: base, width, height };
}

async function elementArtwork(e: TemplateElement, values: Record<string, string>, dpi: number): Promise<Artwork | null> {
  const width = Math.round(e.width), height = Math.round(e.height);
  if (e.type === 'text' || e.type === 'qr' || e.type === 'barcode') {
    const value = resolveThermalContent(e, values);
    if (!value.trim()) { if (e.type !== 'text') throw new Error('Missing QR/barcode value'); return null; }
    if (value.length > 8192 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) throw new Error('Unsupported control character or oversized content');
    if (e.type === 'text') {
      const text = await textArtwork(e, value, dpi);
      const left = e.textAlign === 'center' ? Math.floor((width - text.width) / 2) : e.textAlign === 'right' ? width - text.width : 0;
      const top = e.verticalAlign === 'middle' ? Math.floor((height - text.height) / 2) : e.verticalAlign === 'bottom' ? height - text.height : 0;
      return { png: await sharp({ create: { width, height, channels: 4, background: '#00000000' } }).composite([{ input: text.png, left, top }]).png().toBuffer(), width, height };
    }
    return symbolArtwork(e, value, dpi);
  }
  if (e.type === 'image') {
    if (!e.src) throw new Error('Image is missing');
    const match = /^data:image\/(png|jpeg|webp|svg\+xml);base64,([A-Za-z0-9+/=\s]+)$/.exec(e.src);
    if (!match || e.src.length > 6_000_000 || !['contain', 'cover', 'fill'].includes(e.objectFit)) throw new Error('Use a valid embedded image');
    const bytes = Buffer.from(match[2], 'base64');
    if (match[1] === 'svg+xml' && /<!|href|url\s*\(|<script|<foreignObject|&|@import|\\/i.test(bytes.toString())) throw new Error('Flatten SVG references before printing');
    return { png: await sharp(bytes, { limitInputPixels: 16_000_000 }).resize(width, height, { fit: e.objectFit, background: '#00000000' }).png().toBuffer(), width, height };
  }
  const stroke = finite(e.strokeWidth, 0, 100, 'stroke width') * dpi / 72;
  const shape = e.type === 'line'
    ? `<line x1="${stroke / 2}" y1="${stroke / 2}" x2="${width - stroke / 2}" y2="${height - stroke / 2}" stroke="${colour(e.color)}" stroke-width="${stroke}"/>`
    : `<rect x="${stroke / 2}" y="${stroke / 2}" width="${Math.max(0, width - stroke)}" height="${Math.max(0, height - stroke)}" rx="${finite(e.borderRadius, 0, 1000, 'corner radius')}" fill="${e.fillColor ? colour(e.fillColor) : 'none'}" stroke="${colour(e.strokeColor)}" stroke-width="${stroke}"/>`;
  return { png: await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${shape}</svg>`)).png().toBuffer(), width, height };
}

export async function renderThermalBitmap(template: LabelTemplate, format: LabelFormat, fieldValues: FeedValues = {}) {
  const geo = validateBitmapDesign(template, format), across = format.labelsAcross || 1, dpi = format.dpi || 203;
  const lanes = Array.isArray(fieldValues) ? Array.from({ length: across }, (_, i) => fieldValues[i] ?? null) : Array.from({ length: across }, () => fieldValues);
  for (const lane of lanes) if (lane != null && (typeof lane !== 'object' || Array.isArray(lane) || Object.values(lane).some(v => typeof v !== 'string' || v.length > 8192))) throw new Error('Invalid resolved values');
  const inputDigest = hash(JSON.stringify({ version: BITMAP_VERSION, engine: sharp.versions, platform: process.platform, arch: process.arch, fonts: await fontsDigest(), elements: template.elements, format, lanes }));
  const feedLayers: sharp.OverlayOptions[] = [];
  // Same static artwork/values are prepared once per feed, with a bounded cache.
  const artwork = new Map<string, Artwork | null>();
  for (let laneIndex = 0; laneIndex < across; laneIndex++) {
    const values = lanes[laneIndex];
    if (values == null) continue;
    const layers: sharp.OverlayOptions[] = [];
    for (const e of [...template.elements].sort((a, b) => a.zIndex - b.zIndex)) {
      try {
        const key = JSON.stringify([e, resolveThermalContent(e, values)]);
        let art = artwork.get(key);
        if (art === undefined) { art = await elementArtwork(e, values, dpi); artwork.set(key, art); }
        if (!art) continue;
        let { png, width, height } = art;
        let left = Math.round(e.x), top = Math.round(e.y);
        if (e.rotation) {
          const rotated = await sharp(png).rotate(e.rotation, { background: '#00000000' }).png().toBuffer({ resolveWithObject: true });
          png = rotated.data; width = rotated.info.width; height = rotated.info.height;
          if (e.type === 'text') {
            if (e.rotation === 90) left -= art.height;
            if (e.rotation === 180) { left -= art.width; top -= art.height; }
            if (e.rotation === 270) top -= art.width;
          } else { left += Math.round((art.width - width) / 2); top += Math.round((art.height - height) / 2); }
        }
        // Crop to this label only; graphics cannot bleed into the next lane.
        const cropX = Math.max(0, -left), cropY = Math.max(0, -top);
        const cropW = Math.min(width - cropX, geo.labelWDots - Math.max(0, left));
        const cropH = Math.min(height - cropY, geo.heightDots - Math.max(0, top));
        if (cropW <= 0 || cropH <= 0) throw new Error('Artwork is entirely outside the label');
        if (e.type === 'text' && (cropW !== width || cropH !== height)) {
          // Legacy boxes can extend beyond the label while all their ink fits.
          // Reject lost text pixels, not harmless transparent box padding.
          const raw = await sharp(png).ensureAlpha().raw().toBuffer();
          const ink = packMonochrome(raw, width, height), stride = Math.ceil(width / 8);
          for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
            if ((x < cropX || x >= cropX + cropW || y < cropY || y >= cropY + cropH) && (ink[y * stride + (x >> 3)] & (128 >> (x % 8)))) throw new Error('Text extends outside the label. Move or resize it before printing');
          }
        }
        if ((e.type === 'qr' || e.type === 'barcode') && (cropW !== width || cropH !== height)) throw new Error('Symbol or quiet zone is clipped by the label edge');
        if (cropW !== width || cropH !== height) png = await sharp(png).extract({ left: cropX, top: cropY, width: cropW, height: cropH }).png().toBuffer();
        layers.push({ input: png, left: Math.max(0, left), top: Math.max(0, top) });
      } catch (error) { throw new Error(`Lane ${laneIndex + 1}, ${e.fieldName || e.id}: ${error instanceof Error ? error.message : 'Artwork failed'}`); }
    }
    const label = await sharp({ create: { width: geo.labelWDots, height: geo.heightDots, channels: 4, background: 'white' } }).composite(layers).png().toBuffer();
    feedLayers.push({ input: label, left: geo.effectiveSideMDots + laneIndex * (geo.labelWDots + Math.round((format.horizontalGapThermal || 0) * dpi)), top: 0 });
  }
  const rgba = await sharp({ create: { width: geo.linerDots, height: geo.heightDots, channels: 4, background: 'white' } }).composite(feedLayers).raw().toBuffer();
  const packed = packMonochrome(rgba, geo.linerDots, geo.heightDots), pixelDigest = hash(packed);
  const pixels = unpackMonochrome(packed, geo.linerDots, geo.heightDots);
  const png = await sharp(Buffer.from(pixels), { raw: { width: geo.linerDots, height: geo.heightDots, channels: 4 } }).png().toBuffer();
  return { version: BITMAP_VERSION, width: geo.linerDots, height: geo.heightDots, inputDigest, pixelDigest, packed: Buffer.from(packed).toString('base64'), proof: `data:image/png;base64,${png.toString('base64')}`, zpl: bitmapZpl(packed, geo.linerDots, geo.heightDots, inputDigest, pixelDigest) };
}
