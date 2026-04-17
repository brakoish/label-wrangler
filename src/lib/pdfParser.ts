import { ParsedLabelSpec } from './types';
import { PDFDocument } from 'pdf-lib';

export interface PDFParseResult {
  success: boolean;
  spec?: ParsedLabelSpec;
  error?: string;
  debug?: {
    totalRects: number;
    labelRects: number;
    pageWidth: number;
    pageHeight: number;
  };
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Parse a PDF label template to detect the grid layout.
 * 
 * Strategy: Extract rectangle drawing operators from the PDF content stream.
 * Label sheet PDFs are vector-based — each label outline is a `re` (rectangle) op.
 * We cluster by size to find the dominant label rectangle, then derive the grid.
 */
export async function parsePDFFile(file: File): Promise<PDFParseResult> {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdfDoc = await PDFDocument.load(arrayBuffer);
    const page = pdfDoc.getPage(0);

    // Page dimensions in PDF points (72 per inch)
    const { width: pageW, height: pageH } = page.getSize();
    const pageWidthIn = pageW / 72;
    const pageHeightIn = pageH / 72;

    // Extract rectangles from the content stream
    const contentStream = page.node.Contents();
    if (!contentStream) {
      return { success: false, error: 'No content stream found on page 1' };
    }

    // Get the raw content stream bytes
    let streamData: string;
    try {
      // Handle both single stream and array of streams
      const rawContent = contentStream.toString();
      
      // For pdf-lib, we need to decode the content stream
      // The Contents can be a stream or an array of streams
      const contents = page.node.Contents();
      if (!contents) {
        return { success: false, error: 'Empty content stream' };
      }
      
      // Use pdf-lib's internal API to get decoded stream content
      const ref = page.node.get(page.node.context.obj('Contents'));
      streamData = await getContentStreamText(arrayBuffer);
    } catch {
      // Fallback: use the canvas rendering approach
      return await parseWithCanvas(file, pageWidthIn, pageHeightIn);
    }

    // Parse rectangle operators from the content stream
    const rects = extractRectsFromStream(streamData, pageH);

    if (rects.length < 4) {
      // Too few rects, try canvas fallback
      return await parseWithCanvas(file, pageWidthIn, pageHeightIn);
    }

    const spec = analyzeRects(rects, pageWidthIn, pageHeightIn);

    return {
      success: true,
      spec,
      debug: {
        totalRects: rects.length,
        labelRects: (spec.columns || 1) * (spec.rows || 1),
        pageWidth: pageWidthIn,
        pageHeight: pageHeightIn,
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

/**
 * Extract raw content stream text from a PDF file using manual parsing.
 * pdf-lib doesn't expose decoded stream content easily, so we parse the
 * raw PDF bytes to find `stream...endstream` blocks.
 */
async function getContentStreamText(arrayBuffer: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(arrayBuffer);
  const text = new TextDecoder('latin1').decode(bytes);
  
  // Find all stream...endstream blocks and look for ones with `re` operators
  const streams: string[] = [];
  let pos = 0;
  
  while (pos < text.length) {
    const streamStart = text.indexOf('stream\r\n', pos);
    const streamStart2 = text.indexOf('stream\n', pos);
    const actualStart = streamStart === -1 ? streamStart2 : 
                        streamStart2 === -1 ? streamStart :
                        Math.min(streamStart, streamStart2);
    
    if (actualStart === -1) break;
    
    const contentStart = actualStart + (text[actualStart + 6] === '\r' ? 8 : 7);
    const endStream = text.indexOf('endstream', contentStart);
    
    if (endStream === -1) break;
    
    const content = text.substring(contentStart, endStream).trim();
    
    // Check if this stream contains rectangle operators
    if (content.includes(' re') || content.includes('\nre')) {
      streams.push(content);
    }
    
    pos = endStream + 9;
  }
  
  if (streams.length === 0) {
    throw new Error('No rectangle content streams found');
  }
  
  // Return the longest stream (most likely the main page content)
  return streams.reduce((a, b) => a.length > b.length ? a : b);
}

/**
 * Parse PDF content stream text to extract rectangle operations.
 * PDF `re` operator: x y w h re
 * Coordinates are in PDF points (72/inch), Y-axis goes UP from bottom-left.
 */
function extractRectsFromStream(streamText: string, pageHeight: number): Rect[] {
  const rects: Rect[] = [];
  
  // Match: number number number number re
  // PDF numbers can be integers or decimals, positive or negative
  const rePattern = /(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s+re/g;
  
  let match;
  while ((match = rePattern.exec(streamText)) !== null) {
    const x = parseFloat(match[1]);
    const y = parseFloat(match[2]);
    const w = parseFloat(match[3]);
    const h = parseFloat(match[4]);
    
    // Convert to inches, flip Y axis (PDF Y=0 is bottom)
    // Normalize negative widths/heights
    const rectW = Math.abs(w) / 72;
    const rectH = Math.abs(h) / 72;
    const rectX = (w < 0 ? x + w : x) / 72;
    const rectY = (pageHeight - (h < 0 ? y : y + h)) / 72; // flip Y
    
    // Filter out tiny artifacts and full-page rects
    if (rectW > 0.05 && rectH > 0.05 && rectW < 10 && rectH < 14) {
      rects.push({ x: rectX, y: rectY, w: rectW, h: rectH });
    }
  }
  
  return rects;
}

/**
 * Analyze extracted rectangles to determine the label grid layout.
 */
function analyzeRects(rects: Rect[], pageWidth: number, pageHeight: number): ParsedLabelSpec {
  // Step 1: Cluster rectangles by size to find the dominant label size
  const sizeClusters = clusterBySize(rects, 0.02); // 0.02" tolerance
  
  // Sort clusters by count (most common first)
  sizeClusters.sort((a, b) => b.rects.length - a.rects.length);
  
  // The most common rectangle size is our label
  const labelCluster = sizeClusters[0];
  const labelW = labelCluster.avgW;
  const labelH = labelCluster.avgH;
  const labelRects = labelCluster.rects;
  
  // Step 2: Find unique X and Y positions (grid positions)
  const xPositions = clusterValues(labelRects.map(r => r.x), 0.02);
  const yPositions = clusterValues(labelRects.map(r => r.y), 0.02);
  
  // Sort positions
  xPositions.sort((a, b) => a - b);
  yPositions.sort((a, b) => a - b);
  
  const columns = xPositions.length;
  const rows = yPositions.length;
  
  // Step 3: Calculate margins
  const leftMargin = xPositions[0];
  const topMargin = yPositions[0];
  
  // Step 4: Calculate gaps
  let horizontalGap = 0;
  let verticalGap = 0;
  
  if (xPositions.length >= 2) {
    // Gap = distance between labels minus label width
    const xSpacing = xPositions[1] - xPositions[0];
    horizontalGap = Math.max(0, xSpacing - labelW);
  }
  
  if (yPositions.length >= 2) {
    const ySpacing = yPositions[1] - yPositions[0];
    verticalGap = Math.max(0, ySpacing - labelH);
  }
  
  // Determine confidence
  let confidence: 'high' | 'medium' | 'low' = 'low';
  if (labelRects.length >= columns * rows * 0.9 && columns >= 2 && rows >= 2) {
    confidence = 'high';
  } else if (labelRects.length >= 4) {
    confidence = 'medium';
  }
  
  return {
    type: 'sheet',
    width: round(labelW),
    height: round(labelH),
    sheetWidth: round(pageWidth),
    sheetHeight: round(pageHeight),
    columns,
    rows,
    topMargin: round(topMargin),
    sideMargin: round(leftMargin),
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

/**
 * Cluster rectangles by their width/height within a tolerance.
 */
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
        // Update running average
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

/**
 * Cluster numeric values within a tolerance, returning cluster centers.
 */
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
  
  return clusters.map(c => c.reduce((s, v) => s + v, 0) / c.length);
}

function round(n: number): number {
  return parseFloat(n.toFixed(3));
}

/**
 * Fallback: Canvas-based detection using PDF.js rendering.
 * Used when the content stream can't be parsed directly (e.g., compressed streams).
 */
async function parseWithCanvas(file: File, pageWidth: number, pageHeight: number): Promise<PDFParseResult> {
  try {
    const pdfjsLib = await import('pdfjs-dist');
    pdfjsLib.GlobalWorkerOptions.workerSrc = `/pdf.worker.min.mjs`;

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer, verbosity: 0 }).promise;
    const page = await pdf.getPage(1);
    
    // Render at high resolution
    const scale = 3.0;
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d')!;

    await page.render({ canvasContext: ctx, viewport }).promise;

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const { data, width, height } = imageData;

    // Scan columns for dark pixel density to find vertical edges
    const colDark = new Float32Array(width);
    for (let x = 0; x < width; x++) {
      let dark = 0;
      for (let y = 0; y < height; y++) {
        const i = (y * width + x) * 4;
        const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;
        if (brightness < 160) dark++;
      }
      colDark[x] = dark / height;
    }

    // Scan rows for dark pixel density to find horizontal edges
    const rowDark = new Float32Array(height);
    for (let y = 0; y < height; y++) {
      let dark = 0;
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;
        if (brightness < 160) dark++;
      }
      rowDark[y] = dark / width;
    }

    // Find edges: positions where dark density exceeds threshold
    const vEdges = findEdgePositions(colDark, 0.15, 5);
    const hEdges = findEdgePositions(rowDark, 0.15, 5);

    if (vEdges.length < 2 || hEdges.length < 2) {
      return {
        success: true,
        spec: {
          type: 'sheet',
          width: round(pageWidth / 3),
          height: round(pageHeight / 10),
          sheetWidth: round(pageWidth),
          sheetHeight: round(pageHeight),
          columns: 3,
          rows: 10,
          topMargin: 0.5,
          sideMargin: 0.19,
          horizontalGap: 0.125,
          verticalGap: 0,
          confidence: 'low',
        },
      };
    }

    // Convert pixel edges to inches
    const vInches = vEdges.map(e => (e / width) * pageWidth);
    const hInches = hEdges.map(e => (e / height) * pageHeight);

    // Edges come in pairs (left edge, right edge of each column)
    // Find the most common spacing
    const vSpacings = [];
    for (let i = 1; i < vInches.length; i++) {
      vSpacings.push(round(vInches[i] - vInches[i - 1]));
    }
    const hSpacings = [];
    for (let i = 1; i < hInches.length; i++) {
      hSpacings.push(round(hInches[i] - hInches[i - 1]));
    }

    // Separate label width (larger) and gap width (smaller)
    const vSorted = [...new Set(vSpacings)].sort((a, b) => a - b);
    const hSorted = [...new Set(hSpacings)].sort((a, b) => a - b);

    // If edges alternate: gap, label, gap, label...
    // The label width is the larger spacing, gap is the smaller
    let labelW: number, labelH: number, hGap: number, vGap: number;

    if (vSorted.length >= 2) {
      // Most common small value = gap, most common large value = label
      const smallV = vSorted[0];
      const largeV = vSorted[vSorted.length - 1];
      if (smallV < largeV * 0.3) {
        labelW = largeV;
        hGap = smallV;
      } else {
        labelW = smallV;
        hGap = 0;
      }
    } else {
      labelW = vSorted[0] || pageWidth / 3;
      hGap = 0;
    }

    if (hSorted.length >= 2) {
      const smallH = hSorted[0];
      const largeH = hSorted[hSorted.length - 1];
      if (smallH < largeH * 0.3) {
        labelH = largeH;
        vGap = smallH;
      } else {
        labelH = smallH;
        vGap = 0;
      }
    } else {
      labelH = hSorted[0] || pageHeight / 10;
      vGap = 0;
    }

    // Count columns and rows
    const columns = Math.round((vInches.length + 1) / 2);
    const rows = Math.round((hInches.length + 1) / 2);

    return {
      success: true,
      spec: {
        type: 'sheet',
        width: round(labelW),
        height: round(labelH),
        sheetWidth: round(pageWidth),
        sheetHeight: round(pageHeight),
        columns: Math.max(1, columns),
        rows: Math.max(1, rows),
        topMargin: round(hInches[0] || 0.5),
        sideMargin: round(vInches[0] || 0.19),
        horizontalGap: round(hGap),
        verticalGap: round(vGap),
        confidence: 'medium',
      },
    };
  } catch (err) {
    return {
      success: false,
      error: 'PDF analysis failed: ' + (err instanceof Error ? err.message : String(err)),
    };
  }
}

/**
 * Find positions in a density array where the value exceeds the threshold.
 * Clusters nearby positions and returns their centers.
 */
function findEdgePositions(densities: Float32Array, threshold: number, minGap: number): number[] {
  const edges: number[] = [];
  let inEdge = false;
  let edgeStart = 0;

  for (let i = 0; i < densities.length; i++) {
    if (densities[i] > threshold) {
      if (!inEdge) {
        edgeStart = i;
        inEdge = true;
      }
    } else {
      if (inEdge) {
        const center = Math.round((edgeStart + i) / 2);
        if (edges.length === 0 || center - edges[edges.length - 1] >= minGap) {
          edges.push(center);
        }
        inEdge = false;
      }
    }
  }

  return edges;
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
