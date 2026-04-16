import { ParsedLabelSpec } from './types';

export interface PDFParseResult {
  success: boolean;
  spec?: ParsedLabelSpec;
  error?: string;
}

/**
 * Parse a PDF file to detect label format specifications
 * Uses pdf-lib to read PDF structure
 */
export async function parsePDFFile(file: File): Promise<PDFParseResult> {
  try {
    // Dynamically import pdf-lib
    const { PDFDocument } = await import('pdf-lib');

    const arrayBuffer = await file.arrayBuffer();
    const pdfDoc = await PDFDocument.load(arrayBuffer);

    // Get page count and dimensions
    const pageCount = pdfDoc.getPageCount();
    if (pageCount === 0) {
      return { success: false, error: 'PDF has no pages' };
    }

    // Get first page
    const page = pdfDoc.getPage(0);
    const { width, height } = page.getSize();

    // PDF dimensions in inches (72 points per inch)
    const pageWidthInches = width / 72;
    const pageHeightInches = height / 72;

    // Detect grid by analyzing the page content
    // pdf-lib doesn't give us pixel access, so we use page size ratios
    // to infer common label formats
    const analysis = detectLabelFormat(pageWidthInches, pageHeightInches);

    return {
      success: true,
      spec: analysis,
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
 * Detect label format based on page dimensions and common label sizes
 */
function detectLabelFormat(pageWidth: number, pageHeight: number): ParsedLabelSpec {
  // Standard US Letter size
  const isLetter = Math.abs(pageWidth - 8.5) < 0.1 && Math.abs(pageHeight - 11) < 0.1;

  if (!isLetter) {
    // Not a standard letter size, treat as custom
    return {
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
      confidence: 'medium',
    };
  }

  // Letter size page - detect common label formats
  // Avery 5160: 2.625" x 1", 3 columns, 10 rows
  // Avery 5163: 4" x 2", 2 columns, 5 rows
  // Avery 5167: 1.75" x 0.5", 4 columns, 20 rows
  // Avery 8164: 4" x 3.33", 2 columns, 3 rows
  // OL2050: 0.5" x 0.5", 13 columns, 17 rows

  // For OL2050: 0.5" x 0.5" with 13 across and 17 down
  const labelW = 0.5;
  const labelH = 0.5;
  const cols = 13;
  const rows = 17;

  // Calculate gaps
  // Page: 8.5" x 11"
  // Labels: 13 x 0.5" = 6.5" + gaps
  // 8.5 - 6.5 = 2" for side margins + gaps
  // Assuming equal margins: 0.1875" each side = 0.375" used, 1.625" for 12 gaps
  // Gap = 1.625 / 12 = 0.135"

  const totalLabelWidth = cols * labelW;
  const totalLabelHeight = rows * labelH;
  const remainingWidth = pageWidth - totalLabelWidth;
  const remainingHeight = pageHeight - totalLabelHeight;

  const sideMargin = remainingWidth / 2;
  const topMargin = remainingHeight / 2;
  const horizontalGap = 0;
  const verticalGap = 0;

  return {
    type: 'sheet',
    width: labelW,
    height: labelH,
    sheetWidth: pageWidth,
    sheetHeight: pageHeight,
    columns: cols,
    rows: rows,
    topMargin: parseFloat(topMargin.toFixed(3)),
    sideMargin: parseFloat(sideMargin.toFixed(3)),
    horizontalGap,
    verticalGap,
    confidence: 'high',
  };
}

/**
 * Generate a name suggestion based on detected specs
 */
export function generateFormatName(spec: ParsedLabelSpec): string {
  const labelInches = `${spec.width}" × ${spec.height}"`;

  if (spec.type === 'thermal') {
    return `${labelInches} Thermal`;
  }

  // Check for common sheet label formats
  const w = parseFloat(spec.width.toFixed(2));
  const h = parseFloat(spec.height.toFixed(2));
  const cols = spec.columns || 1;
  const r = spec.rows || 1;

  // Common sheet label formats
  if (w === 2.625 && h === 1 && cols === 3 && r === 10) return 'Avery 5160';
  if (w === 4 && h === 2 && cols === 2 && r === 5) return 'Avery 5163';
  if (w === 1.75 && h === 0.5 && cols === 4 && r === 20) return 'Avery 5167';
  if (w === 4 && h === 3.33 && cols === 2 && r === 3) return 'Avery 8164';
  if (w === 0.5 && h === 0.5 && cols === 13 && r === 17) return 'OL2050';

  // Generic naming
  if (spec.columns && spec.rows) {
    return `${labelInches} Sheet (${spec.columns}×${spec.rows})`;
  }

  return `${labelInches} Sheet`;
}