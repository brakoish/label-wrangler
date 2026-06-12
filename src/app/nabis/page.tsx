'use client';

import type { CSSProperties } from 'react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
  distributor: 'HR Botanical Distribution LLC',
  license: 'OCM-DIST-24-000114',
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

function FittedText({
  children,
  maxPx,
  minPx,
  className = '',
  uppercase = false,
  rows = 1,
  fontFamily = 'Arial, Helvetica, sans-serif',
  fontWeight = 600,
}: {
  children: string;
  maxPx: number;
  minPx: number;
  className?: string;
  uppercase?: boolean;
  rows?: number;
  fontFamily?: CSSProperties['fontFamily'];
  fontWeight?: CSSProperties['fontWeight'];
}) {
  const textRef = useRef<HTMLParagraphElement | null>(null);

  useLayoutEffect(() => {
    const text = textRef.current;
    const box = text?.parentElement;
    if (!text || !box) return;

    const fit = () => {
      const boxWidth = box.clientWidth;
      const boxHeight = box.clientHeight;
      if (!boxWidth || !boxHeight) return;

      let low = minPx;
      let high = maxPx;
      let best = minPx;

      for (let i = 0; i < 9; i += 1) {
        const mid = (low + high) / 2;
        text.style.fontSize = `${mid}px`;
        const fits = text.scrollWidth <= boxWidth + 0.5 && text.scrollHeight <= boxHeight + 0.5;

        if (fits) {
          best = mid;
          low = mid;
        } else {
          high = mid;
        }
      }

      text.style.fontSize = `${best}px`;
    };

    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(box);
    document.fonts?.ready.then(fit).catch(() => undefined);
    return () => observer.disconnect();
  }, [children, maxPx, minPx, rows]);

  return (
    <p
      ref={textRef}
      className={`w-full text-center tracking-normal ${className}`}
      style={{
        fontFamily,
        fontSize: maxPx,
        fontWeight,
        lineHeight: rows > 1 ? 1.03 : 1,
        maxHeight: '100%',
        overflow: 'hidden',
        overflowWrap: 'anywhere',
        textTransform: uppercase ? 'uppercase' : undefined,
        wordBreak: rows > 1 ? 'normal' : 'break-all',
      }}
    >
      {children}
    </p>
  );
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

function Barcode({
  value,
  className = 'h-[0.95in] w-full',
  barWidth = 2,
  stretch = false,
}: {
  value: string;
  className?: string;
  barWidth?: number;
  stretch?: boolean;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    if (!svgRef.current || !value.trim()) return;
    JsBarcode(svgRef.current, value.trim(), {
      format: 'CODE128',
      displayValue: false,
      margin: 0,
      height: 82,
      width: barWidth,
    });
    const width = svgRef.current.getAttribute('width');
    const height = svgRef.current.getAttribute('height');
    if (stretch && width && height) {
      svgRef.current.setAttribute('viewBox', `0 0 ${parseFloat(width)} ${parseFloat(height)}`);
      svgRef.current.setAttribute('preserveAspectRatio', 'none');
      svgRef.current.removeAttribute('width');
      svgRef.current.removeAttribute('height');
    }
  }, [barWidth, stretch, value]);

  return <svg ref={svgRef} className={className} style={{ shapeRendering: 'crispEdges' }} />;
}

function LabelPreview({ label }: { label: LabelInfo }) {
  return (
    <div className="mx-auto flex w-full max-w-[6in] justify-center">
      <section
        className="nabis-label aspect-[6/4] w-full bg-white p-[0.07in] text-black shadow-2xl shadow-black/30"
        style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}
      >
        <div className="grid h-full grid-rows-[0.47fr_0.54fr_0.3fr_0.3fr_0.3fr_1.43fr] gap-[0.02in] overflow-hidden border border-black p-[0.025in] font-sans">
          <div className="flex min-h-0 flex-col items-center justify-center gap-[0.015in] overflow-hidden border border-black px-[0.045in] py-[0.025in] text-center">
            <div className="flex min-h-0 w-full flex-1 items-center justify-center overflow-hidden">
              <FittedText maxPx={10.5} minPx={6.5} uppercase fontFamily="Arial, Helvetica, sans-serif">
                {label.distributor || 'HR Botanical Distribution LLC'}
              </FittedText>
            </div>
            <div className="flex min-h-0 w-full flex-1 items-center justify-center overflow-hidden">
              <FittedText maxPx={10.5} minPx={6.5} uppercase fontFamily="Arial, Helvetica, sans-serif">
                {label.license || 'OCM-DIST-24-000114'}
              </FittedText>
            </div>
          </div>

          <div className="flex min-h-0 items-center justify-center overflow-hidden border border-black px-[0.06in] text-center">
            <FittedText maxPx={12} minPx={7.5} rows={2}>
              {label.itemName || 'Item Description'}
            </FittedText>
          </div>

          <div className="grid min-h-0 grid-cols-[0.86in_1fr] gap-[0.022in]">
            <div className="flex items-center justify-center overflow-hidden border border-black px-[0.025in]">
              <FittedText maxPx={12} minPx={8} uppercase fontFamily="Arial, Helvetica, sans-serif">
                Batch
              </FittedText>
            </div>
            <div className="flex min-w-0 items-center justify-center overflow-hidden border border-black px-[0.045in]">
              <FittedText maxPx={12} minPx={7.5}>
                {label.batch || '-'}
              </FittedText>
            </div>
          </div>

          <div className="grid min-h-0 grid-cols-[0.86in_1fr] gap-[0.022in]">
            <div className="flex items-center justify-center overflow-hidden border border-black px-[0.025in]">
              <FittedText maxPx={12} minPx={8} uppercase fontFamily="Arial, Helvetica, sans-serif">
                UID
              </FittedText>
            </div>
            <div className="flex min-w-0 items-center justify-center overflow-hidden border border-black px-[0.045in]">
              <FittedText maxPx={11} minPx={6.5} fontFamily="Arial, Helvetica, sans-serif">
                {label.uid || 'Tag'}
              </FittedText>
            </div>
          </div>

          <div className="flex min-h-0 items-center justify-center overflow-hidden border border-black px-[0.045in] text-center">
            <FittedText maxPx={12} minPx={8} uppercase fontFamily="Arial, Helvetica, sans-serif">
              {`${label.unitsPerCase || '-'} Units Per Case`}
            </FittedText>
          </div>

          <div className="flex min-h-0 items-center justify-center overflow-hidden border border-black px-[0.13in] py-[0.04in]">
            {label.uid ? (
              <Barcode value={label.uid} barWidth={2} stretch className="h-full max-h-[1.08in] w-full" />
            ) : (
              <div className="h-full w-full border border-dashed border-black/30" />
            )}
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
            size: 6in 4in;
            margin: 0;
          }

          html,
          body {
            width: 6in;
            height: 4in;
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
            width: 6in !important;
            height: 4in !important;
          }

          .nabis-label {
            width: 6in !important;
            height: 4in !important;
            max-width: none !important;
            box-shadow: none !important;
            color: #000 !important;
            print-color-adjust: exact;
            -webkit-print-color-adjust: exact;
            text-shadow: none !important;
          }

          .nabis-label,
          .nabis-label * {
            font-synthesis: none;
          }

          .nabis-label svg,
          .nabis-label svg * {
            shape-rendering: crispEdges;
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
