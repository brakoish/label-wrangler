'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import JsBarcode from 'jsbarcode';
import {
  Check,
  Edit3,
  PackageCheck,
  Plus,
  Printer,
  Search,
  X,
} from 'lucide-react';
import { AppShell } from '@/components/AppShell';

type PackageResult = {
  id: string;
  itemName: string;
  tag: string;
  batch: string;
  brandName: string;
  quantity: string;
  unitOfMeasure: string;
  packagedDate: string;
};

type LabelInfo = {
  distributor: string;
  license: string;
  itemName: string;
  batch: string;
  uid: string;
  unitsPerCase: string;
};

const EMPTY_LABEL: LabelInfo = {
  distributor: 'Excelsior Legacy',
  license: '',
  itemName: '',
  batch: '',
  uid: '',
  unitsPerCase: '',
};

function toLabelInfo(pkg: PackageResult): LabelInfo {
  return {
    ...EMPTY_LABEL,
    itemName: pkg.itemName,
    batch: pkg.batch,
    uid: pkg.tag,
  };
}

function ManualPackageForm({ onAdd }: { onAdd: (pkg: PackageResult) => void }) {
  const [itemName, setItemName] = useState('');
  const [tag, setTag] = useState('');
  const [batch, setBatch] = useState('');

  const canAdd = itemName.trim().length > 0 && tag.trim().length > 0;

  return (
    <form
      className="grid grid-cols-1 gap-3 rounded-lg border border-zinc-800/70 bg-zinc-950/40 p-4 sm:grid-cols-[1.6fr_1.2fr_1fr_auto]"
      onSubmit={(event) => {
        event.preventDefault();
        if (!canAdd) return;
        onAdd({
          id: `manual-${tag.trim()}`,
          itemName: itemName.trim(),
          tag: tag.trim(),
          batch: batch.trim(),
          brandName: '',
          quantity: '',
          unitOfMeasure: '',
          packagedDate: '',
        });
        setItemName('');
        setTag('');
        setBatch('');
      }}
    >
      <input
        value={itemName}
        onChange={(event) => setItemName(event.target.value)}
        placeholder="Item name"
        className="h-11 rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-white outline-none focus:border-amber-500/70"
      />
      <input
        value={tag}
        onChange={(event) => setTag(event.target.value)}
        placeholder="Package tag"
        className="h-11 rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-white outline-none focus:border-amber-500/70"
      />
      <input
        value={batch}
        onChange={(event) => setBatch(event.target.value)}
        placeholder="Batch"
        className="h-11 rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-white outline-none focus:border-amber-500/70"
      />
      <button
        type="submit"
        disabled={!canAdd}
        className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-amber-600 px-4 text-sm font-semibold text-white transition hover:bg-amber-500 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
      >
        <Plus className="h-4 w-4" />
        Add
      </button>
    </form>
  );
}

function Barcode({ value }: { value: string }) {
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    if (!svgRef.current || !value.trim()) return;
    JsBarcode(svgRef.current, value.trim(), {
      format: 'CODE128',
      displayValue: false,
      margin: 0,
      height: 82,
      width: 2,
    });
  }, [value]);

  return <svg ref={svgRef} className="h-[0.95in] w-full" />;
}

