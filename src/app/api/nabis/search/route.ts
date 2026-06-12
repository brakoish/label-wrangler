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

type MetrcPackage = {
  Id?: number | string | null;
  Label?: string | null;
  Item?: {
    Name?: string | null;
  } | null;
  ItemName?: string | null;
  ProductName?: string | null;
  ProductionBatchNumber?: string | null;
  SourceProductionBatchNumbers?: string | null;
  SourceHarvestNames?: string | null;
  Quantity?: number | string | null;
  UnitOfMeasureName?: string | null;
  UnitOfMeasure?: string | null;
  PackagedDate?: string | null;
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
  const digitSuffix = search.replace(/\D/g, '');
  const digitSuffixPattern = digitSuffix.length >= 4 ? `%${digitSuffix}` : '';
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
        OR (${digitSuffixPattern} <> '' AND regexp_replace(COALESCE(mp.label, ''), '[^0-9]', '', 'g') LIKE ${digitSuffixPattern})
        OR mp.product_name ILIKE ${pattern}
        OR mi.item_name ILIKE ${pattern}
      )
    ORDER BY mp.updated_at DESC NULLS LAST, mp.id DESC
    LIMIT 50
  `;

  return rows.map((row) => normalizePackage(row as ManifestPackage)).filter((pkg) => pkg.tag && pkg.itemName);
}

function looksLikeMetrcPackageTag(search: string) {
  return /^[A-Z0-9]{20,}$/.test(search.trim().toUpperCase());
}

function normalizeMetrcPackage(pkg: MetrcPackage) {
  const tag = cleanText(pkg.Label);
  const itemName = cleanText(pkg.Item?.Name) || cleanText(pkg.ItemName) || cleanText(pkg.ProductName);
  const batch =
    cleanText(pkg.ProductionBatchNumber) ||
    cleanText(pkg.SourceProductionBatchNumbers) ||
    cleanText(pkg.SourceHarvestNames);

  return normalizePackage({
    id: pkg.Id,
    label: tag,
    itemName,
    batchName: batch,
    quantity: pkg.Quantity,
    unitOfMeasure: cleanText(pkg.UnitOfMeasureName) || cleanText(pkg.UnitOfMeasure),
    packagedDate: pkg.PackagedDate,
  });
}

async function searchMetrcByExactTag(search: string) {
  if (!looksLikeMetrcPackageTag(search)) return null;

  const baseUrl = process.env.METRC_BASE_URL;
  const license = process.env.METRC_LICENSE_DISTRIBUTOR;
  const integratorKey = process.env.METRC_INTEGRATOR_KEY;
  const userKey = process.env.METRC_USER_KEY;
  if (!baseUrl || !license || !integratorKey || !userKey) return null;

  const endpoint = new URL(`/packages/v2/${encodeURIComponent(search.trim())}`, baseUrl);
  endpoint.searchParams.set('licenseNumber', license);

  const response = await fetch(endpoint, {
    headers: {
      Accept: 'application/json',
      Authorization: `Basic ${Buffer.from(`${integratorKey}:${userKey}`).toString('base64')}`,
    },
    cache: 'no-store',
  });

  if (response.status === 404) return [];
  if (!response.ok) throw new Error(`Metrc returned ${response.status}`);

  const data = (await response.json()) as MetrcPackage;
  const pkg = normalizeMetrcPackage(data);
  return pkg.tag && pkg.itemName ? [pkg] : [];
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
    if (databasePackages && databasePackages.length > 0) {
      return NextResponse.json({ packages: databasePackages });
    }

    const metrcPackages = await searchMetrcByExactTag(search);
    if (metrcPackages && metrcPackages.length > 0) {
      return NextResponse.json({ packages: metrcPackages });
    }

    if (databasePackages) {
      return NextResponse.json({ packages: [] });
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
