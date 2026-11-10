'use client';

import type { CSSProperties } from 'react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import JsBarcode from 'jsbarcode';
import {
  Check,
  PackageCheck,
  Printer,
  Search,
  X,
} from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { IconSwap } from '@/components/motion/IconSwap';

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
  cases: string;
};

const EMPTY_LABEL: LabelInfo = {
  distributor: 'HR Botanical Distribution LLC',
  license: 'OCM-DIST-24-000114',
  itemName: '',
  batch: '',
  uid: '',
  unitsPerCase: '',
  cases: '',
};

function packageKey(pkg: PackageResult) {
  return pkg.tag || pkg.id || `${pkg.itemName}-${pkg.batch}`;
}

function uniquePackageResults(packages: PackageResult[]) {
  const seen = new Set<string>();
  const unique: PackageResult[] = [];

  for (const pkg of packages) {
    const key = packageKey(pkg);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(pkg);
  }

  return unique;
}

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
      className={`w-full text-center ${className}`}
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
  // Left blank (a line to write on) when empty, not a dash.
  const unitsText = label.unitsPerCase.trim() ? `${label.unitsPerCase.trim()} Units Per Case` : '____ Units Per Case';
  const casesText = label.cases.trim()
    ? `${label.cases.trim()} ${label.cases.trim() === '1' ? 'Case' : 'Cases'}`
    : '';

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
                {label.batch || '\u00a0'}
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
              {casesText ? `${unitsText}   ${casesText}` : unitsText}
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
        // The case label prints none of the details a slow search can miss
        // (retail IDs, lab potency), so a cut-short search needs no warning here.
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
  const visibleResults = useMemo(() => uniquePackageResults(results), [results]);

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
        <div className="page-container grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] [&>*]:min-w-0">
          <PageHeader
            className="lg:col-span-2"
            title="Nabis"
            subtitle={<>Print a 6&quot; × 4&quot; case label for a Nabis delivery.</>}
          />
          <section className="min-h-0 space-y-4">
            <div>
              <h2 className="mb-3 text-base font-semibold text-zinc-100">Find a package</h2>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search item name or tag"
                  aria-label="Search packages by item name or tag"
                  className="field w-full pl-9 pr-10"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery('')}
                    className="absolute right-0 top-1/2 inline-flex size-11 -translate-y-1/2 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 sm:right-1 sm:size-8"
                    aria-label="Clear search"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              {error && <p className="mt-2 text-sm text-amber-300">{error}</p>}
            </div>

            <div className="space-y-1.5 stagger">
              {isSearching && (
                <div className="rounded-lg bg-zinc-900 p-4 text-sm text-zinc-400">
                  Searching Nabis…
                </div>
              )}
              {!isSearching && query.trim().length < 2 && (
                <p className="px-1 text-sm text-zinc-400">Type two or more letters of an item name, or a Metrc tag. Packages show here.</p>
              )}
              {!isSearching && query.trim().length >= 2 && results.length === 0 && (
                <div className="rounded-lg bg-zinc-900 p-4 text-sm text-zinc-400">
                  No packages match. Check the name or tag, or type the details yourself.
                </div>
              )}
              {visibleResults.map((pkg) => {
                const active = selected ? packageKey(selected) === packageKey(pkg) : false;
                return (
                  <button
                    type="button"
                    key={packageKey(pkg)}
                    onClick={() => selectPackage(pkg)}
                    aria-pressed={active}
                    className={`w-full rounded-lg p-3 sm:p-4 text-left transition-colors ${
                      active
                        ? 'bg-zinc-800 shadow-[inset_2px_0_0_var(--color-amber-500)]'
                        : 'bg-zinc-900 hover:bg-zinc-800'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="break-words text-sm font-semibold text-zinc-100">{pkg.itemName}</p>
                        <p className="mt-1 break-all text-xs tabular-nums text-zinc-400">{pkg.tag}</p>
                      </div>
                      <IconSwap on={active} onIcon={<Check className="h-5 w-5 text-amber-400" />} offIcon={<PackageCheck className="h-5 w-5 text-zinc-400" />} />
                    </div>
                    <p className="mt-2 text-xs text-zinc-400">
                      {[pkg.batch && `Batch ${pkg.batch}`, pkg.quantity && `${pkg.quantity} ${pkg.unitOfMeasure ?? ''}`.trim(), pkg.brandName].filter(Boolean).join(' · ')}
                    </p>
                  </button>
                );
              })}
            </div>

          </section>

          <section className="min-h-0 space-y-5 [&>*]:min-w-0">
            <div>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-base font-semibold text-zinc-100">Check the label</h2>
                <div className="flex items-center gap-3">
                  {!canPrint && <span id="nabis-print-reason" className="text-sm text-zinc-400">{label.itemName.trim() || label.uid.trim() ? `Add the ${!label.itemName.trim() ? 'item description' : 'package tag'} to print` : 'Pick a package or type the details to print'}</span>}
                  <button
                    type="button"
                    disabled={!canPrint}
                    aria-describedby={!canPrint ? 'nabis-print-reason' : undefined}
                    onClick={() => window.print()}
                    className="btn btn-primary"
                  >
                    <Printer className="h-4 w-4" />
                    Print
                  </button>
                </div>
              </div>

              <div className="nabis-print mb-5">
                <LabelPreview label={label} />
              </div>

              <h3 className="mb-3 text-base font-semibold text-zinc-100">{selected ? 'Change the details' : 'Or type the details'}</h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 [&>*]:min-w-0">
                {(
                  [
                    ['distributor', 'Distributor'],
                    ['license', 'License'],
                    ['itemName', 'Item description'],
                    ['batch', 'Batch'],
                    ['uid', 'UID / package tag'],
                    ['unitsPerCase', 'Units per case'],
                    ['cases', 'Cases'],
                  ] as const
                ).map(([field, labelText]) => (
                  <label key={field} className={`block ${field === 'itemName' ? 'sm:col-span-2' : ''}`}>
                    <span className="field-label mb-1.5">{labelText}</span>
                    <input
                      value={label[field]}
                      onChange={(event) => setLabelField(field, event.target.value)}
                      className={`field w-full ${field === 'uid' ? 'tabular-nums' : ''}`}
                    />
                    {field === 'unitsPerCase' && !label.unitsPerCase.trim() && <span className="mt-1 block text-xs text-zinc-400">Empty prints a blank line to write on</span>}
                  </label>
                ))}
              </div>
            </div>
          </section>
        </div>
      </div>
    </AppShell>
  );
}
