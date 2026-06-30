import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

type ManifestPackage = {
  id?: number | string | null;
  metrcPackageId?: number | string | null;
  label?: string | null;
  packageTag?: string | null;
  itemName?: string | null;
  productName?: string | null;
  strain?: string | null;
  brandName?: string | null;
  batchName?: string | null;
  batchNumber?: string | null;
  lotNumber?: string | null;
  sourceBatchNumbers?: string | null;
  sourceHarvestName?: string | null;
  quantity?: number | string | null;
  unitOfMeasure?: string | null;
  packagedDate?: string | null;
  manufacturedDate?: string | null;
  expirationDate?: string | null;
  sellByDate?: string | null;
  useByDate?: string | null;
  retailId?: string | null;
  retailIdSource?: string | null;
  thcPercent?: number | string | null;
  thcMgG?: number | string | null;
  thcMgPackage?: number | string | null;
  cbdPercent?: number | string | null;
  cbdMgG?: number | string | null;
  cbdMgPackage?: number | string | null;
  tacPercent?: number | string | null;
  tacMgG?: number | string | null;
  totalActiveCannabinoids?: number | string | null;
  totalActiveCannabinoidsPercent?: number | string | null;
  totalActiveCannabinoidsMgG?: number | string | null;
  labFacilityName?: string | null;
  testPerformedDate?: string | null;
  coaDocumentId?: number | string | null;
  units?: ManifestLabelUnit[] | null;
};

