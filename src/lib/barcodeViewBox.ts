/**
 * JsBarcode writes width/height attributes with units (for example "400px").
 * A viewBox needs bare numbers; "0 0 400px 96px" is invalid and browsers drop
 * it, which stretches the bars into a solid black block. Parse the numbers and
 * fall back to the previous defaults when an attribute is missing or invalid.
 */
export function barcodeViewBoxSize(width: string | null | undefined, height: string | null | undefined): { w: number; h: number } {
  const parse = (value: string | null | undefined, fallback: number) => {
    const parsed = parseFloat(value ?? '');
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };
  return { w: parse(width, 200), h: parse(height, 100) };
}
export function barcodeViewBox(width: string | null | undefined, height: string | null | undefined): string {
  const { w, h } = barcodeViewBoxSize(width, height);
  return `0 0 ${w} ${h}`;
}
