// Label Wrangler — Core Types

export type LabelType = 'thermal' | 'sheet';

// Base label format — defines the physical media
export interface LabelFormat {
  id: string;
  name: string;
  description?: string;
  type: LabelType;

  // Label dimensions (inches)
  width: number;
  height: number;

  // For thermal labels
  dpi?: number;               // 203 or 300 (default: 203)
  labelsAcross?: number;      // For multi-across rolls (default: 1)

  // For sheet labels
  sheetWidth?: number;        // e.g., 8.5
  sheetHeight?: number;       // e.g., 11
  columns?: number;
  rows?: number;
  labelsPerSheet?: number;    // auto: columns * rows
  topMargin?: number;         // inches from top of sheet
  sideMargin?: number;        // inches from left of sheet
  horizontalGap?: number;     // gap between columns
  verticalGap?: number;       // gap between rows

  createdAt: string;
  updatedAt: string;
}

// Parsed result from PDF template analysis
export interface ParsedLabelSpec {
  type: LabelType;
  width: number;
  height: number;
  sheetWidth?: number;
  sheetHeight?: number;
  columns?: number;
  rows?: number;
  topMargin?: number;
  sideMargin?: number;
  horizontalGap?: number;
  verticalGap?: number;
  confidence: 'high' | 'medium' | 'low';
}

// Common label presets
export const COMMON_THERMAL_SIZES = [
  { name: '2" × 1"', width: 2, height: 1 },
  { name: '4" × 6"', width: 4, height: 6 },
  { name: '2.25" × 1.25"', width: 2.25, height: 1.25 },
  { name: '3" × 2"', width: 3, height: 2 },
  { name: '1" × 0.5"', width: 1, height: 0.5 },
  { name: '0.5" × 0.5"', width: 0.5, height: 0.5 },
] as const;

export const COMMON_SHEET_SIZES = [
  { name: 'Letter (8.5" × 11")', width: 8.5, height: 11 },
  { name: 'A4 (210mm × 297mm)', width: 8.27, height: 11.69 },
] as const;

export const COMMON_DPI_VALUES = [203, 300] as const;

// Helper to calculate labels per sheet
export function calculateLabelsPerSheet(format: Omit<LabelFormat, 'labelsPerSheet'>): number {
  if (format.type === 'thermal') return 1;
  return (format.columns || 1) * (format.rows || 1);
}

// Helper to format dimensions for display
export function formatDimensions(width: number, height: number): string {
  return `${width}" × ${height}"`;
}

// Helper to generate a slug/ID from name
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}