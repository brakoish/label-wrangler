import type { TemplateElement } from '../types';
export function artworkBounds(e: TemplateElement) {
  const { x, y, width: w, height: h } = e;
  if (e.type === 'text') {
    if (e.rotation === 90) return { x: x - h, y, width: h, height: w };
    if (e.rotation === 180) return { x: x - w, y: y - h, width: w, height: h };
    if (e.rotation === 270) return { x, y: y - w, width: h, height: w };
  } else if (e.rotation === 90 || e.rotation === 270) return { x: x + (w - h) / 2, y: y + (h - w) / 2, width: h, height: w };
  return { x, y, width: w, height: h };
}
export function nearestSnap(edges: number[], targets: number[], tolerance: number) {
  let delta = 0, guide: number | undefined, distance = tolerance;
  for (const edge of edges) for (const target of targets) if (Math.abs(target - edge) < distance) {
    distance = Math.abs(target - edge); delta = target - edge; guide = target;
  }
  return { delta, guide };
}
export type AlignAction = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom' | 'distribute-x' | 'distribute-y';
export function arrangeElements(elements: TemplateElement[], action: AlignAction) {
  if (elements.length < 2) return elements;
  const records = elements.map(e => ({ e, b: artworkBounds(e) }));
  const minX = Math.min(...records.map(r => r.b.x)), minY = Math.min(...records.map(r => r.b.y));
  const maxX = Math.max(...records.map(r => r.b.x + r.b.width)), maxY = Math.max(...records.map(r => r.b.y + r.b.height));
  if (action.startsWith('distribute')) {
    if (records.length < 3) return elements;
    const horizontal = action === 'distribute-x', pos = horizontal ? 'x' : 'y', size = horizontal ? 'width' : 'height';
    records.sort((a, b) => a.b[pos] - b.b[pos]);
    const start = records[0].b[pos], last = records[records.length - 1];
    const gap = (last.b[pos] + last.b[size] - start - records.reduce((n, r) => n + r.b[size], 0)) / (records.length - 1);
    let next = start;
    return records.map(({ e, b }) => { const moved = { ...e, [pos]: e[pos] + next - b[pos] }; next += b[size] + gap; return moved; });
  }
  return records.map(({ e, b }) => ({ ...e,
    x: e.x + (action === 'left' ? minX - b.x : action === 'center' ? (minX + maxX - b.width) / 2 - b.x : action === 'right' ? maxX - b.width - b.x : 0),
    y: e.y + (action === 'top' ? minY - b.y : action === 'middle' ? (minY + maxY - b.height) / 2 - b.y : action === 'bottom' ? maxY - b.height - b.y : 0),
  }));
}

// Handles follow the visible (rotated) box. Convert back to saved origins only once.
export function resizeArtwork(e: TemplateElement, handle: string, dx: number, dy: number, scaleType: boolean) {
  const b = artworkBounds(e);
  let width = Math.max(1, b.width + (handle.includes('e') ? dx : handle.includes('w') ? -dx : 0));
  let height = Math.max(1, b.height + (handle.includes('s') ? dy : handle.includes('n') ? -dy : 0));
  if ((e.type === 'qr' || (e.type === 'text' && scaleType)) && handle.length === 2) {
    const scale = Math.max(width / b.width, height / b.height);
    width = b.width * scale; height = b.height * scale;
  }
  const x = b.x + (handle.includes('w') ? b.width - width : 0);
  const y = b.y + (handle.includes('n') ? b.height - height : 0);
  const swapped = e.rotation === 90 || e.rotation === 270;
  const w = swapped ? height : width, h = swapped ? width : height;
  let originX = x, originY = y;
  if (e.type === 'text') {
    if (e.rotation === 90) originX += h;
    if (e.rotation === 180) { originX += w; originY += h; }
    if (e.rotation === 270) originY += w;
  } else { originX += (width - w) / 2; originY += (height - h) / 2; }
  return { x: originX, y: originY, width: w, height: h,
    ...(e.type === 'text' && scaleType && handle.length === 2 ? { fontSize: Math.max(.5, Math.round(e.fontSize * w / e.width * 100) / 100) } : {}),
  };
}
