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
    // Dynamically import PDF.js only on client
    const pdfjsLib = await import('pdfjs-dist');

    // Set worker source for PDF.js
    pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

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
      canvas,
    }).promise;

    // Get image data for analysis
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const { data, width, height } = imageData;

    // PDF dimensions in inches (72 points per inch)
    const pageWidthInches = viewport.width / 72;
    const pageHeightInches = viewport.height / 72;

    // Analyze to find rectangular regions
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
  // Find all non-white rectangles (labels have borders)
  // We'll scan for dark pixels that form rectangular patterns
  
  // Detect horizontal and vertical lines
  const horizontalLines: number[] = [];
  const verticalLines: number[] = [];

  // Scan for horizontal lines (rows of dark pixels)
  for (let y = 0; y < height; y++) {
    let darkCount = 0;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;
      if (brightness < 200) darkCount++;
    }
    // If more than 30% of row is dark, it's likely a line
    if (darkCount / width > 0.3) {
      horizontalLines.push(y);
    }
  }

  // Scan for vertical lines
  for (let x = 0; x < width; x++) {
    let darkCount = 0;
    for (let y = 0; y < height; y++) {
      const i = (y * width + x) * 4;
      const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;
      if (brightness < 200) darkCount++;
    }
    if (darkCount / height > 0.3) {
      verticalLines.push(x);
    }
  }

  // Cluster lines to find grid positions
  const yPositions = clusterPositions(horizontalLines);
  const xPositions = clusterPositions(verticalLines);

  // If we don't find enough lines, try edge detection
  if (xPositions.length < 2 || yPositions.length < 2) {
    // Try detecting label boundaries by finding contrast changes
    return detectByContrast(data, width, height, pageWidth, pageHeight);
  }

  const columns = xPositions.length;
  const rows = yPositions.length;

  // Calculate label dimensions
  const labelWidth = pageWidth / columns;
  const labelHeight = pageHeight / rows;

  // Calculate margins and gaps
  const leftMargin = xPositions[0] / width * pageWidth;
  const topMargin = yPositions[0] / height * pageHeight;
  
  let horizontalGap = 0;
  let verticalGap = 0;
  
  if (columns > 1) {
    const totalGaps = pageWidth - leftMargin * 2 - labelWidth * columns;
    horizontalGap = totalGaps / (columns - 1);
  }
  
  if (rows > 1) {
    const totalGaps = pageHeight - topMargin * 2 - labelHeight * rows;
    verticalGap = totalGaps / (rows - 1);
  }

  // Determine confidence
  let confidence: 'high' | 'medium' | 'low' = 'medium';
  if (columns >= 2 && rows >= 2) {
    confidence = 'high';
  } else if (columns > 1 || rows > 1) {
    confidence = 'medium';
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
      horizontalGap: parseFloat(horizontalGap.toFixed(3)),
      verticalGap: parseFloat(verticalGap.toFixed(3)),
      confidence,
    },
  };
}

/**
 * Cluster nearby line positions to get distinct positions
 */
function clusterPositions(positions: number[]): number[] {
  if (positions.length === 0) return [];
  
  const threshold = 5; // pixels
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

  // Return the average position of each cluster
  return clusters.map((cluster) =>
    Math.round(cluster.reduce((a, b) => a + b, 0) / cluster.length)
  );
}

/**
 * Fallback: detect grid by analyzing contrast at regular intervals
 */
function detectByContrast(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  pageWidth: number,
  pageHeight: number
): GridAnalysis {
  // Sample grid points and look for consistent spacing
  const samplesX = 20;
  const samplesY = 20;
  
  // Create a grid of brightness values
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

  // Detect edges by finding where brightness changes significantly
  const xEdges: number[] = [];
  const yEdges: number[] = [];

  // Find vertical edges (columns)
  for (let x = 1; x < samplesX - 1; x++) {
    let edgeStrength = 0;
    for (let y = 0; y < samplesY; y++) {
      const diff = Math.abs(brightnessGrid[y][x] - brightnessGrid[y][x - 1]);
      edgeStrength += diff;
    }
    if (edgeStrength / samplesY > 50) {
      xEdges.push(x);
    }
  }

  // Find horizontal edges (rows)
  for (let y = 1; y < samplesY - 1; y++) {
    let edgeStrength = 0;
    for (let x = 0; x < samplesX; x++) {
      const diff = Math.abs(brightnessGrid[y][x] - brightnessGrid[y - 1][x]);
      edgeStrength += diff;
    }
    if (edgeStrength / samplesX > 50) {
      yEdges.push(y);
    }
  }

  // Convert edge positions to actual counts
  const columns = Math.max(1, xEdges.length > 0 ? Math.round(xEdges.length / 2) : 1);
  const rows = Math.max(1, yEdges.length > 0 ? Math.round(yEdges.length / 2) : 1);

  // If detection is poor, assume Avery 5160 as most common format
  if (columns < 2 || rows < 2) {
    return {
      spec: {
        type: 'sheet',
        width: 2.625,
        height: 1,
        sheetWidth: 8.5,
        sheetHeight: 11,
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

/**
 * Generate a name suggestion based on detected specs
 */
export function generateFormatName(spec: ParsedLabelSpec): string {
  if (spec.type === 'thermal') {
    return `${spec.width}" × ${spec.height}" Thermal Roll`;
  }

  const labelsPerSheet = (spec.columns || 1) * (spec.rows || 1);

  // Check for common Avery formats
  if (spec.sheetWidth === 8.5 && spec.sheetHeight === 11) {
    if (spec.columns === 3 && spec.rows === 10 && Math.abs(spec.width - 2.625) < 0.1) {
      return 'Avery 5160';
    }
    if (spec.columns === 2 && spec.rows === 5 && Math.abs(spec.width - 4) < 0.1) {
      return 'Avery 5163';
    }
    if (spec.columns === 4 && spec.rows === 20 && Math.abs(spec.width - 1.75) < 0.1) {
      return 'Avery 5167';
    }
    if (spec.columns === 2 && spec.rows === 3 && Math.abs(spec.width - 4) < 0.1) {
      return 'Avery 8164';
    }
  }

  return `${spec.width.toFixed(2)}" × ${spec.height.toFixed(2)}" Sheet (${labelsPerSheet} per sheet)`;
}