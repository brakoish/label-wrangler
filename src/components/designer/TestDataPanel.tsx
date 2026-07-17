'use client';

import { useState } from 'react';
import { CheckCircle2, ChevronDown, Circle, FlaskConical, Search, X } from 'lucide-react';
import { TemplateElement } from '@/lib/types';
import { MANIFEST_FIELDS } from '@/lib/manifestFields';

interface TestDataPanelProps {
  elements: TemplateElement[];
  testData: Record<string, string>;
  onTestDataChange: (fieldName: string, value: string) => void;
}

export function TestDataPanel({ elements, testData, onTestDataChange }: TestDataPanelProps) {
  const [expanded, setExpanded] = useState(true);
  const [manifestSearch, setManifestSearch] = useState('');
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

  if (dynamicFields.length === 0) return null;

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
      if (!response.ok) throw new Error(data.error || 'Manifest search failed');

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
    } catch (error) {
      setManifestRows([]);
      setSelectedManifestKey(null);
      setManifestError(error instanceof Error ? error.message : 'Manifest search failed');
    } finally {
      setIsSearchingManifest(false);
    }
  };

  return (
    <div className="shrink-0 max-h-[45%] min-h-0 border-t border-zinc-800/50 flex flex-col">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full shrink-0 flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-zinc-800/30 transition-all"
      >
        <FlaskConical className="w-4 h-4 text-amber-400" />
        <span className="text-zinc-300 font-medium flex-1 text-left">Test Data</span>
        <span className="text-[10px] text-zinc-500 mr-1">{dynamicFields.length} field{dynamicFields.length !== 1 ? 's' : ''}</span>
        <ChevronDown className={`w-3.5 h-3.5 text-zinc-500 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {expanded && (
        <div className="min-h-0 overflow-y-auto px-4 pb-4 space-y-2">
          <div className="space-y-2 rounded-lg border border-zinc-800/50 bg-zinc-950/30 p-2">
            <div className="flex gap-1">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-600" />
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
                  placeholder="Search Manifest package"
                  className="h-7 w-full rounded-lg border border-zinc-800/50 bg-zinc-900/60 pl-7 pr-7 text-xs text-zinc-100 outline-none transition-all placeholder-zinc-600 focus:border-amber-500/30"
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
                    className="absolute right-1 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-md text-zinc-600 hover:bg-zinc-800 hover:text-zinc-300"
                    aria-label="Clear Manifest search"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => void searchManifest()}
                disabled={manifestSearch.trim().length < 2 || isSearchingManifest}
                className="h-7 rounded-lg border border-zinc-800/50 bg-zinc-900 px-2 text-[10px] font-medium text-zinc-300 transition-all hover:border-amber-500/30 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isSearchingManifest ? 'Searching' : 'Search'}
              </button>
            </div>

            {manifestError && <p className="text-[10px] text-amber-400">{manifestError}</p>}
            {selectedManifest && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-1.5">
                <p className="truncate text-xs font-medium text-amber-100" title={selectedManifest.row.itemName}>
                  {selectedManifest.row.itemName || '(no item)'}
                </p>
                <div className="mt-0.5 flex items-center justify-between gap-2">
                  <p className="truncate font-mono text-[10px] text-amber-200/70" title={selectedManifest.row.tag}>
                    {selectedManifest.row.tag || '(no tag)'}
                  </p>
                  <span className="shrink-0 text-[10px] text-amber-200/70">
                    {selectedManifest.labelRows.toLocaleString()} label{selectedManifest.labelRows === 1 ? '' : 's'}
                  </span>
                </div>
              </div>
            )}

            {manifestPackageSummaries.length > 0 && (
              <div className="max-h-36 overflow-auto rounded-lg border border-zinc-800/50">
                {manifestPackageSummaries.map(({ row, labelRows }) => {
                  const key = manifestPackageKey(row);
                  const isSelected = key === selectedManifestKey;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => selectManifestPackage(key)}
                      className={`grid w-full grid-cols-[auto_minmax(0,1fr)_auto] gap-2 border-b border-zinc-900 px-2 py-1.5 text-left text-[10px] transition-colors last:border-b-0 ${
                        isSelected ? 'bg-amber-500/10 text-amber-200' : 'text-zinc-500 hover:bg-zinc-900/70'
                      }`}
                    >
                      <span className={isSelected ? 'text-amber-300' : 'text-zinc-700'}>
                        {isSelected ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5" />}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-zinc-300" title={row.itemName}>{row.itemName || '(no item)'}</span>
                        <span className="block truncate font-mono text-zinc-600" title={row.tag}>{row.tag || '(no tag)'}</span>
                      </span>
                      <span className={isSelected ? 'text-amber-300' : 'text-zinc-600'}>{labelRows}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {!isSearchingManifest && hasSearchedManifest && manifestRows.length === 0 && !manifestError && (
              <p className="text-[10px] text-zinc-600">No Manifest packages found.</p>
            )}
          </div>

          {dynamicFields.map((field) => (
            <div key={field.fieldName}>
              <div className="flex items-center gap-1 mb-1">
                <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">{field.fieldName}</span>
                {(field.prefix || field.suffix) && (
                  <span className="text-[10px] text-zinc-600">
                    {field.prefix && `"${field.prefix}"`}
                    {field.prefix && field.suffix && ' · '}
                    {field.suffix && `"${field.suffix}"`}
                  </span>
                )}
              </div>
              <input
                type="text"
                value={testData[field.fieldName] ?? ''}
                onChange={(e) => onTestDataChange(field.fieldName, e.target.value)}
                placeholder={field.defaultValue || `Enter ${field.fieldName}...`}
                className="w-full bg-zinc-900/60 border border-zinc-800/50 rounded-lg text-xs text-zinc-100 px-2.5 h-7 focus:outline-none focus:border-amber-500/30 placeholder-zinc-600 transition-all"
              />
            </div>
          ))}

          {Object.values(testData).some((v) => v) && (
            <button
              onClick={() => dynamicFields.forEach((f) => onTestDataChange(f.fieldName, ''))}
              className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
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
  totalactivecannabinoidsmg: ['totalActiveCannabinoidsMgG', 'tacMgG'],
  totalactivecannabinoidsmgg: ['totalActiveCannabinoidsMgG', 'tacMgG'],
  totalcannabinoidsmg: ['totalCannabinoidsMgG'],
  totalcannabinoidsmgg: ['totalCannabinoidsMgG'],
  thc: ['thcPercent'],
  thcpercent: ['thcPercent'],
  thcmg: ['thcMgG'],
  thcmgg: ['thcMgG'],
  cbd: ['cbdPercent'],
  cbdpercent: ['cbdPercent'],
  cbdmg: ['cbdMgG'],
  cbdmgg: ['cbdMgG'],
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
