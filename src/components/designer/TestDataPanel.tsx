'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Circle, Search, X } from 'lucide-react';
import { useRubberBand } from '@/components/motion/rubberBand';
import { TemplateElement } from '@/lib/types';
import { MANIFEST_FIELDS } from '@/lib/manifestFields';
import { SEARCH_DETAILS_INCOMPLETE } from '@/lib/userMessages';
import { friendlyFieldName } from '@/lib/fieldLabels';
import { designSampleValues } from '@/lib/sampleValues';

interface TestDataPanelProps {
  elements: TemplateElement[];
  testData: Record<string, string>;
  onTestDataChange: (fieldName: string, value: string) => void;
}

export function TestDataPanel({ elements, testData, onTestDataChange }: TestDataPanelProps) {
  const [manifestSearch, setManifestSearch] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  useRubberBand(scrollRef);
  const [manifestRows, setManifestRows] = useState<ManifestRow[]>([]);
  const [selectedManifestKey, setSelectedManifestKey] = useState<string | null>(null);
  const [isSearchingManifest, setIsSearchingManifest] = useState(false);
  const [manifestError, setManifestError] = useState<string | null>(null);
  const [hasSearchedManifest, setHasSearchedManifest] = useState(false);

  // Collect all unique dynamic field names
  const dynamicFields = elements
    .filter((e) => !e.isStatic && e.fieldName)
    .reduce((acc, e) => {
      if (e.fieldName && !acc.find((f) => f.fieldName === e.fieldName)) {
        acc.push({
          fieldName: e.fieldName,
          defaultValue: e.defaultValue || '',
          type: e.type,
          prefix: e.prefix || '',
          suffix: e.suffix || '',
        });
      }
      return acc;
    }, [] as { fieldName: string; defaultValue: string; type: string; prefix: string; suffix: string }[]);

  const samples = designSampleValues(elements);
  const fieldNames = JSON.stringify(dynamicFields.map(field => field.fieldName));
  const selectedRow = manifestRows.find(row => manifestPackageKey(row) === selectedManifestKey);
  const appliedFields = useRef<{ row: ManifestRow | undefined; names: Set<string> }>({ row: undefined, names: new Set() });
  useEffect(() => {
    const names: string[] = JSON.parse(fieldNames);
    const previous = appliedFields.current;
    appliedFields.current = { row: selectedRow, names: new Set(names) };
    if (!selectedRow) return;
    for (const name of names) {
      // Populate newly added/rebound fields without overwriting manual edits
      // to existing test values when an element moves or rerenders.
      if (previous.row === selectedRow && previous.names.has(name)) continue;
      const match = findBestManifestField(name, [selectedRow]);
      if (match) onTestDataChange(name, selectedRow[match] ?? '');
    }
  }, [fieldNames, selectedRow, onTestDataChange]);

  if (dynamicFields.length === 0) return <p className="px-4 py-3 text-sm text-zinc-400">Nothing on this label changes per label, so there is nothing to try.</p>;

  const manifestPackageSummaries = summarizeManifestPackages(manifestRows);
  const selectedManifest = selectedManifestKey
    ? manifestPackageSummaries.find(({ row }) => manifestPackageKey(row) === selectedManifestKey)
    : null;

  const applyManifestRow = (row: ManifestRow) => {
    for (const field of dynamicFields) {
      const match = findBestManifestField(field.fieldName, manifestRows);
      if (match) onTestDataChange(field.fieldName, row[match] ?? '');
    }
  };

  const selectManifestPackage = (key: string) => {
    const row = manifestRows.find((candidate) => manifestPackageKey(candidate) === key);
    if (!row) return;
    setSelectedManifestKey(key);
    applyManifestRow(row);
  };

  const searchManifest = async () => {
    const query = manifestSearch.trim();
    if (query.length < 2) return;

    setIsSearchingManifest(true);
    setManifestError(null);
    setHasSearchedManifest(true);

    try {
      const response = await fetch(`/api/nabis/search?q=${encodeURIComponent(query)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Couldn’t search Nabis');

      const rows = Array.isArray(data.packages) ? data.packages as ManifestRow[] : [];
      const summaries = summarizeManifestPackages(rows);
      setManifestRows(rows);
      setSelectedManifestKey(summaries[0] ? manifestPackageKey(summaries[0].row) : null);
      if (summaries[0]) {
        const firstKey = manifestPackageKey(summaries[0].row);
        const firstRow = rows.find((row) => manifestPackageKey(row) === firstKey) ?? summaries[0].row;
        for (const field of dynamicFields) {
          const match = findBestManifestField(field.fieldName, rows);
          if (match) onTestDataChange(field.fieldName, firstRow[match] ?? '');
        }
      }
      if (data.error) setManifestError(data.error);
      else if (data.detailsIncomplete) setManifestError(SEARCH_DETAILS_INCOMPLETE);
    } catch (error) {
      setManifestRows([]);
      setSelectedManifestKey(null);
      setManifestError(error instanceof Error ? error.message : 'Couldn’t search Nabis');
    } finally {
      setIsSearchingManifest(false);
    }
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {(
        <div ref={scrollRef} className="min-h-0 overflow-y-auto px-4 pb-4 pt-1 space-y-3">
          <p className="text-sm text-zinc-400">Try your own values. They only change the preview.</p>
          {dynamicFields.map((field) => (
            <label key={field.fieldName} className="block">
              <span className="mb-1 block text-sm font-medium text-zinc-300">{friendlyFieldName(field.fieldName)}</span>
              <span className="flex items-center gap-1.5">
                {field.prefix.trim() && <span className="shrink-0 text-sm text-zinc-400" aria-hidden="true">{field.prefix.trim()}</span>}
                <input
                  type="text"
                  value={testData[field.fieldName] ?? ''}
                  onChange={(e) => onTestDataChange(field.fieldName, e.target.value)}
                  placeholder={samples[field.fieldName] || ''}
                  className="field field-sm min-w-0 flex-1"
                />
                {field.suffix.trim() && <span className="shrink-0 text-sm text-zinc-400" aria-hidden="true">{field.suffix.trim()}</span>}
              </span>
            </label>
          ))}

          <div className="space-y-2 pt-2">
            <p className="text-sm text-zinc-400">Or fill them from a Nabis package</p>
            <div className="flex gap-1">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
                <input
                  type="text"
                  value={manifestSearch}
                  onChange={(e) => {
                    setManifestSearch(e.target.value);
                    setHasSearchedManifest(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void searchManifest();
                  }}
                  aria-label="Fill from a Nabis package"
                  placeholder="Name or tag"
                  className={`field field-sm w-full pl-7 ${manifestSearch ? 'pr-7' : ''}`}
                />
                {manifestSearch && (
                  <button
                    type="button"
                    onClick={() => {
                      setManifestSearch('');
                      setManifestRows([]);
                      setSelectedManifestKey(null);
                      setManifestError(null);
                      setHasSearchedManifest(false);
                    }}
                    className="absolute right-0.5 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-zinc-300"
                    aria-label="Clear Nabis search"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => void searchManifest()}
                disabled={manifestSearch.trim().length < 2 || isSearchingManifest}
                className="btn btn-secondary btn-sm"
              >
                {isSearchingManifest ? 'Searching' : 'Search'}
              </button>
            </div>

            {manifestError && <p className="text-xs text-amber-300">{manifestError}</p>}
            {selectedManifest && (
              <div className="rounded-lg bg-amber-500/10 px-2 py-1.5">
                <p className="truncate text-xs font-medium text-amber-300" title={selectedManifest.row.itemName}>
                  {selectedManifest.row.itemName || '(no item)'}
                </p>
                <div className="mt-0.5 flex items-center justify-between gap-2">
                  <p className="truncate text-xs text-amber-300 tabular-nums" title={selectedManifest.row.tag}>
                    {selectedManifest.row.tag || '(no tag)'}
                  </p>
                  <span className="shrink-0 text-xs text-amber-300">
                    {selectedManifest.labelRows.toLocaleString()} label{selectedManifest.labelRows === 1 ? '' : 's'}
                  </span>
                </div>
              </div>
            )}

            {manifestPackageSummaries.length > 0 && (
              <div className="max-h-36 overflow-auto space-y-px">
                {manifestPackageSummaries.map(({ row, labelRows }) => {
                  const key = manifestPackageKey(row);
                  const isSelected = key === selectedManifestKey;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => selectManifestPackage(key)}
                      className={`grid w-full grid-cols-[auto_minmax(0,1fr)_auto] gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
                        isSelected ? 'bg-amber-500/10 text-amber-300' : 'text-zinc-400 hover:bg-zinc-800'
                      }`}
                    >
                      <span className={isSelected ? 'text-amber-300' : 'text-zinc-400'}>
                        {isSelected ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5" />}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-zinc-300" title={row.itemName}>{row.itemName || '(no item)'}</span>
                        <span className="block truncate tabular-nums text-zinc-400" title={row.tag}>{row.tag || '(no tag)'}</span>
                      </span>
                      <span className={isSelected ? 'text-amber-300' : 'text-zinc-400'}>{labelRows}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {!isSearchingManifest && hasSearchedManifest && manifestRows.length === 0 && !manifestError && (
              <p className="text-xs text-zinc-400">No Nabis packages found.</p>
            )}
          </div>

          {Object.values(testData).some((v) => v) && (
            <button
              onClick={() => dynamicFields.forEach((f) => onTestDataChange(f.fieldName, ''))}
              className="btn btn-ghost btn-sm -ml-3"
            >
              Clear test data
            </button>
          )}
        </div>
      )}
    </div>
  );
}

type ManifestRow = Record<string, string>;

const MANIFEST_HEADERS = [...MANIFEST_FIELDS];

const FIELD_ALIASES: Record<string, string[]> = {
  strain: ['strain', 'productName', 'itemName'],
  product: ['productName', 'itemName'],
  productname: ['productName', 'itemName'],
  item: ['itemName', 'productName'],
  itemname: ['itemName', 'productName'],
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

function normalizedFieldName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function findBestManifestField(field: string, rows: ManifestRow[]) {
  const normalizedField = normalizedFieldName(field);
  const exact = MANIFEST_HEADERS.find((header) => normalizedFieldName(header) === normalizedField);
  if (exact) return exact;

  if (/^qr\d*$/.test(normalizedField) && MANIFEST_HEADERS.includes('retailId')) return 'retailId';

  for (const alias of FIELD_ALIASES[normalizedField] ?? []) {
    if (MANIFEST_HEADERS.includes(alias as (typeof MANIFEST_HEADERS)[number])) return alias;
  }

  if (/qr|url|code|tag/i.test(field)) {
    const retailIdRow = rows.find((row) => row.retailId);
    if (retailIdRow) return 'retailId';
    return 'packageTag';
  }

  return null;
}

function manifestPackageKey(row: ManifestRow) {
  return row.packageTag || row.tag || row.id || `${row.itemName}-${row.batch}`;
}

function summarizeManifestPackages(rows: ManifestRow[]) {
  const packages = new Map<string, { row: ManifestRow; labelRows: number }>();
  for (const row of rows) {
    const key = manifestPackageKey(row);
    const existing = packages.get(key);
    if (existing) {
      existing.labelRows += 1;
      continue;
    }
    packages.set(key, { row, labelRows: 1 });
  }
  return Array.from(packages.values());
}
