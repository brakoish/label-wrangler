import { ParsedLabelSpec } from './types';

export interface PDFParseResult {
  success: boolean;
  spec?: ParsedLabelSpec;
  error?: string;
}

/**
 * Parse a PDF file to detect label format specifications
 * Uses canvas rendering to analyze the PDF visually
 */
export async function parsePDFFile(file: File): Promise<PDFParseResult> {
  try {
    // Dynamically import PDF.js v4
    const pdfjsLib = await import('pdfjs-dist');

    // Set worker source for PDF.js v4
    pdfjsLib.GlobalWorkerOptions.workerSrc = `/pdf.worker.min.mjs`;

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({
      data: arrayBuffer,
      verbosity: 0,
    }).promise;

    // Get first page at high resolution for accurate detection
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 2.0 });

    // Create canvas to render PDF
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d')!;

    await page.render({
      canvasContext: ctx,
      viewport: viewport,
    }).promise;

    // Get image data for analysis
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const { data, width, height } = imageData;

    // PDF dimensions in inches (72 points per inch)
    const pageWidthInches = viewport.width / 72;
    const pageHeightInches = viewport.height / 72;

    // Analyze to find rectangular regions (label grid)
    const analysis = analyzeCanvasImage(data, width, height, pageWidthInches, pageHeightInches);

    return {
      success: true,
      spec: analysis.spec,
    };
  } catch (err) {
    console.error('PDF parsing error:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to parse PDF',
    };
  }
}

interface GridAnalysis {
  spec: ParsedLabelSpec;
}

/**
 * Analyze canvas image data to detect label grid
 */
function analyzeCanvasImage(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  pageWidth: number,
  pageHeight: number
): GridAnalysis {
  const horizontalLines: number[] = [];
  const verticalLines: number[] = [];

  // Scan for horizontal lines
  for (let y = 0; y < height; y++) {
    let darkCount = 0;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;
      if (brightness < 180) darkCount++;
    }
    if (darkCount / width > 0.2) {
      horizontalLines.push(y);
    }
  }

  // Scan for vertical lines
  for (let x = 0; x < width; x++) {
    let darkCount = 0;
    for (let y = 0; y < height; y++) {
      const i = (y * width + x) * 4;
      const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;
      if (brightness < 180) darkCount++;
    }
    if (darkCount / height > 0.2) {
      verticalLines.push(x);
    }
  }

  const yPositions = clusterPositions(horizontalLines, 8);
  const xPositions = clusterPositions(verticalLines, 8);

  if (xPositions.length < 2 || yPositions.length < 2) {
    return detectByContrast(data, width, height, pageWidth, pageHeight);
  }

  const xDistances = calculateDistances(xPositions);
  const yDistances = calculateDistances(yPositions);

  const xUnit = findMostCommonValue(xDistances);
  const yUnit = findMostCommonValue(yDistances);

  const xGap = findGapSize(xDistances, xUnit);
  const yGap = findGapSize(yDistances, yUnit);

  let labelWidth = xUnit - xGap;
  let labelHeight = yUnit - yGap;

  labelWidth = Math.max(0.1, labelWidth);
  labelHeight = Math.max(0.1, labelHeight);

  const columns = Math.max(1, xPositions.length - 1);
  const rows = Math.max(1, yPositions.length - 1);

  const leftMargin = xPositions[0] / width * pageWidth;
  const topMargin = yPositions[0] / height * pageHeight;

  let confidence: 'high' | 'medium' | 'low' = 'medium';
  if (columns >= 2 && rows >= 2) {
    confidence = 'high';
  }

  return {
    spec: {
      type: 'sheet',
      width: parseFloat(labelWidth.toFixed(3)),
      height: parseFloat(labelHeight.toFixed(3)),
      sheetWidth: parseFloat(pageWidth.toFixed(3)),
      sheetHeight: parseFloat(pageHeight.toFixed(3)),
      columns,
      rows,
      topMargin: parseFloat(topMargin.toFixed(3)),
      sideMargin: parseFloat(leftMargin.toFixed(3)),
      horizontalGap: parseFloat(xGap.toFixed(3)),
      verticalGap: parseFloat(yGap.toFixed(3)),
      confidence,
    },
  };
}

function clusterPositions(positions: number[], threshold: number = 5): number[] {
  if (positions.length === 0) return [];

  const clusters: number[][] = [];
  let currentCluster: number[] = [positions[0]];

  for (let i = 1; i < positions.length; i++) {
    if (positions[i] - currentCluster[currentCluster.length - 1] <= threshold) {
      currentCluster.push(positions[i]);
    } else {
      clusters.push(currentCluster);
      currentCluster = [positions[i]];
    }
  }
  clusters.push(currentCluster);

  return clusters.map((cluster) =>
    Math.round(cluster.reduce((a, b) => a + b, 0) / cluster.length)
  );
}

function calculateDistances(positions: number[]): number[] {
  const distances: number[] = [];
  for (let i = 1; i < positions.length; i++) {
    distances.push(positions[i] - positions[i - 1]);
  }
  return distances;
}

function findMostCommonValue(values: number[]): number {
  if (values.length === 0) return 1;

  const counts = new Map<number, number>();
  for (const v of values) {
    counts.set(v, (counts.get(v) || 0) + 1);
  }

  let mostCommon = values[0];
  let maxCount = 0;
  for (const [v, count] of counts) {
    if (count > maxCount) {
      maxCount = count;
      mostCommon = v;
    }
  }
  return mostCommon;
}

