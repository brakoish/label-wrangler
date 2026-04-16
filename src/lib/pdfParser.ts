import * as pdfjsLib from 'pdfjs-dist';
import { ParsedLabelSpec } from './types';

// Initialize PDF.js worker
if (typeof window !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;
}

export interface PDFParseResult {
  success: boolean;
  spec?: ParsedLabelSpec;
  error?: string;
  rawData?: {
    pageWidth: number;
    pageHeight: number;
    rectangles: Array<{
      x: number;
      y: number;
      width: number;
      height: number;
    }>;
  };
}

/**
 * Parse a PDF file to detect label format specifications
 */
export async function parsePDFFile(file: File): Promise<PDFParseResult> {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    // Get first page
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 1.0 });

    // PDF coordinates: origin at bottom-left, y increases upward
    // Convert to inches (PDF uses points, 72 points = 1 inch)
    const pageWidth = viewport.width / 72;
    const pageHeight = viewport.height / 72;

    // Extract drawing operations to find rectangles
    const opList = await page.getOperatorList();
    const rectangles: Array<{ x: number; y: number; width: number; height: number }> = [];

    // Track current transformation matrix and path
    let currentTransform: number[] = [1, 0, 0, 1, 0, 0];
    const currentPath: Array<{ x: number; y: number }> = [];

    for (let i = 0; i < opList.fnArray.length; i++) {
      const fn = opList.fnArray[i];
      const args = opList.argsArray[i];

      // Track rectangle drawing operations
      if (fn === pdfjsLib.OPS.rectangle) {
        const [x, y, width, height] = args as number[];
        // Transform coordinates
        const tx = currentTransform[0] * x + currentTransform[2] * y + currentTransform[4];
        const ty = currentTransform[1] * x + currentTransform[3] * y + currentTransform[5];
        const tw = Math.abs(currentTransform[0] * width);
        const th = Math.abs(currentTransform[3] * height);

        rectangles.push({
          x: tx / 72,
          y: ty / 72,
          width: tw / 72,
          height: th / 72,
        });
      }

      // Track path construction for more complex shapes
      if (fn === pdfjsLib.OPS.moveTo) {
        const [x, y] = args as number[];
        currentPath.length = 0;
        currentPath.push({ x, y });
      } else if (fn === pdfjsLib.OPS.lineTo) {
        const [x, y] = args as number[];
        currentPath.push({ x, y });
      } else if (fn === pdfjsLib.OPS.closePath) {
        // Check if path forms a rectangle
        if (currentPath.length === 4) {
          const rect = pathToRect(currentPath);
          if (rect) {
            rectangles.push({
              x: rect.x / 72,
              y: rect.y / 72,
              width: rect.width / 72,
              height: rect.height / 72,
            });
          }
        }
        currentPath.length = 0;
      }

      // Track transformations
      if (fn === pdfjsLib.OPS.transform) {
        const [a, b, c, d, e, f] = args as number[];
        currentTransform = multiplyMatrices(currentTransform, [a, b, c, d, e, f]);
      }
    }

    // Analyze rectangles to detect grid pattern
    const analysis = analyzeRectangles(rectangles, pageWidth, pageHeight);

    return {
      success: true,
      spec: analysis.spec,
      rawData: {
        pageWidth,
        pageHeight,
        rectangles,
      },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to parse PDF',
    };
  }
}

/**
 * Convert a 4-point path to rectangle if it forms one
 */
function pathToRect(path: Array<{ x: number; y: number }>): { x: number; y: number; width: number; height: number } | null {
  if (path.length !== 4) return null;

  const xs = path.map((p) => p.x);
  const ys = path.map((p) => p.y);
  const uniqueXs = [...new Set(xs)].sort((a, b) => a - b);
  const uniqueYs = [...new Set(ys)].sort((a, b) => a - b);

  if (uniqueXs.length !== 2 || uniqueYs.length !== 2) return null;

  return {
    x: uniqueXs[0],
    y: uniqueYs[0],
    width: uniqueXs[1] - uniqueXs[0],
    height: uniqueYs[1] - uniqueYs[0],
  };
}

/**
 * Multiply two 3x3 transformation matrices (represented as 6-element arrays)
 */
