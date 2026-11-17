import { neon } from '@neondatabase/serverless';
import { json, browserFailure } from '@/lib/office/http';
import { requireUser } from '@/lib/office/auth';

/**
 * GET: brand names from Manifest (brands with products on our license), for
 * the "only for these brands" choice on a kiosk label. Read-only; an empty
 * list when Manifest isn't connected, and the choice then takes typed names.
 */
export async function GET(req: Request) {
  try {
    await requireUser(req, 'edit');
    const url = process.env.MANIFEST_DATABASE_URL;
    const license = process.env.METRC_LICENSE_DISTRIBUTOR;
    if (!url || !license) return json({ brands: [] });
    let rows: Record<string, unknown>[];
    try {
      rows = await neon(url)`SELECT DISTINCT b.name FROM brands b JOIN metrc_items mi ON mi.brand_id=b.id
      WHERE mi.license_number=${license} AND b.name IS NOT NULL AND btrim(b.name)<>'' ORDER BY b.name LIMIT 500`;
    } catch (error) {
      console.error('Kiosk brand list failed:', error instanceof Error ? error.message : 'unknown error');
      return json({ brands: [] });
    }
    return json({ brands: rows.map((row) => String(row.name).trim()).filter(Boolean) });
  } catch (error) { return browserFailure(error); }
}