function LabelPreview({ label }: { label: LabelInfo }) {
  return (
    <div className="mx-auto flex w-full max-w-[4in] justify-center">
      <section className="nabis-label aspect-[4/6] w-full bg-white p-[0.22in] text-black shadow-2xl shadow-black/30">
        <div className="flex h-full flex-col border-[2px] border-black p-[0.12in] font-sans">
          <div className="border-b-[2px] border-black pb-[0.1in] text-center">
            <p className="text-[13pt] font-black uppercase leading-tight">Nabis Pickup</p>
            <p className="text-[8pt] font-bold uppercase tracking-wide">{label.distributor || 'Distributor'}</p>
            <p className="text-[7pt] uppercase">{label.license || 'License'}</p>
          </div>

          <div className="grid border-b-[2px] border-black">
            <div className="border-b border-black p-[0.08in]">
              <p className="text-[6pt] font-black uppercase tracking-wide">Item Description</p>
              <p className="mt-[0.03in] min-h-[0.58in] break-words text-[13pt] font-black leading-[1.05]">
                {label.itemName || 'Item name'}
              </p>
            </div>
            <div className="grid grid-cols-2">
              <div className="border-r border-black p-[0.08in]">
                <p className="text-[6pt] font-black uppercase tracking-wide">Batch</p>
                <p className="mt-[0.03in] break-words text-[10pt] font-bold">{label.batch || '-'}</p>
              </div>
              <div className="p-[0.08in]">
                <p className="text-[6pt] font-black uppercase tracking-wide">Units Per Case</p>
                <p className="mt-[0.03in] text-[18pt] font-black leading-none">{label.unitsPerCase || '-'}</p>
              </div>
            </div>
          </div>

          <div className="border-b-[2px] border-black p-[0.08in]">
            <p className="text-[6pt] font-black uppercase tracking-wide">UID / Package Tag</p>
            <p className="mt-[0.03in] break-all font-mono text-[8.5pt] font-bold leading-tight">{label.uid || 'Tag'}</p>
          </div>

          <div className="flex flex-1 items-end px-[0.04in] pb-[0.02in] pt-[0.14in]">
            {label.uid ? <Barcode value={label.uid} /> : <div className="h-[0.95in] w-full border border-dashed border-black/30" />}
          </div>
        </div>
      </section>
    </div>
  );
}

