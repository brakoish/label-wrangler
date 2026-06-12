import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

type ManifestPackage = {
  id?: number | string | null;
  label?: string | null;
  itemName?: string | null;
  productName?: string | null;
  brandName?: string | null;
  batchName?: string | null;
  sourceHarvestName?: string | null;
  quantity?: number | string | null;
  unitOfMeasure?: string | null;
  packagedDate?: string | null;
};

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizePackage(pkg: ManifestPackage) {
  const tag = cleanText(pkg.label);
  const itemName = cleanText(pkg.itemName) || cleanText(pkg.productName);
  const batch = cleanText(pkg.batchName) || cleanText(pkg.sourceHarvestName);

  return {
    id: String(pkg.id ?? tag),
    itemName,
    tag,
    batch,
    brandName: cleanText(pkg.brandName),
    quantity: pkg.quantity == null ? '' : String(pkg.quantity),
    unitOfMeasure: cleanText(pkg.unitOfMeasure),
    packagedDate: cleanText(pkg.packagedDate),
  };
}

async function searchManifestDatabase(search: string) {
  if (!process.env.MANIFEST_DATABASE_URL) return null;

  const sql = neon(process.env.MANIFEST_DATABASE_URL);
  const pattern = `%${search}%`;
  const rows = await sql`
    SELECT
      mp.id,
      mp.label,
      COALESCE(mi.item_name, mp.product_name) AS "itemName",
      mp.product_name AS "productName",
      b.name AS "brandName",
      COALESCE(mp.production_batch_number, mp.source_production_batch_numbers, '') AS "batchName",
      mp.quantity,
      mp.unit_of_measure AS "unitOfMeasure",
      mp.packaged_date AS "packagedDate"
    FROM metrc_packages mp
    LEFT JOIN metrc_items mi ON mp.product_id = mi.metrc_item_id
    LEFT JOIN brands b ON mi.brand_id = b.id
    WHERE mp.status = 'active'
      AND mp.quantity::numeric > 0
      AND (
        mp.label ILIKE ${pattern}
        OR mp.product_name ILIKE ${pattern}
        OR mi.item_name ILIKE ${pattern}
      )
    ORDER BY mp.updated_at DESC NULLS LAST, mp.id DESC
    LIMIT 50
  `;

  return rows.map((row) => normalizePackage(row as ManifestPackage)).filter((pkg) => pkg.tag && pkg.itemName);
}

export async function GET(request: NextRequest) {
  const search = request.nextUrl.searchParams.get('q')?.trim() ?? '';
  if (search.length < 2) {
    return NextResponse.json({ packages: [] });
  }

  const manifestBase = process.env.MANIFEST_API_BASE_URL ?? 'http://localhost:5000/api';
  const endpoint = new URL(`${manifestBase.replace(/\/$/, '')}/packages`);
  endpoint.searchParams.set('search', search);
  endpoint.searchParams.set('status', 'active');

  try {
    const databasePackages = await searchManifestDatabase(search);
    if (databasePackages) {
      return NextResponse.json({ packages: databasePackages });
    }

    const response = await fetch(endpoint, {
      headers: {
        Accept: 'application/json',
        ...(process.env.MANIFEST_COOKIE ? { Cookie: process.env.MANIFEST_COOKIE } : {}),
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `Manifest returned ${response.status}`, packages: [] },
        { status: response.status === 401 || response.status === 403 ? 200 : 502 },
      );
    }

    const data = await response.json();
    const packages = Array.isArray(data)
      ? data.map(normalizePackage).filter((pkg) => pkg.tag && pkg.itemName)
      : [];

    return NextResponse.json({ packages });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Could not reach Manifest',
        packages: [],
      },
      { status: 502 },
    );
  }
}
