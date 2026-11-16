import { detectUrlColumn } from '../csv';
import { bestCodeColumn, type CodeType } from '../runCodeColumns';

/**
 * How New run matches a design's parts to Nabis details, copied from
 * src/app/runs/new/page.tsx (findBestHeaderForField and its alias table) so
 * the kiosk fills a design exactly the way New run's automatic matching does.
 * New run keeps its own copy; this file changes nothing there.
 */
function normalizedFieldName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const FIELD_ALIASES: Record<string, string[]> = {
  strain: ['strain', 'productName', 'itemName'],
  product: ['productName', 'itemName'],
  size: ['quantity'],
  tac: ['tacPercent'],
  tacpercent: ['tacPercent', 'totalActiveCannabinoidsPercent'],
  totalactivecannabinoids: ['totalActiveCannabinoidsPercent', 'tacPercent'],
  totalactivecannabinoidspercent: ['totalActiveCannabinoidsPercent', 'tacPercent'],
  totalcannabinoids: ['totalCannabinoidsPercent'],
  totalcannabinoidspercent: ['totalCannabinoidsPercent'],
  tacmg: ['tacMgG'],
  tacmgg: ['tacMgG', 'totalActiveCannabinoidsMgG'],
  tacmggg: ['tacMgG', 'totalActiveCannabinoidsMgG'],
  tacmgpackage: ['tacMgPackage', 'totalActiveCannabinoidsMgPackage'],
  tacmgpkg: ['tacMgPackage', 'totalActiveCannabinoidsMgPackage'],
  tacperserving: ['tacMgServing', 'tacPerServing', 'totalActiveCannabinoidsMgServing'],
  tacmgserving: ['tacMgServing', 'tacPerServing', 'totalActiveCannabinoidsMgServing'],
  tacmgperserving: ['tacMgServing', 'tacPerServing', 'totalActiveCannabinoidsMgServing'],
  totalactivecannabinoidsmg: ['totalActiveCannabinoidsMgG', 'tacMgG'],
  totalactivecannabinoidsmgg: ['totalActiveCannabinoidsMgG', 'tacMgG'],
  totalactivecannabinoidsmgserving: ['totalActiveCannabinoidsMgServing', 'tacMgServing'],
  totalactivecannabinoidsperserving: ['totalActiveCannabinoidsMgServing', 'tacMgServing'],
  totalcannabinoidsmg: ['totalCannabinoidsMgG'],
  totalcannabinoidsmgg: ['totalCannabinoidsMgG'],
  thc: ['thcPercent'],
  thcpercent: ['thcPercent'],
  thcmg: ['thcMgG'],
  thcmgg: ['thcMgG'],
  thcmgpackage: ['thcMgPackage'],
  thcmgpkg: ['thcMgPackage'],
  thcperserving: ['thcMgServing', 'thcPerServing'],
  thcmgserving: ['thcMgServing', 'thcPerServing'],
  thcmgperserving: ['thcMgServing', 'thcPerServing'],
  cbd: ['cbdPercent'],
  cbdpercent: ['cbdPercent'],
  cbdmg: ['cbdMgG'],
  cbdmgg: ['cbdMgG'],
  cbdmgpackage: ['cbdMgPackage'],
  cbdmgpkg: ['cbdMgPackage'],
  cbdperserving: ['cbdMgServing', 'cbdPerServing'],
  cbdmgserving: ['cbdMgServing', 'cbdPerServing'],
  cbdmgperserving: ['cbdMgServing', 'cbdPerServing'],
  servingsize: ['servingSize'],
  serving: ['servingSize'],
  servings: ['servingCount', 'numberOfDoses', 'servingsPerPackage'],
  servingcount: ['servingCount', 'numberOfDoses', 'servingsPerPackage'],
  numberofdoses: ['numberOfDoses', 'servingCount', 'servingsPerPackage'],
  servingsperpackage: ['servingsPerPackage', 'servingCount', 'numberOfDoses'],
  qr1: ['retailId'],
  qrqpt: ['retailId'],
  qr: ['retailId'],
  qrcode: ['retailId'],
  retailid: ['retailId'],
  metrcretailid: ['retailId'],
  mfgdate: ['manufacturedDate', 'packagedDate'],
  manufactureddate: ['manufacturedDate', 'packagedDate'],
  packageddate: ['packagedDate', 'manufacturedDate'],
  expdate: ['expirationDate'],
  expirationdate: ['expirationDate'],
  lot: ['lotNumber', 'batchNumber', 'batch'],
  lotnumber: ['lotNumber', 'batchNumber', 'batch'],
  batch: ['batchNumber', 'lotNumber', 'batch'],
  batchnumber: ['batchNumber', 'lotNumber', 'batch'],
  uid: ['retailId', 'packageTag', 'tag'],
  packagetag: ['packageTag', 'tag'],
};

export function findBestHeaderForField(field: string, headers: string[], rows: Record<string, string>[], codeType?: CodeType) {
  const normalizedField = normalizedFieldName(field);
  const exact = headers.find((h) => normalizedFieldName(h) === normalizedField);
  if (exact) return exact;
  // A barcode or QR code named "Barcode 1": the column that looks like its
  // codes (SKU, UPC, a package tag; a link for a QR code).
  if (codeType && /^(barcode|qr ?code|qr)\s*\d*$/i.test(field.trim())) return bestCodeColumn(codeType, headers, rows);

  if (/^qr\d*$/.test(normalizedField) && headers.includes('retailId')) return 'retailId';

  for (const alias of FIELD_ALIASES[normalizedField] ?? []) {
    if (headers.includes(alias)) return alias;
  }

  if (codeType) {
    const column = bestCodeColumn(codeType, headers, rows);
    if (column) return column;
  }
  const urlCol = detectUrlColumn({ headers, rows });
  const isQrField = codeType === 'qr' || /qr|url|link/i.test(field);
  if (isQrField && urlCol) return urlCol;

  return null;
}