export default function NabisPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PackageResult[]>([]);
  const [selected, setSelected] = useState<PackageResult | null>(null);
  const [label, setLabel] = useState<LabelInfo>(EMPTY_LABEL);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setError('');
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setIsSearching(true);
      setError('');
      try {
        const response = await fetch(`/api/nabis/search?q=${encodeURIComponent(trimmed)}`, {
          signal: controller.signal,
        });
        const data = await response.json();
        setResults(Array.isArray(data.packages) ? data.packages : []);
        if (data.error) setError(data.error);
      } catch (fetchError) {
        if (!controller.signal.aborted) {
          setError(fetchError instanceof Error ? fetchError.message : 'Search failed');
          setResults([]);
        }
      } finally {
        if (!controller.signal.aborted) setIsSearching(false);
      }
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [query]);

  const canPrint = useMemo(() => label.itemName.trim() && label.uid.trim(), [label.itemName, label.uid]);

  const selectPackage = (pkg: PackageResult) => {
    setSelected(pkg);
    setLabel(toLabelInfo(pkg));
  };

  const setLabelField = (field: keyof LabelInfo, value: string) => {
    setLabel((current) => ({ ...current, [field]: value }));
  };

  return (
    <AppShell>
      <style jsx global>{`
        @media print {
          @page {
            size: 4in 6in;
            margin: 0;
          }

          html,
          body {
            width: 4in;
            height: 6in;
            margin: 0 !important;
            background: white !important;
          }

          body * {
            visibility: hidden;
          }

          .nabis-print,
          .nabis-print * {
            visibility: visible;
          }

          .nabis-print {
            position: fixed !important;
            inset: 0 !important;
            width: 4in !important;
            height: 6in !important;
          }

          .nabis-label {
            width: 4in !important;
            height: 6in !important;
            max-width: none !important;
            box-shadow: none !important;
          }
        }
      `}</style>

      <div className="flex-1 overflow-auto">
        <div className="mx-auto grid w-full max-w-[1500px] grid-cols-1 gap-5 p-4 lg:grid-cols-[minmax(420px,0.95fr)_minmax(420px,1.05fr)] lg:p-6">
          <section className="min-h-0 space-y-4">
            <div className="rounded-lg border border-zinc-800/70 bg-zinc-950/35 p-4">
              <div className="mb-3 flex items-center gap-2">
                <Search className="h-4 w-4 text-amber-400" />
                <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-200">Find Package</h2>
              </div>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search item name or tag"
                  className="h-12 w-full rounded-lg border border-zinc-800 bg-zinc-950 pl-10 pr-10 text-sm text-white outline-none focus:border-amber-500/70"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery('')}
                    className="absolute right-2 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-900 hover:text-white"
                    aria-label="Clear search"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              {error && <p className="mt-2 text-xs text-amber-300">{error}</p>}
            </div>

            <div className="space-y-2">
              {isSearching && (
                <div className="rounded-lg border border-zinc-800/70 bg-zinc-950/40 p-4 text-sm text-zinc-400">
                  Searching Manifest...
                </div>
              )}
              {!isSearching && query.trim().length >= 2 && results.length === 0 && (
                <div className="rounded-lg border border-zinc-800/70 bg-zinc-950/40 p-4 text-sm text-zinc-400">
                  No matching packages.
                </div>
              )}
              {results.map((pkg) => {
                const active = selected?.id === pkg.id;
                return (
                  <button
                    type="button"
                    key={`${pkg.id}-${pkg.tag}`}
                    onClick={() => selectPackage(pkg)}
                    className={`w-full rounded-lg border p-4 text-left transition ${
                      active
                        ? 'border-amber-500/70 bg-amber-500/10'
                        : 'border-zinc-800/70 bg-zinc-950/40 hover:border-zinc-700 hover:bg-zinc-900/70'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="break-words text-sm font-semibold text-white">{pkg.itemName}</p>
                        <p className="mt-1 break-all font-mono text-xs text-zinc-400">{pkg.tag}</p>
                      </div>
                      {active ? <Check className="h-5 w-5 shrink-0 text-amber-300" /> : <PackageCheck className="h-5 w-5 shrink-0 text-zinc-500" />}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs text-zinc-500">
                      {pkg.batch && <span className="rounded-md bg-zinc-900 px-2 py-1">Batch {pkg.batch}</span>}
                      {pkg.quantity && <span className="rounded-md bg-zinc-900 px-2 py-1">{pkg.quantity} {pkg.unitOfMeasure}</span>}
                      {pkg.brandName && <span className="rounded-md bg-zinc-900 px-2 py-1">{pkg.brandName}</span>}
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="rounded-lg border border-zinc-800/70 bg-zinc-950/35 p-4">
              <div className="mb-3 flex items-center gap-2">
                <Plus className="h-4 w-4 text-zinc-400" />
                <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-200">Manual Package</h2>
              </div>
              <ManualPackageForm
                onAdd={(pkg) => {
                  setResults((current) => [pkg, ...current.filter((item) => item.tag !== pkg.tag)]);
                  selectPackage(pkg);
                }}
              />
            </div>
          </section>

          <section className="grid min-h-0 grid-cols-1 gap-5 xl:grid-cols-[minmax(300px,0.8fr)_minmax(340px,1fr)]">
            <div className="rounded-lg border border-zinc-800/70 bg-zinc-950/35 p-4">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Edit3 className="h-4 w-4 text-amber-400" />
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-200">Confirm Label</h2>
                </div>
                <button
                  type="button"
                  disabled={!canPrint}
                  onClick={() => window.print()}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
                >
                  <Printer className="h-4 w-4" />
                  Print
                </button>
              </div>

              <div className="space-y-3">
                {(
                  [
                    ['distributor', 'Distributor'],
                    ['license', 'License'],
                    ['itemName', 'Item Description'],
                    ['batch', 'Batch'],
                    ['uid', 'UID / Package Tag'],
                    ['unitsPerCase', 'Units Per Case'],
                  ] as const
                ).map(([field, labelText]) => (
                  <label key={field} className="block">
                    <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">{labelText}</span>
                    <input
                      value={label[field]}
                      onChange={(event) => setLabelField(field, event.target.value)}
                      className="h-11 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-white outline-none focus:border-amber-500/70"
                    />
                  </label>
                ))}
              </div>
            </div>

            <div className="nabis-print">
              <LabelPreview label={label} />
            </div>
          </section>
        </div>
      </div>
    </AppShell>
  );
}
