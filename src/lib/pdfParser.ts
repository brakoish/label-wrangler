import { ParsedLabelSpec } from './types';
import { PDFDocument } from 'pdf-lib';
import pako from 'pako';

export interface PDFParseResult {
  success: boolean;
  spec?: ParsedLabelSpec;
  error?: string;
  method?: 'vector-re' | 'vector-cm' | 'canvas';
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Parse a PDF label template to detect grid layout.
 *
 * Tries three methods in order:
 * 1. Vector `re` operators (exact rectangle commands)
 * 2. Vector `cm` transforms (repeated label positioning)
 * 3. Canvas rendering + visual grid detection (universal fallback)
 */
export async function parsePDFFile(file: File): Promise<PDFParseResult> {
  const arrayBuffer = await file.arrayBuffer();

  // Get page dimensions via pdf-lib
  let pageWidthIn: number, pageHeightIn: number;
  let streamText: string | null = null;

  try {
    const pdfDoc = await PDFDocument.load(arrayBuffer);
    const page = pdfDoc.getPage(0);
    const { width, height } = page.getSize();
    pageWidthIn = width / 72;
    pageHeightIn = height / 72;

    // Try to decompress the content stream
    const contentStream = page.node.Contents();
    if (contentStream) {
      const rawBytes = (contentStream as any).contents as Uint8Array;
      if (rawBytes && rawBytes.length > 0) {
        try {
          const decoded = pako.inflate(rawBytes);
          streamText = new TextDecoder('latin1').decode(decoded);
        } catch {
          streamText = new TextDecoder('latin1').decode(rawBytes);
        }
      }
    }
  } catch (err) {
    return { success: false, error: 'Failed to load PDF: ' + (err instanceof Error ? err.message : String(err)) };
  }

  // --- Method 1: `re` rectangle operators ---
  if (streamText) {
    const result = tryVectorRects(streamText, pageWidthIn, pageHeightIn);
    if (result) return { success: true, spec: result, method: 'vector-re' };
  }

  // --- Method 2: `cm` transform-based grid ---
  if (streamText) {
    const result = tryTransformGrid(streamText, pageWidthIn, pageHeightIn);
    if (result) return { success: true, spec: result, method: 'vector-cm' };
  }

  // --- Method 3: Canvas rendering fallback ---
  try {
    const result = await tryCanvasFallback(arrayBuffer, pageWidthIn, pageHeightIn);
    if (result) return { success: true, spec: result, method: 'canvas' };
  } catch (err) {
    console.error('Canvas fallback error:', err);
  }

  return {
    success: false,
    error: 'Could not detect label outlines. This PDF may not be a label sheet template.',
  };
}

// ============================================================
// Method 1: Extract `re` rectangle operators
// ============================================================
function tryVectorRects(streamText: string, pageW: number, pageH: number): ParsedLabelSpec | null {
  if (!streamText.includes(' re')) return null;

  // Parse global transform
  const { scaleX, scaleY, translateX, yFlipped } = parseGlobalTransform(streamText);

  const rePattern = /(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s+re/g;
  const rects: Rect[] = [];
  let match;

  while ((match = rePattern.exec(streamText)) !== null) {
    const rawX = parseFloat(match[1]);
    const rawY = parseFloat(match[2]);
    const rawW = parseFloat(match[3]);
    const rawH = parseFloat(match[4]);

    // Normalize negative widths/heights: x,y is the start point,
    // w,h can be negative meaning the rect extends left/up
    const normX = rawW < 0 ? rawX + rawW : rawX;
    const normY = rawH < 0 ? rawY + rawH : rawY;
    const normW = Math.abs(rawW);
    const normH = Math.abs(rawH);

    const ptsX = normX * scaleX + translateX;
    const ptsW = normW * scaleX;
    const ptsH = normH * scaleY;
    const ptsY = normY * scaleY;

    const inX = ptsX / 72;
    const inY = Math.abs(ptsY) / 72;
    const inW = ptsW / 72;
    const inH = ptsH / 72;

    if (inW < 0.1 || inH < 0.1) continue;
    if (inW > pageW * 0.95 && inH > pageH * 0.95) continue;

    rects.push({ x: inX, y: inY, w: inW, h: inH });
  }

  if (rects.length < 4) return null;
  return buildSpecFromRects(rects, pageW, pageH);
}

// ============================================================
// Method 2: Extract label grid from repeated `cm` transforms
// ============================================================
function tryTransformGrid(streamText: string, pageW: number, pageH: number): ParsedLabelSpec | null {
  // Find all identity-scale transforms: 1 0 0 1 X Y cm
  const cmPattern = /1\s+0\s+0\s+1\s+(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s+cm/g;
  const positions: Array<{ x: number; y: number }> = [];
  let match;

  while ((match = cmPattern.exec(streamText)) !== null) {
    positions.push({ x: parseFloat(match[1]), y: parseFloat(match[2]) });
  }

  if (positions.length < 4) return null;

  const uniqueX = clusterValues(positions.map((p) => p.x / 72), 0.03);
  const uniqueY = clusterValues(positions.map((p) => p.y / 72), 0.03);
  uniqueX.sort((a, b) => a - b);
  uniqueY.sort((a, b) => b - a);

  const cols = uniqueX.length;
  const rows = uniqueY.length;
  if (cols < 2 || rows < 2) return null;

  const xSpacing = uniqueX[1] - uniqueX[0];
  const ySpacing = Math.abs(uniqueY[1] - uniqueY[0]);

  // Estimate label size from path bounding box after first cm
  let labelW = xSpacing;
  let labelH = ySpacing;

  // Extract label dimensions from the path drawn after the first cm transform.
  // The path is enclosed in q...Q (save/restore). We only want coordinates
  // within the cm's scope — stop at the first S (stroke), f (fill), or Q (restore).
  const firstCmStr = `1 0 0 1 ${positions[0].x}`;
  const firstCmIdx = streamText.indexOf(firstCmStr);
  if (firstCmIdx > -1) {
    // Get text from cm to end of its scope (next S, f, or Q on its own line)
    const afterCm = streamText.substring(firstCmIdx + firstCmStr.length + 4); // skip past "cm\n"
    const scopeEnd = afterCm.search(/\n[SfQ]\s*\n|\nS\n|\nh\nS/);
    const scopeText = scopeEnd > -1 ? afterCm.substring(0, scopeEnd + 2) : afterCm.substring(0, 300);

    const coordPattern = /(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s+[mlc]/g;
    let maxX = 0, maxY = 0;
    let cm;
    while ((cm = coordPattern.exec(scopeText)) !== null) {
      const px = Math.abs(parseFloat(cm[1]));
      const py = Math.abs(parseFloat(cm[2]));
      if (px > maxX && px < 500) maxX = px;
      if (py > maxY && py < 500) maxY = py;
    }
    if (maxX > 10) labelW = maxX / 72;
    if (maxY > 10) labelH = maxY / 72;
  }

  const hGap = Math.max(0, round(xSpacing - labelW));
  const vGap = Math.max(0, round(ySpacing - labelH));
  const topMargin = round(pageH - Math.max(...uniqueY) - labelH);
  const sideMargin = round(uniqueX[0]);

  return {
    type: 'sheet',
    width: round(labelW),
    height: round(labelH),
    sheetWidth: round(pageW),
    sheetHeight: round(pageH),
    columns: cols,
    rows,
    topMargin: Math.max(0, topMargin),
    sideMargin: Math.max(0, sideMargin),
    horizontalGap: hGap,
    verticalGap: vGap,
    confidence: cols * rows >= positions.length * 0.8 ? 'high' : 'medium',
  };
}

// ============================================================
// Method 3: Canvas rendering + visual grid detection
// ============================================================
async function tryCanvasFallback(
  arrayBuffer: ArrayBuffer,
  pageW: number,
  pageH: number
): Promise<ParsedLabelSpec | null> {
  const pdfjsLib = await import('pdfjs-dist');
  pdfjsLib.GlobalWorkerOptions.workerSrc = `/pdf.worker.min.mjs`;

  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer, verbosity: 0 }).promise;
  const page = await pdf.getPage(1);

  // Render at 4x for tiny labels
  const scale = 4.0;
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext('2d')!;

  // White background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  await page.render({ canvasContext: ctx, viewport }).promise;

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { data, width, height } = imageData;

  // Build horizontal and vertical density profiles
  // For each column, count the fraction of dark pixels
  const colDensity = new Float32Array(width);
  for (let x = 0; x < width; x++) {
    let dark = 0;
    for (let y = 0; y < height; y++) {
      const i = (y * width + x) * 4;
      const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;
      if (brightness < 200) dark++;
    }
    colDensity[x] = dark / height;
  }

  const rowDensity = new Float32Array(height);
  for (let y = 0; y < height; y++) {
    let dark = 0;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;
      if (brightness < 200) dark++;
    }
    rowDensity[y] = dark / width;
  }

  // Find the dominant period in each density profile using autocorrelation
  const colPeriod = findDominantPeriod(colDensity, 20, width / 2);
  const rowPeriod = findDominantPeriod(rowDensity, 20, height / 2);

  if (!colPeriod || !rowPeriod) return null;

  // Convert pixel periods to inches
  const pxPerInch = width / pageW;
  const labelPlusGapW = colPeriod / pxPerInch;
  const labelPlusGapH = rowPeriod / pxPerInch;

  // Find where labels start (first significant dark band)
  const firstCol = findFirstEdge(colDensity, 0.02);
  const firstRow = findFirstEdge(rowDensity, 0.02);

  const sideMargin = firstCol !== null ? firstCol / pxPerInch : 0.2;
  const topMargin = firstRow !== null ? firstRow / (height / pageH) : 0.5;

  // Estimate gap from the profile: find the minimum density within one period
  const colGapFraction = estimateGapFraction(colDensity, colPeriod, firstCol || 0);
  const rowGapFraction = estimateGapFraction(rowDensity, rowPeriod, firstRow || 0);

  const hGap = labelPlusGapW * colGapFraction;
  const vGap = labelPlusGapH * rowGapFraction;
  const labelW = labelPlusGapW - hGap;
  const labelH = labelPlusGapH - vGap;

  // Count how many periods fit
  const usableW = pageW - sideMargin * 2;
  const usableH = pageH - topMargin * 2;
  const cols = Math.max(1, Math.round(usableW / labelPlusGapW));
  const rows = Math.max(1, Math.round(usableH / labelPlusGapH));

  if (cols < 1 || rows < 1 || labelW < 0.1 || labelH < 0.1) return null;

  return {
    type: 'sheet',
    width: round(labelW),
    height: round(labelH),
    sheetWidth: round(pageW),
    sheetHeight: round(pageH),
    columns: cols,
    rows,
    topMargin: round(topMargin),
    sideMargin: round(sideMargin),
    horizontalGap: round(hGap),
    verticalGap: round(vGap),
    confidence: 'medium',
  };
}

/**
 * Find the dominant repeating period in a density profile using autocorrelation.
 */
function findDominantPeriod(
  density: Float32Array,
  minPeriod: number,
  maxPeriod: number
): number | null {
  const n = density.length;
  let bestPeriod = 0;
  let bestCorr = -1;

  for (let period = minPeriod; period <= Math.min(maxPeriod, n / 2); period++) {
    let corr = 0;
    let count = 0;
    for (let i = 0; i < n - period; i++) {
      corr += density[i] * density[i + period];
      count++;
    }
    corr /= count;

    if (corr > bestCorr) {
      bestCorr = corr;
      bestPeriod = period;
    }
  }

  return bestPeriod > 0 ? bestPeriod : null;
}

/**
 * Find the first position where density exceeds threshold (label edge start).
 */
function findFirstEdge(density: Float32Array, threshold: number): number | null {
  for (let i = 0; i < density.length; i++) {
    if (density[i] > threshold) return i;
  }
  return null;
}

/**
 * Estimate what fraction of a period is gap vs label by looking at density.
 */
function estimateGapFraction(
  density: Float32Array,
  period: number,
  startOffset: number
): number {
  // Average the density profile over multiple periods
  const avgProfile = new Float32Array(Math.round(period));
  let periods = 0;

  for (let start = startOffset; start + period < density.length; start += period) {
    for (let i = 0; i < Math.round(period); i++) {
      avgProfile[i] += density[start + i];
    }
    periods++;
  }

  if (periods === 0) return 0;
  for (let i = 0; i < avgProfile.length; i++) avgProfile[i] /= periods;

  // Find the fraction that's below a threshold (the gap region)
  const maxDensity = Math.max(...avgProfile);
  const threshold = maxDensity * 0.2;
  let gapPixels = 0;
  for (let i = 0; i < avgProfile.length; i++) {
    if (avgProfile[i] < threshold) gapPixels++;
  }

  return Math.min(0.4, gapPixels / avgProfile.length); // cap at 40% gap
}

// ============================================================
// Shared helpers
// ============================================================

function parseGlobalTransform(streamText: string) {
  let scaleX = 1, scaleY = 1, translateX = 0, yFlipped = false;

  const cmMatch = streamText.match(
    /([.\d-]+)\s+([.\d-]+)\s+([.\d-]+)\s+([.\d-]+)\s+([.\d-]+)\s+([.\d-]+)\s+cm/
  );
  if (cmMatch) {
    scaleX = Math.abs(parseFloat(cmMatch[1]));
    scaleY = Math.abs(parseFloat(cmMatch[4]));
    translateX = parseFloat(cmMatch[5]);
    yFlipped = parseFloat(cmMatch[4]) < 0;
  }

  return { scaleX, scaleY, translateX, yFlipped };
}

function buildSpecFromRects(rects: Rect[], pageW: number, pageH: number): ParsedLabelSpec | null {
  const sizeClusters = clusterBySize(rects, 0.03);
  sizeClusters.sort((a, b) => b.rects.length - a.rects.length);

  const labelCluster = sizeClusters[0];
  if (labelCluster.rects.length < 4) return null;

  const labelW = labelCluster.avgW;
  const labelH = labelCluster.avgH;
  const labelRects = labelCluster.rects;

  const xPositions = clusterValues(labelRects.map((r) => r.x), 0.03);
  const yPositions = clusterValues(labelRects.map((r) => r.y), 0.03);
  xPositions.sort((a, b) => a - b);
  yPositions.sort((a, b) => a - b);

  const columns = xPositions.length;
  const rows = yPositions.length;

  const sideMargin = xPositions[0];
  const topMargin = yPositions[0];

  let horizontalGap = 0;
  if (xPositions.length >= 2) {
    horizontalGap = Math.max(0, xPositions[1] - xPositions[0] - labelW);
  }
  let verticalGap = 0;
  if (yPositions.length >= 2) {
    verticalGap = Math.max(0, yPositions[1] - yPositions[0] - labelH);
  }

  const expectedCount = columns * rows;
  let confidence: 'high' | 'medium' | 'low' = 'low';
  if (labelRects.length >= expectedCount * 0.9 && columns >= 2 && rows >= 2) {
    confidence = 'high';
  } else if (labelRects.length >= 4) {
    confidence = 'medium';
  }

  return {
    type: 'sheet',
    width: round(labelW),
    height: round(labelH),
    sheetWidth: round(pageW),
    sheetHeight: round(pageH),
    columns,
    rows,
    topMargin: round(topMargin),
    sideMargin: round(sideMargin),
    horizontalGap: round(horizontalGap),
    verticalGap: round(verticalGap),
    confidence,
  };
}

interface SizeCluster {
  avgW: number;
  avgH: number;
  rects: Rect[];
}

function clusterBySize(rects: Rect[], tolerance: number): SizeCluster[] {
  const clusters: SizeCluster[] = [];
  for (const rect of rects) {
    let matched = false;
    for (const cluster of clusters) {
      if (Math.abs(rect.w - cluster.avgW) < tolerance && Math.abs(rect.h - cluster.avgH) < tolerance) {
        cluster.rects.push(rect);
        const n = cluster.rects.length;
        cluster.avgW = cluster.rects.reduce((s, r) => s + r.w, 0) / n;
        cluster.avgH = cluster.rects.reduce((s, r) => s + r.h, 0) / n;
        matched = true;
        break;
      }
    }
    if (!matched) {
      clusters.push({ avgW: rect.w, avgH: rect.h, rects: [rect] });
    }
  }
  return clusters;
}

function clusterValues(values: number[], tolerance: number): number[] {
  if (values.length === 0) return [];
  const sorted = [...values].sort((a, b) => a - b);
  const clusters: number[][] = [[sorted[0]]];

  for (let i = 1; i < sorted.length; i++) {
    const lastCluster = clusters[clusters.length - 1];
    const lastAvg = lastCluster.reduce((s, v) => s + v, 0) / lastCluster.length;
    if (Math.abs(sorted[i] - lastAvg) <= tolerance) {
      lastCluster.push(sorted[i]);
    } else {
      clusters.push([sorted[i]]);
    }
  }
  return clusters.map((c) => c.reduce((s, v) => s + v, 0) / c.length);
}

function round(n: number): number {
  return parseFloat(n.toFixed(3));
}

export function generateFormatName(spec: ParsedLabelSpec): string {
  const labelInches = `${spec.width}" × ${spec.height}"`;
  if (spec.type === 'thermal') return `${labelInches} Thermal`;
  if (spec.columns && spec.rows) return `${labelInches} Sheet (${spec.columns}×${spec.rows})`;
  return `${labelInches} Sheet`;
}