function findGapSize(distances: number[], unitSize: number): number {
  if (distances.length === 0) return 0;

  const groups = new Map<number, number[]>();
  for (const d of distances) {
    let foundGroup = false;
    for (const key of groups.keys()) {
      if (Math.abs(d - key) <= 2) {
        groups.get(key)!.push(d);
        foundGroup = true;
        break;
      }
    }
    if (!foundGroup) {
      groups.set(d, [d]);
    }
  }

  let gapSize = 0;
  let minGapCount = 0;

  for (const [gap, counts] of groups) {
    const count = counts.length;
    if (gap < unitSize * 0.5 && count >= minGapCount) {
      gapSize = gap;
      minGapCount = count;
    }
  }

  return gapSize;
}

function detectByContrast(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  pageWidth: number,
  pageHeight: number
): GridAnalysis {
  const samplesX = 30;
  const samplesY = 30;

  const brightnessGrid: number[][] = [];
  for (let y = 0; y < samplesY; y++) {
    const row: number[] = [];
    const actualY = Math.round((y + 0.5) * height / samplesY);
    for (let x = 0; x < samplesX; x++) {
      const actualX = Math.round((x + 0.5) * width / samplesX);
      const i = (actualY * width + actualX) * 4;
      row.push((data[i] + data[i + 1] + data[i + 2]) / 3);
    }
    brightnessGrid.push(row);
  }

  const xEdges: number[] = [];
  const yEdges: number[] = [];

  for (let x = 1; x < samplesX - 1; x++) {
    let edgeStrength = 0;
    for (let y = 0; y < samplesY; y++) {
      const diff = Math.abs(brightnessGrid[y][x] - brightnessGrid[y][x - 1]);
      edgeStrength += diff;
    }
    if (edgeStrength / samplesY > 40) {
      xEdges.push(x);
    }
  }

  for (let y = 1; y < samplesY - 1; y++) {
    let edgeStrength = 0;
    for (let x = 0; x < samplesX; x++) {
      const diff = Math.abs(brightnessGrid[y][x] - brightnessGrid[y - 1][x]);
      edgeStrength += diff;
    }
    if (edgeStrength / samplesX > 40) {
      yEdges.push(y);
    }
  }

  const xEdgePixels = xEdges.map(e => Math.round(e * width / samplesX));
  const yEdgePixels = yEdges.map(e => Math.round(e * height / samplesY));

  const xEdgeClustered = clusterPositions(xEdgePixels, 15);
  const yEdgeClustered = clusterPositions(yEdgePixels, 15);

  const columns = Math.max(1, Math.round(xEdgeClustered.length / 2));
  const rows = Math.max(1, Math.round(yEdgeClustered.length / 2));

  if (columns < 2 || rows < 2) {
    return {
      spec: {
        type: 'sheet',
        width: parseFloat((pageWidth / 3).toFixed(3)),
        height: parseFloat((pageHeight / 10).toFixed(3)),
        sheetWidth: parseFloat(pageWidth.toFixed(3)),
        sheetHeight: parseFloat(pageHeight.toFixed(3)),
        columns: 3,
        rows: 10,
        topMargin: 0.5,
        sideMargin: 0.1875,
        horizontalGap: 0.125,
        verticalGap: 0,
        confidence: 'low',
      },
    };
  }

  const labelWidth = pageWidth / columns;
  const labelHeight = pageHeight / rows;

  return {
    spec: {
      type: 'sheet',
      width: parseFloat(labelWidth.toFixed(3)),
      height: parseFloat(labelHeight.toFixed(3)),
      sheetWidth: parseFloat(pageWidth.toFixed(3)),
      sheetHeight: parseFloat(pageHeight.toFixed(3)),
      columns,
      rows,
      topMargin: parseFloat(((pageHeight - labelHeight * rows) / 2).toFixed(3)),
      sideMargin: parseFloat(((pageWidth - labelWidth * columns) / 2).toFixed(3)),
      horizontalGap: 0,
      verticalGap: 0,
      confidence: 'medium',
    },
  };
}

export function generateFormatName(spec: ParsedLabelSpec): string {
  const labelInches = `${spec.width}" × ${spec.height}"`;

  if (spec.type === 'thermal') {
    return `${labelInches} Thermal`;
  }

  const w = parseFloat(spec.width.toFixed(2));
  const h = parseFloat(spec.height.toFixed(2));
  const cols = spec.columns || 1;
  const r = spec.rows || 1;

  if (w === 2.625 && h === 1 && cols === 3 && r === 10) return 'Avery 5160';
  if (w === 4 && h === 2 && cols === 2 && r === 5) return 'Avery 5163';
  if (w === 1.75 && h === 0.5 && cols === 4 && r === 20) return 'Avery 5167';
  if (w === 4 && h === 3.33 && cols === 2 && r === 3) return 'Avery 8164';
  if (w === 0.5 && h === 0.5 && cols === 13 && r === 17) return 'OL2050';

  if (spec.columns && spec.rows) {
    return `${labelInches} Sheet (${spec.columns}×${spec.rows})`;
  }

  return `${labelInches} Sheet`;
}