function multiplyMatrices(a: number[], b: number[]): number[] {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

/**
 * Analyze rectangles to detect label grid pattern
 */
function analyzeRectangles(
  rectangles: Array<{ x: number; y: number; width: number; height: number }>,
  pageWidth: number,
  pageHeight: number
): { spec: ParsedLabelSpec } {
  // Filter out very small rectangles (likely artifacts)
  const validRects = rectangles.filter(
    (r) => r.width > 0.1 && r.height > 0.1 && r.width < pageWidth * 0.9 && r.height < pageHeight * 0.9
  );

  if (validRects.length === 0) {
    // No rectangles found - assume it's a single thermal label
    return {
      spec: {
        type: 'thermal',
        width: pageWidth,
        height: pageHeight,
        confidence: 'low',
      },
    };
  }

  // Group rectangles by size (tolerance of 0.01 inches)
  const sizeGroups = groupBySize(validRects, 0.01);
  const largestGroup = sizeGroups.sort((a, b) => b.length - a.length)[0];

  if (!largestGroup || largestGroup.length < 2) {
    // Single rectangle - could be a thermal label
    const rect = validRects[0];
    return {
      spec: {
        type: 'thermal',
        width: rect.width,
        height: rect.height,
        confidence: 'medium',
      },
    };
  }

  // Analyze grid pattern
  const gridAnalysis = analyzeGrid(largestGroup, pageWidth, pageHeight);

  return {
    spec: {
      type: 'sheet',
      width: gridAnalysis.labelWidth,
      height: gridAnalysis.labelHeight,
      sheetWidth: pageWidth,
      sheetHeight: pageHeight,
      columns: gridAnalysis.columns,
      rows: gridAnalysis.rows,
      topMargin: gridAnalysis.topMargin,
      sideMargin: gridAnalysis.sideMargin,
      horizontalGap: gridAnalysis.horizontalGap,
      verticalGap: gridAnalysis.verticalGap,
      confidence: gridAnalysis.confidence,
    },
  };
}

/**
 * Group rectangles by similar size
 */
function groupBySize(
  rectangles: Array<{ x: number; y: number; width: number; height: number }>,
  tolerance: number
): Array<Array<{ x: number; y: number; width: number; height: number }>> {
  const groups: Array<Array<{ x: number; y: number; width: number; height: number }>> = [];

  for (const rect of rectangles) {
    let found = false;
    for (const group of groups) {
      const sample = group[0];
      if (
        Math.abs(rect.width - sample.width) < tolerance &&
        Math.abs(rect.height - sample.height) < tolerance
      ) {
        group.push(rect);
        found = true;
        break;
      }
    }
    if (!found) {
      groups.push([rect]);
    }
  }

  return groups;
}

/**
 * Analyze rectangles to determine grid layout
 */
function analyzeGrid(
  rectangles: Array<{ x: number; y: number; width: number; height: number }>,
  pageWidth: number,
  pageHeight: number
) {
  // Get unique x and y positions
  const xPositions = [...new Set(rectangles.map((r) => r.x))].sort((a, b) => a - b);
  const yPositions = [...new Set(rectangles.map((r) => r.y))].sort((a, b) => a - b);

  // Calculate columns and rows
  const columns = xPositions.length;
  const rows = yPositions.length;

  // Get label dimensions (use first rectangle)
  const sampleRect = rectangles[0];
  const labelWidth = sampleRect.width;
  const labelHeight = sampleRect.height;

  // Calculate margins
  const leftMargin = xPositions[0];
  const rightMargin = pageWidth - (xPositions[xPositions.length - 1] + labelWidth);
  const sideMargin = (leftMargin + rightMargin) / 2;

  const topMargin = pageHeight - (yPositions[yPositions.length - 1] + labelHeight);
  const bottomMargin = yPositions[0];

  // Calculate gaps
  let horizontalGap = 0;
  if (xPositions.length > 1) {
    const gaps = [];
    for (let i = 1; i < xPositions.length; i++) {
      gaps.push(xPositions[i] - (xPositions[i - 1] + labelWidth));
    }
    horizontalGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  }

  let verticalGap = 0;
  if (yPositions.length > 1) {
    const gaps = [];
    for (let i = 1; i < yPositions.length; i++) {
      gaps.push(yPositions[i] - (yPositions[i - 1] + labelHeight));
    }
    verticalGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  }

  // Determine confidence based on consistency
  let confidence: 'high' | 'medium' | 'low' = 'medium';
  if (rectangles.length === columns * rows && columns > 1 && rows > 1) {
    confidence = 'high';
  } else if (columns > 1 || rows > 1) {
    confidence = 'medium';
  } else {
    confidence = 'low';
  }

  return {
    columns,
    rows,
    labelWidth,
    labelHeight,
    topMargin,
    sideMargin,
    horizontalGap,
    verticalGap,
    confidence,
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

  return `${spec.width}" × ${spec.height}" Sheet (${labelsPerSheet} per sheet)`;
}