type ManifestLabelUnit = {
  retailId?: string | null;
  index?: number | string | null;
  packageTag?: string | null;
  batchNumber?: string | null;
  lotNumber?: string | null;
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

type MetrcRetailIds = {
  Eaches?: string[] | null;
  Ranges?: unknown;
  LabelSource?: string | null;
};

type MetrcLabResult = {
  TestTypeName?: string | null;
  TestResultLevel?: number | string | null;
};

type LabPotency = {
  thcPercent: string;
  thcMgPackage: string;
  tacPercent: string;
};

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function cleanValue(value: unknown): string {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  return cleanText(value);
}

function cleanDecimalValue(value: unknown): string {
  const text = cleanValue(value);
  if (!text) return '';

  const number = Number(text);
  if (!Number.isFinite(number)) return text;

  return number.toFixed(2).replace(/\.?0+$/, '');
}

function cleanPositiveDecimalValue(value: unknown): string {
  return hasPositiveNumber(value) ? cleanDecimalValue(value) : '';
}

function cleanDate(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return formatShortDate(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
  }
  const text = cleanText(value);
  const datePart = text.match(/^(\d{4})-(\d{2})-(\d{2})/)?.slice(1, 4).map(Number);
  if (datePart) return formatShortDate(datePart[0], datePart[1], datePart[2]);
  return text;
}

function formatShortDate(year: number, month: number, day: number): string {
  return `${month}/${day}/${String(year).slice(-2)}`;
}

function mgGFromPercent(value: string): string {
  if (!hasPositiveNumber(value)) return '';
  const number = Number(value);
  return Number.isFinite(number) ? cleanDecimalValue(number * 10) : '';
}

function hasPositiveNumber(value: unknown): boolean {
  const number = Number(cleanValue(value));
  return Number.isFinite(number) && number > 0;
}

function normalizePackage(pkg: ManifestPackage) {
  const tag = cleanText(pkg.packageTag) || cleanText(pkg.label);
  const itemName = cleanText(pkg.itemName) || cleanText(pkg.productName);
  const thcPercent = cleanDecimalValue(pkg.thcPercent);
  const thcMgG = cleanDecimalValue(pkg.thcMgG);
  const cbdPercent = cleanDecimalValue(pkg.cbdPercent);
  const cbdMgG = cleanDecimalValue(pkg.cbdMgG);
  const tacPercent =
    cleanPositiveDecimalValue(pkg.tacPercent) ||
    cleanPositiveDecimalValue(pkg.totalActiveCannabinoidsPercent) ||
    cleanPositiveDecimalValue(pkg.totalActiveCannabinoids);
  const tacMgG =
    cleanPositiveDecimalValue(pkg.tacMgG) ||
    cleanPositiveDecimalValue(pkg.totalActiveCannabinoidsMgG) ||
    mgGFromPercent(tacPercent);
  const batch =
    cleanText(pkg.lotNumber) ||
    cleanText(pkg.batchNumber) ||
    cleanText(pkg.batchName) ||
    cleanText(pkg.sourceBatchNumbers) ||
    cleanText(pkg.sourceHarvestName);

  return {
    id: String(pkg.id ?? tag),
    metrcPackageId: cleanValue(pkg.metrcPackageId),
    itemName,
    productName: cleanText(pkg.productName) || itemName,
    strain: cleanText(pkg.strain),
    tag,
    packageTag: tag,
    batch,
    lotNumber: cleanText(pkg.lotNumber) || batch,
    batchNumber: cleanText(pkg.batchNumber) || batch,
    sourceBatchNumbers: cleanText(pkg.sourceBatchNumbers),
    brandName: cleanText(pkg.brandName),
    quantity: pkg.quantity == null ? '' : String(pkg.quantity),
    unitOfMeasure: cleanText(pkg.unitOfMeasure),
    packagedDate: cleanDate(pkg.packagedDate) || cleanDate(pkg.manufacturedDate),
    manufacturedDate: cleanDate(pkg.manufacturedDate) || cleanDate(pkg.packagedDate),
    expirationDate: cleanDate(pkg.expirationDate),
    sellByDate: cleanDate(pkg.sellByDate),
    useByDate: cleanDate(pkg.useByDate),
    retailId: cleanText(pkg.retailId),
    retailIdSource: cleanText(pkg.retailIdSource),
    thcPercent,
    thcMgG,
    thcMgPackage: cleanDecimalValue(pkg.thcMgPackage),
    cbdPercent,
    cbdMgG,
    cbdMgPackage: cleanDecimalValue(pkg.cbdMgPackage),
    tacPercent,
    tacMgG,
    labFacilityName: cleanText(pkg.labFacilityName),
    testPerformedDate: cleanDate(pkg.testPerformedDate),
    coaDocumentId: cleanValue(pkg.coaDocumentId),
  };
}

function extractPotencyFromLabResults(results: unknown): LabPotency {
  const rows = Array.isArray(results) ? results : [];
  const potency: LabPotency = { thcPercent: '', thcMgPackage: '', tacPercent: '' };

  for (const result of rows as MetrcLabResult[]) {
    const name = cleanText(result.TestTypeName).toLowerCase();
    const value = cleanValue(result.TestResultLevel);
    if (!hasPositiveNumber(value)) continue;

    if (name.startsWith('total thc (%)')) {
      potency.thcPercent = potency.thcPercent || cleanDecimalValue(value);
    } else if (name.startsWith('total thc (mg/package)')) {
      potency.thcMgPackage = potency.thcMgPackage || cleanDecimalValue(value);
    } else if (
      name.startsWith('total active cannabinoids (%)') ||
      name.startsWith('total active cannabinoid (%)') ||
      name.startsWith('total active cannabinoids') ||
      name.startsWith('total active cannabinoid') ||
      name.startsWith('tac (%)')
    ) {
      potency.tacPercent = potency.tacPercent || cleanDecimalValue(value);
    }
  }

  return potency;
}

async function fetchMetrcLabPotency(packageId: string): Promise<LabPotency> {
  const baseUrl = process.env.METRC_BASE_URL;
  const license = process.env.METRC_LICENSE_DISTRIBUTOR;
  const integratorKey = process.env.METRC_INTEGRATOR_KEY;
  const userKey = process.env.METRC_USER_KEY;
  const empty: LabPotency = { thcPercent: '', thcMgPackage: '', tacPercent: '' };
  if (!baseUrl || !license || !integratorKey || !userKey || !packageId) return empty;

  const endpoint = new URL('/labtests/v2/results', baseUrl);
  endpoint.searchParams.set('packageId', packageId);
  endpoint.searchParams.set('licenseNumber', license);

  const response = await fetch(endpoint, {
    headers: {
      Accept: 'application/json',
      Authorization: `Basic ${Buffer.from(`${integratorKey}:${userKey}`).toString('base64')}`,
    },
    cache: 'no-store',
  });

  if (!response.ok) return empty;
  const data = await response.json();
  return extractPotencyFromLabResults(Array.isArray(data) ? data : data?.Data);
}

function expandRanges(ranges: unknown): number[] {
  if (!Array.isArray(ranges)) return [];
  const indices: number[] = [];
  for (const range of ranges) {
    if (!Array.isArray(range) || range.length !== 2) continue;
    const start = Number(range[0]);
    const end = Number(range[1]);
    if (!Number.isInteger(start) || !Number.isInteger(end)) continue;
    for (let index = start; index <= end; index++) {
      indices.push(index);
    }
  }
  return indices;
}

function rowsFromLabelData(data: ManifestPackage) {
  const base = normalizePackage(data);
  const units = Array.isArray(data.units) ? data.units : [];
  if (units.length === 0) return [base];

  return units.map((unit) => ({
    ...base,
    id: `${base.id}-${cleanValue(unit.index) || cleanText(unit.retailId)}`,
    retailId: cleanText(unit.retailId) || base.retailId,
    packageTag: cleanText(unit.packageTag) || base.packageTag,
    tag: cleanText(unit.packageTag) || base.tag,
    batchNumber: cleanText(unit.batchNumber) || base.batchNumber,
    lotNumber: cleanText(unit.lotNumber) || base.lotNumber,
    batch: cleanText(unit.lotNumber) || cleanText(unit.batchNumber) || base.batch,
    unitIndex: cleanValue(unit.index),
  }));
}

async function fetchMetrcRetailIdUnits(packageTag: string): Promise<ManifestLabelUnit[] | null> {
  const baseUrl = process.env.METRC_BASE_URL;
  const license = process.env.METRC_LICENSE_DISTRIBUTOR;
  const integratorKey = process.env.METRC_INTEGRATOR_KEY;
  const userKey = process.env.METRC_USER_KEY;
  if (!baseUrl || !license || !integratorKey || !userKey) return null;

  const endpoint = new URL(`/retailid/v2/receive/${encodeURIComponent(packageTag)}`, baseUrl);
  endpoint.searchParams.set('licenseNumber', license);

  const response = await fetch(endpoint, {
    headers: {
      Accept: 'application/json',
      Authorization: `Basic ${Buffer.from(`${integratorKey}:${userKey}`).toString('base64')}`,
    },
    cache: 'no-store',
  });

  if (!response.ok) return null;
  const data = (await response.json()) as MetrcRetailIds;
  const eaches = Array.isArray(data.Eaches) ? data.Eaches : [];
  const indices = expandRanges(data.Ranges);

  return eaches.map((retailId, index) => ({
    retailId,
    index: indices[index] ?? index + 1,
    packageTag,
  }));
}

async function rowsWithMetrcRetailIds(pkg: ReturnType<typeof normalizePackage>) {
  const packageTag = pkg.packageTag || pkg.tag;
  if (!packageTag) return [pkg];

  const units = await fetchMetrcRetailIdUnits(packageTag).catch(() => null);
  if (!units || units.length === 0) return [pkg];

  return rowsFromLabelData({
    ...pkg,
    retailIdSource: pkg.retailIdSource || 'Metrc',
    units,
  });
}

async function rowWithMetrcLabFallback(
  pkg: ReturnType<typeof normalizePackage>,
  options: { preferLabThc?: boolean } = {},
) {
  if (!pkg.metrcPackageId) return pkg;
  if (!options.preferLabThc && hasPositiveNumber(pkg.tacPercent)) return pkg;

  const potency = await fetchMetrcLabPotency(pkg.metrcPackageId).catch(() => ({
    thcPercent: '',
    thcMgPackage: '',
    tacPercent: '',
  }));
  const thcPercent = options.preferLabThc ? potency.thcPercent || pkg.thcPercent : pkg.thcPercent;
  const tacPercent = hasPositiveNumber(pkg.tacPercent) ? pkg.tacPercent : potency.tacPercent;

  return {
    ...pkg,
    thcPercent,
    thcMgG: potency.thcPercent ? mgGFromPercent(potency.thcPercent) : pkg.thcMgG,
    thcMgPackage: potency.thcMgPackage || pkg.thcMgPackage,
    tacPercent,
    tacMgG: potency.tacPercent ? mgGFromPercent(potency.tacPercent) : pkg.tacMgG,
  };
}

async function fetchManifestLabelRows(packageTag: string) {
  const manifestBase = process.env.MANIFEST_API_BASE_URL ?? 'http://localhost:5000/api';
  const endpoint = new URL(`${manifestBase.replace(/\/$/, '')}/retail-labels/label-data/${encodeURIComponent(packageTag)}`);
  endpoint.searchParams.set('includeRetailIds', 'true');

  const response = await fetch(endpoint, {
    headers: {
      Accept: 'application/json',
      ...(process.env.MANIFEST_COOKIE ? { Cookie: process.env.MANIFEST_COOKIE } : {}),
    },
    cache: 'no-store',
  });

  if (!response.ok) return null;
  const data = await response.json();
  return rowsFromLabelData(data as ManifestPackage);
}

async function enrichWithManifestLabelData(
  packages: ReturnType<typeof normalizePackage>[],
  options: { preferLabThc?: boolean } = {},
) {
  const enriched = await Promise.all(
    packages.slice(0, 25).map(async (pkg) => {
      const rows = await fetchManifestLabelRows(pkg.packageTag || pkg.tag).catch(() => null);
      const labPkg = await rowWithMetrcLabFallback(pkg, options);
      return rows && rows.length > 0
        ? Promise.all(rows.map((row) => rowWithMetrcLabFallback(row, options)))
        : rowsWithMetrcRetailIds(labPkg);
    }),
  );
  return enriched.flat();
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
      mp.metrc_package_id AS "metrcPackageId",
      mp.label,
      COALESCE(mi.item_name, mp.product_name) AS "itemName",
      mp.product_name AS "productName",
      b.name AS "brandName",
      mp.production_batch_number AS "batchNumber",
      mp.source_production_batch_numbers AS "sourceBatchNumbers",
      COALESCE(NULLIF(mp.production_batch_number, ''), NULLIF(mp.source_production_batch_numbers, ''), '') AS "lotNumber",
      mp.quantity,
      mp.unit_of_measure AS "unitOfMeasure",
      mp.packaged_date AS "packagedDate",
      mp.packaged_date AS "manufacturedDate",
      mp.expiration_date AS "expirationDate",
      mp.sell_by_date AS "sellByDate",
      mp.use_by_date AS "useByDate",
      CASE WHEN mp.thc_unit = 'mg' THEN NULL ELSE mp.total_thc_percent END AS "thcPercent",
      CASE WHEN mp.thc_unit = 'mg' THEN mp.total_thc_percent ELSE NULL END AS "thcMgPackage",
      CASE WHEN mp.thc_unit = 'mg' THEN NULL ELSE ROUND(mp.total_thc_percent * 10, 2) END AS "thcMgG",
      CASE WHEN mp.thc_unit = 'mg' THEN NULL ELSE mp.total_cbd_percent END AS "cbdPercent",
      CASE WHEN mp.thc_unit = 'mg' THEN mp.total_cbd_percent ELSE NULL END AS "cbdMgPackage",
      CASE WHEN mp.thc_unit = 'mg' THEN NULL ELSE ROUND(mp.total_cbd_percent * 10, 2) END AS "cbdMgG",
      mp.total_active_cannabinoids_percent AS "tacPercent",
      ROUND(mp.total_active_cannabinoids_percent * 10, 2) AS "tacMgG",
      mp.lab_facility_name AS "labFacilityName",
      mp.test_performed_date AS "testPerformedDate",
      mp.coa_document_id AS "coaDocumentId"
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
    metrcPackageId: pkg.Id,
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
  const isExactPackageSearch = looksLikeMetrcPackageTag(search);

  try {
    const databasePackages = await searchManifestDatabase(search);
    if (databasePackages && databasePackages.length > 0) {
      return NextResponse.json({
        packages: await enrichWithManifestLabelData(databasePackages, { preferLabThc: isExactPackageSearch }),
      });
    }

    const labelRows = isExactPackageSearch ? await fetchManifestLabelRows(search).catch(() => null) : null;
    if (labelRows && labelRows.length > 0) {
      return NextResponse.json({
        packages: await Promise.all(labelRows.map((row) => rowWithMetrcLabFallback(row, { preferLabThc: true }))),
      });
    }

    const metrcPackages = await searchMetrcByExactTag(search);
    if (metrcPackages && metrcPackages.length > 0) {
      return NextResponse.json({
        packages: await enrichWithManifestLabelData(metrcPackages, { preferLabThc: isExactPackageSearch }),
      });
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

    return NextResponse.json({ packages: await enrichWithManifestLabelData(packages) });
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
