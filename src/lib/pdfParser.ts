import { ParsedLabelSpec } from './types';
import { PDFDocument } from 'pdf-lib';
import pako from 'pako';

export interface PDFParseResult {
  success: boolean;
  spec?: ParsedLabelSpec;
  error?: string;
}

interface Rect {
  x: number; // inches, from top-left
  y: number;
  w: number;
  h: number;
}

/**
 * Parse a PDF label template to detect the grid layout.
 *
 * Strategy:
 * 1. Use pdf-lib to load the PDF and get page dimensions
 * 2. Decompress the content stream (FlateDecode) with pako
 * 3. Parse the transform matrix (`cm` operator) to handle scaling
 * 4. Extract all `re` (rectangle) operators with proper coordinate transforms
 * 5. Cluster by size to find the dominant label rectangle
 * 6. Derive grid layout from positions
 */
export async function parsePDFFile(file: File): Promise<PDFParseResult> {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdfDoc = await PDFDocument.load(arrayBuffer);
    const page = pdfDoc.getPage(0);

    // Page dimensions in points (72 per inch)
    const { width: pageWPts, height: pageHPts } = page.getSize();
    const pageWidthIn = pageWPts / 72;
    const pageHeightIn = pageHPts / 72;

    // Get the content stream
    const contentStream = page.node.Contents();
    if (!contentStream) {
      return { success: false, error: 'No content stream found' };
    }

    // Decompress the content stream
    let streamText: string;
    try {
      const rawBytes = (contentStream as any).contents as Uint8Array;
      if (!rawBytes || rawBytes.length === 0) {
        return { success: false, error: 'Empty content stream' };
      }

      // Try FlateDecode decompression
      let decoded: Uint8Array;
      try {
        decoded = pako.inflate(rawBytes);
      } catch {
        // Maybe not compressed — try using raw bytes
        decoded = rawBytes;
      }

      streamText = new TextDecoder('latin1').decode(decoded);
    } catch (err) {
      return {
        success: false,
        error: 'Failed to decode content stream: ' + (err instanceof Error ? err.message : String(err)),
      };
    }

    // Check if stream has rectangle operators or path-based rectangles
    const hasRectOps = streamText.includes(' re');
    const hasPathOps = (streamText.match(/\bm\b/g) || []).length > 5;

    // Parse transform matrix if present
    // Format: a b c d e f cm
    // Common patterns:
    //   1 0 0 -1 0 792 cm  → flip Y, no scale
    //   0.24 0 0 -0.24 0 792 cm → scale + flip Y
    let scaleX = 1;
    let scaleY = 1;
    let translateX = 0;
    let translateY = 0;
    let yFlipped = false;

    const cmMatch = streamText.match(
      /([.\d-]+)\s+([.\d-]+)\s+([.\d-]+)\s+([.\d-]+)\s+([.\d-]+)\s+([.\d-]+)\s+cm/
    );
    if (cmMatch) {
      const a = parseFloat(cmMatch[1]);
      const d = parseFloat(cmMatch[4]);
      const e = parseFloat(cmMatch[5]);
      const f = parseFloat(cmMatch[6]);

      scaleX = Math.abs(a);
      scaleY = Math.abs(d);
      translateX = e;
      translateY = f;
      yFlipped = d < 0;
    }

    const rawRects: Rect[] = [];

    // Method 1: Extract `re` rectangle operators
    if (hasRectOps) {
      const rePattern = /(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s+re/g;
      let match;

      while ((match = rePattern.exec(streamText)) !== null) {
        const rawX = parseFloat(match[1]);
        const rawY = parseFloat(match[2]);
        const rawW = parseFloat(match[3]);
        const rawH = parseFloat(match[4]);

        const ptsX = rawX * scaleX + translateX;
        const ptsW = Math.abs(rawW * scaleX);
        const ptsH = Math.abs(rawH * scaleY);

        let ptsY: number;
        if (yFlipped) {
          ptsY = rawY * scaleY;
        } else {
          ptsY = rawY * scaleY + translateY;
        }

        const inX = ptsX / 72;
        const inY = ptsY / 72;
        const inW = ptsW / 72;
        const inH = ptsH / 72;

        if (inW < 0.1 || inH < 0.1) continue;
        if (inW > pageWidthIn * 0.95 && inH > pageHeightIn * 0.95) continue;

        rawRects.push({ x: inX, y: inY, w: inW, h: inH });
      }
    }

    // Method 2: Extract label grid from repeated `cm` transforms
    // Many PDFs (Avery, rounded-rect templates) draw each label using:
    //   q ... 1 0 0 1 X Y cm ... path ... Q
    // The X,Y positions form the grid directly.
    if (rawRects.length < 4) {
      const cmPattern = /1\s+0\s+0\s+1\s+(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s+cm/g;
      const cmPositions: Array<{ x: number; y: number }> = [];
      let match;

      while ((match = cmPattern.exec(streamText)) !== null) {
        cmPositions.push({ x: parseFloat(match[1]), y: parseFloat(match[2]) });
      }

      if (cmPositions.length >= 4) {
        // Cluster X and Y positions to find the grid
        const uniqueX = clusterValues(cmPositions.map((p) => p.x / 72), 0.03);
        const uniqueY = clusterValues(cmPositions.map((p) => p.y / 72), 0.03);
        uniqueX.sort((a, b) => a - b);
        uniqueY.sort((a, b) => b - a); // PDF Y goes up; top row has highest Y

        const cols = uniqueX.length;
        const rows = uniqueY.length;

        if (cols >= 2 && rows >= 2) {
          // Estimate label size from spacing
          const xSpacing = uniqueX[1] - uniqueX[0];
          const ySpacing = Math.abs(uniqueY[1] - uniqueY[0]);

          // Try to get actual label dimensions from the path after first cm
          let labelW = xSpacing;
          let labelH = ySpacing;

          const firstCmStr = `1 0 0 1 ${cmPositions[0].x}`;
          const firstCmIdx = streamText.indexOf(firstCmStr);
          if (firstCmIdx > -1) {
            const afterCm = streamText.substring(firstCmIdx, firstCmIdx + 500);
            // Find max coordinates in path commands (m, l, c operators)
            const coordPattern = /(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s+[mlc]/g;
            let maxX = 0, maxY = 0;
            let cm2;
            while ((cm2 = coordPattern.exec(afterCm)) !== null) {
              const px = Math.abs(parseFloat(cm2[1]));
              const py = Math.abs(parseFloat(cm2[2]));
              if (px > maxX && px < 500) maxX = px;
              if (py > maxY && py < 500) maxY = py;
            }
            if (maxX > 10) labelW = maxX / 72; // > 10 pts to avoid tiny artifacts
            if (maxY > 10) labelH = maxY / 72;
          }

          const hGap = Math.max(0, xSpacing - labelW);
          const vGap = Math.max(0, ySpacing - labelH);
          const topMargin = pageHeightIn - Math.max(...uniqueY) - labelH;
          const sideMargin = uniqueX[0];

          // Build rects from grid
          for (const yPos of uniqueY) {
            for (const xPos of uniqueX) {
              rawRects.push({
                x: xPos,
                y: pageHeightIn - yPos - labelH,
                w: labelW,
                h: labelH,
              });
            }
          }
        }
      }
    }

    if (rawRects.length < 2) {
      return {
        success: false,
        error: 'No label outlines found in this PDF. Try a different label sheet template.',
      };
    }

    // Cluster by size to find the dominant label rectangle
    const sizeClusters = clusterBySize(rawRects, 0.03);
    sizeClusters.sort((a, b) => b.rects.length - a.rects.length);

    const labelCluster = sizeClusters[0];
    const labelW = labelCluster.avgW;
    const labelH = labelCluster.avgH;
    const labelRects = labelCluster.rects;

    // Get unique X and Y positions
    const xPositions = clusterValues(
      labelRects.map((r) => r.x),
      0.03
    );
    const yPositions = clusterValues(
      labelRects.map((r) => r.y),
      0.03
    );

    xPositions.sort((a, b) => a - b);
    yPositions.sort((a, b) => a - b);

    const columns = xPositions.length;
    const rows = yPositions.length;

    // Calculate margins
    const sideMargin = xPositions[0];
    const topMargin = yPositions[0];

    // Calculate gaps from spacing between label positions
    let horizontalGap = 0;
    if (xPositions.length >= 2) {
      const xSpacing = xPositions[1] - xPositions[0];
      horizontalGap = Math.max(0, xSpacing - labelW);
    }

    let verticalGap = 0;
    if (yPositions.length >= 2) {
      const ySpacing = yPositions[1] - yPositions[0];
      verticalGap = Math.max(0, ySpacing - labelH);
    }

    // Confidence
    const expectedCount = columns * rows;
    let confidence: 'high' | 'medium' | 'low' = 'low';
    if (labelRects.length >= expectedCount * 0.9 && columns >= 2 && rows >= 2) {
      confidence = 'high';
    } else if (labelRects.length >= 4) {
      confidence = 'medium';
    }

    return {
      success: true,
      spec: {
        type: 'sheet',
        width: round(labelW),
        height: round(labelH),
        sheetWidth: round(pageWidthIn),
        sheetHeight: round(pageHeightIn),
        columns,
        rows,
        topMargin: round(topMargin),
        sideMargin: round(sideMargin),
        horizontalGap: round(horizontalGap),
        verticalGap: round(verticalGap),
        confidence,
      },
    };
  } catch (err) {
    console.error('PDF parsing error:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to parse PDF',
    };
  }
}

// --- Helpers ---

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
      if (
        Math.abs(rect.w - cluster.avgW) < tolerance &&
        Math.abs(rect.h - cluster.avgH) < tolerance
      ) {
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

  if (spec.type === 'thermal') {
    return `${labelInches} Thermal`;
  }

  if (spec.columns && spec.rows) {
    return `${labelInches} Sheet (${spec.columns}×${spec.rows})`;
  }

  return `${labelInches} Sheet`;
}
