import type { LabelFormat, LabelTemplate, TemplateElement } from '../types';

export const BITMAP_FONTS = ['Liberation Sans', 'Liberation Serif', 'Liberation Mono'];
export function bitmapCopy(template: LabelTemplate) {
  return { ...template, thermalRenderMode: 'bitmap-v1' as const, elements: template.elements.map(e => e.type === 'text' ? {
    ...e, fontFamily: BITMAP_FONTS.includes(e.fontFamily) ? e.fontFamily : /Courier|Mono/i.test(e.fontFamily) ? 'Liberation Mono' : /Times|Georgia|Serif/i.test(e.fontFamily) ? 'Liberation Serif' : 'Liberation Sans',
    // Native charWidth is an approximate Zebra glyph metric, not font tracking.
    charWidth: 1,
  } : { ...e }) };
}

// Explicit importer for Natural v1 JSON only. Not arbitrary ZPL/ZebraDesigner.
export function importNaturalDesign(data: unknown): { template: LabelTemplate; format: LabelFormat; report: string[] } {
  if (!data || typeof data !== 'object') throw new Error('Expected a Natural v1 design');
  const d = data as Record<string, unknown>;
  if (d.version !== 1 || typeof d.name !== 'string' || d.name.length > 100 || !Array.isArray(d.elements) || d.elements.length > 150 || ![203, 300, 600].includes(Number(d.dpi))) throw new Error('Unsupported Natural design');
  const number = (v: unknown, name: string, min = 0, max = 12000) => { if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new Error(`Invalid ${name}`); return v; };
  const dpi = Number(d.dpi), width = number(d.width, 'label width', .25, 8), height = number(d.height, 'label height', .25, 12);
  if (width * height * dpi * dpi > 12_000_000) throw new Error('Label bitmap is too large');
  const now = new Date().toISOString();
  const format: LabelFormat = { id: 'import-format', name: `${width} × ${height} thermal · ${dpi} DPI`, type: 'thermal', width, height, dpi, labelsAcross: 1, createdAt: now, updatedAt: now };
  const report = ['Arial is approximated with bundled Liberation Sans. Review the proof before printing.', 'Objects remain editable and static. Bind fields explicitly after reviewing this reconstruction.', 'QR/barcode sizes include whole-dot modules and quiet zones; symbols are regenerated, not stretched.'];
  const elements: TemplateElement[] = d.elements.map((raw, i) => {
    if (!raw || typeof raw !== 'object') throw new Error('Invalid source element');
    const e = raw as Record<string, unknown>;
    const base = { id: `import-${i}`, x: number(e.x, 'x'), y: number(e.y, 'y'), width: number(e.w, 'width', 1), height: number(e.h, 'height', 1), rotation: 0, zIndex: i, isStatic: true };
    const content = typeof e.text === 'string' && e.text.length <= 8192 ? e.text : '';
    if (['text', 'qr', 'barcode'].includes(String(e.type)) && typeof e.text !== 'string') throw new Error('Missing text/symbol value');
    switch (e.type) {
      case 'text': {
        const family = typeof e.family === 'string' ? e.family : 'Arial';
        if (!['Arial', 'Helvetica', 'Times New Roman', 'Courier New', ...BITMAP_FONTS].includes(family)) throw new Error(`Unsupported source font: ${family}`);
        const fontFamily = BITMAP_FONTS.includes(family) ? family : family === 'Times New Roman' ? 'Liberation Serif' : family === 'Courier New' ? 'Liberation Mono' : 'Liberation Sans';
        if (!['left', 'center', 'right'].includes(String(e.align ?? 'left')) || !['top', 'middle', 'bottom'].includes(String(e.valign ?? 'top'))) throw new Error('Invalid source alignment');
        return { ...base, type: 'text', content, fontFamily, fontSize: number(e.font, 'font', 1, 500) * 72 / dpi, fontWeight: e.bold ? 'bold' : 'normal', fontStyle: e.italic ? 'italic' : 'normal', textAlign: (e.align ?? 'left') as 'left' | 'center' | 'right', verticalAlign: (e.valign ?? 'top') as 'top' | 'middle' | 'bottom', lineHeight: number(e.leading ?? 1.2, 'leading', .1, 10), letterSpacing: number(e.tracking ?? 0, 'tracking', -20, 100), charWidth: 1, color: '#000000' };
      }
      case 'box': return { ...base, type: 'rectangle', strokeWidth: number(e.stroke, 'stroke', 0, 100) * 72 / dpi, strokeColor: '#000000', fillColor: '', borderRadius: 0 };
      case 'line': return { ...base, type: 'rectangle', strokeWidth: 0, strokeColor: '#000000', fillColor: '#000000', borderRadius: 0 };
      case 'qr': return { ...base, type: 'qr', content, errorCorrection: 'M' };
      case 'barcode': return { ...base, type: 'barcode', content, barcodeFormat: 'CODE128', showText: false };
      case 'image':
        if (typeof e.src !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/=\s]+$/.test(e.src) || e.src.length > 4_000_000) throw new Error('Invalid embedded PNG');
        return { ...base, type: 'image', src: e.src, objectFit: 'fill' };
      default: throw new Error(`Unsupported Natural element: ${e.type}`);
    }
  });
  return { template: { id: 'import-template', name: d.name, formatId: format.id, thermalRenderMode: 'bitmap-v1', elements, createdAt: now, updatedAt: now }, format, report };
}
