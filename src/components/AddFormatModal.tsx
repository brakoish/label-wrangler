'use client';

import { useState, useCallback, useId } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { LabelType, COMMON_THERMAL_SIZES, COMMON_DPI_VALUES } from '@/lib/types';
import { useFormatStore } from '@/lib/store';
import { parsePDFFile, generateFormatName } from '@/lib/pdfParser';
import { PlusIcon, FileIcon } from '@/app/icons';
import { SegmentedIndicator } from '@/components/ui/Segmented';
import { CustomSelect } from '@/components/ui/CustomSelect';

interface AddFormatModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AddFormatModal({ isOpen, onClose }: AddFormatModalProps) {
  const uid = useId();
  const addFormat = useFormatStore((s) => s.addFormat);

  const [type, setType] = useState<LabelType>('thermal');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const [width, setWidth] = useState('2');
  const [height, setHeight] = useState('1');
  const [dpi, setDpi] = useState(203);
  const [labelsAcross, setLabelsAcross] = useState(1);
  const [linerWidth, setLinerWidth] = useState('');
  const [horizontalGapThermal, setHorizontalGapThermal] = useState('0');
  const [sideMarginThermal, setSideMarginThermal] = useState('0');
  const [labelGap, setLabelGap] = useState('0.125');

  const [columns, setColumns] = useState('3');
  const [rows, setRows] = useState('10');
  const [topMargin, setTopMargin] = useState('0.5');
  const [sideMargin, setSideMargin] = useState('0.1875');
  const [horizontalGap, setHorizontalGap] = useState('0.125');
  const [verticalGap, setVerticalGap] = useState('0');

  const [isParsing, setIsParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [pdfUploaded, setPdfUploaded] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const baseFormat = {
      name: name || (type === 'thermal' ? 'Custom Thermal' : 'Custom Sheet'),
      description: description || undefined,
      type,
      width: parseFloat(width) || 2,
      height: parseFloat(height) || 1,
    };

    if (type === 'thermal') {
      await addFormat({
        ...baseFormat,
        dpi,
        labelsAcross,
        linerWidth: parseFloat(linerWidth) || undefined,
        horizontalGapThermal: parseFloat(horizontalGapThermal) || 0,
        sideMarginThermal: parseFloat(sideMarginThermal) || 0,
        labelGap: parseFloat(labelGap) || 0,
      });
    } else {
      const cols = parseInt(columns) || 1;
      const rowCount = parseInt(rows) || 1;

      await addFormat({
        ...baseFormat,
        sheetWidth: 8.5,
        sheetHeight: 11,
        columns: cols,
        rows: rowCount,
        topMargin: parseFloat(topMargin) || 0,
        sideMargin: parseFloat(sideMargin) || 0,
        horizontalGap: parseFloat(horizontalGap) || 0,
        verticalGap: parseFloat(verticalGap) || 0,
      });
    }

    onClose();
    resetForm();
  };

  const resetForm = () => {
    setName('');
    setDescription('');
    setWidth('2');
    setHeight('1');
    setDpi(203);
    setLabelsAcross(1);
    setLinerWidth('');
    setHorizontalGapThermal('0');
    setSideMarginThermal('0');
    setLabelGap('0.125');
    setColumns('3');
    setRows('10');
    setTopMargin('0.5');
    setSideMargin('0.1875');
    setHorizontalGap('0.125');
    setVerticalGap('0');
    setParseError(null);
    setPdfUploaded(false);
  };

  const applyPreset = (preset: (typeof COMMON_THERMAL_SIZES)[number]) => {
    setWidth(preset.width.toString());
    setHeight(preset.height.toString());
    setName(`${preset.name} Thermal`);
  };

  const handlePDFUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsParsing(true);
    setParseError(null);
    setPdfUploaded(true);

    try {
      const result = await parsePDFFile(file);

      if (result.success && result.spec) {
        const spec = result.spec;
        
        // Auto-fill form based on parsed spec
        setType(spec.type);
        setName(generateFormatName(spec));
        setDescription(`Imported from ${file.name}`);

        if (spec.type === 'thermal') {
          setWidth(spec.width.toFixed(3));
          setHeight(spec.height.toFixed(3));
        } else {
          setWidth(spec.width.toFixed(3));
          setHeight(spec.height.toFixed(3));
          setColumns(spec.columns?.toString() || '3');
          setRows(spec.rows?.toString() || '10');
          setTopMargin((spec.topMargin || 0).toFixed(3));
          setSideMargin((spec.sideMargin || 0).toFixed(3));
          setHorizontalGap((spec.horizontalGap || 0).toFixed(3));
          setVerticalGap((spec.verticalGap || 0).toFixed(3));
        }
      } else {
        setParseError(result.error || 'Failed to parse PDF');
        setPdfUploaded(false);
      }
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Failed to parse PDF');
      setPdfUploaded(false);
    } finally {
      setIsParsing(false);
    }
  }, []);

  return (
    <Dialog open={isOpen} onClose={onClose} title="New label size" className="max-w-lg">
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Type Toggle */}
          <div className="segmented" role="group" aria-label="Label type">
            <SegmentedIndicator index={type === 'sheet' ? 1 : 0} count={2} />
            <button
              type="button"
              data-autofocus
              onClick={() => setType('thermal')}
              aria-pressed={type === 'thermal'}
            >
              Thermal roll
            </button>
            <button
              type="button"
              onClick={() => setType('sheet')}
              aria-pressed={type === 'sheet'}
            >
              Sheet labels
            </button>
          </div>

          {/* PDF Upload - Sheet labels only */}
          {type === 'sheet' && (
            <div>
              <label htmlFor={`${uid}-1`} className="field-label mb-1.5">
                Import from a PDF template
              </label>
              <div className="relative">
                <input id={`${uid}-1`}
                  type="file"
                  accept=".pdf"
                  onChange={handlePDFUpload}
                  disabled={isParsing}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
                />
                <div className={`
                  flex min-h-control items-center justify-center gap-3 px-4 py-3 rounded-lg border border-dashed transition-colors
                  ${isParsing
                    ? 'border-amber-500/30 bg-amber-500/10'
                    : 'border-zinc-700 hover:border-zinc-500 bg-zinc-950'
                  }
                `}>
                  {isParsing ? (
                    <>
                      <div className="size-4 rounded-full border-2 border-amber-500 border-t-transparent animate-spin" aria-hidden="true" />
                      <span className="text-sm text-amber-400">Reading the PDF…</span>
                    </>
                  ) : (
                    <>
                      <FileIcon className="w-5 h-5 text-zinc-400" />
                      <span className="text-sm text-zinc-400">
                        Drop PDF or <span className="text-amber-400">browse</span>
                      </span>
                    </>
                  )}
                </div>
              </div>
              {parseError && (
                <p className="mt-2 text-xs text-red-400">{parseError}</p>
              )}
            </div>
          )}

          {/* Preview - for sheet labels */}
          {type === 'sheet' && pdfUploaded && !isParsing && parseInt(columns) > 0 && parseInt(rows) > 0 && parseFloat(width) > 0 && parseFloat(height) > 0 && (
            <div className="rounded-lg bg-zinc-950 p-4">
              <p className="field-label mb-1.5">
                Layout preview
              </p>
              <SheetPreview
                labelWidth={parseFloat(width) || 1}
                labelHeight={parseFloat(height) || 1}
                columns={parseInt(columns) || 1}
                rows={parseInt(rows) || 1}
                topMargin={parseFloat(topMargin) || 0}
                sideMargin={parseFloat(sideMargin) || 0}
                horizontalGap={parseFloat(horizontalGap) || 0}
                verticalGap={parseFloat(verticalGap) || 0}
              />
            </div>
          )}

          {/* Name & Description */}
          <div className="space-y-4">
            <div>
              <label htmlFor={`${uid}-2`} className="field-label mb-1.5">
                Name
              </label>
              <input id={`${uid}-2`}
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={type === 'thermal' ? 'e.g., 2" × 1" Thermal' : 'e.g., Avery 5160'}
                className="field w-full"
              />
            </div>
            <div>
              <label htmlFor={`${uid}-3`} className="field-label mb-1.5">
                Description <span className="font-normal text-zinc-500">(optional)</span>
              </label>
              <input id={`${uid}-3`}
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g., Standard shipping label"
                className="field w-full"
              />
            </div>
          </div>

          {/* Thermal Presets */}
          {type === 'thermal' && (
            <div>
              <p className="field-label mb-1.5">
                Common sizes
              </p>
              <div className="flex flex-wrap gap-2">
                {COMMON_THERMAL_SIZES.map((preset) => (
                  <button
                    key={preset.name}
                    type="button"
                    onClick={() => applyPreset(preset)}
                    className="btn btn-secondary btn-sm"
                  >
                    {preset.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Dimensions */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor={`${uid}-4`} className="field-label mb-1.5">
                Width <span className="font-normal text-zinc-500">(inches)</span>
              </label>
              <input id={`${uid}-4`}
                type="number"
                step="0.001"
                min="0.1"
                value={width}
                onChange={(e) => setWidth(e.target.value)}
                className="field w-full"
              />
            </div>
            <div>
              <label htmlFor={`${uid}-5`} className="field-label mb-1.5">
                Height <span className="font-normal text-zinc-500">(inches)</span>
              </label>
              <input id={`${uid}-5`}
                type="number"
                step="0.001"
                min="0.1"
                value={height}
                onChange={(e) => setHeight(e.target.value)}
                className="field w-full"
              />
            </div>
          </div>

          {/* Thermal-specific fields */}
          {type === 'thermal' && (
            <>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label id={`${uid}-6-label`} className="field-label mb-1.5">
                  Dots per inch
                </label>
                <CustomSelect aria-labelledby={`${uid}-6-label`}
                  value={dpi.toString()}
                  onChange={(v) => setDpi(parseInt(v))}
                  options={COMMON_DPI_VALUES.map((d) => ({ value: d.toString(), label: String(d) }))}
                />
                <p className="mt-1 text-xs text-zinc-500">On the printer&rsquo;s sticker, usually 203.</p>
              </div>
              <div>
                <label htmlFor={`${uid}-7`} className="field-label mb-1.5">
                  Labels across
                </label>
                <input id={`${uid}-7`}
                  type="number"
                  min="1"
                  max="10"
                  value={labelsAcross}
                  onChange={(e) => setLabelsAcross(parseInt(e.target.value) || 1)}
                  className="field w-full"
                />
              </div>
            </div>

            {/* Thermal spacing */}
            {labelsAcross > 1 && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor={`${uid}-8`} className="field-label mb-1.5">
                    Gap between labels
                  </label>
                  <input id={`${uid}-8`}
                    type="number"
                    step="0.01"
                    value={horizontalGapThermal}
                    onChange={(e) => setHorizontalGapThermal(e.target.value)}
                    placeholder="0"
                    className="field w-full"
                  />
                </div>
                <div>
                  <label htmlFor={`${uid}-9`} className="field-label mb-1.5">
                    Side margin
                  </label>
                  <input id={`${uid}-9`}
                    type="number"
                    step="0.01"
                    value={sideMarginThermal}
                    onChange={(e) => setSideMarginThermal(e.target.value)}
                    placeholder="0"
                    className="field w-full"
                  />
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor={`${uid}-10`} className="field-label mb-1.5">
                  Label gap <span className="font-normal text-zinc-500">(inches)</span>
                </label>
                <input id={`${uid}-10`}
                  type="number"
                  step="0.01"
                  value={labelGap}
                  onChange={(e) => setLabelGap(e.target.value)}
                  placeholder="0.125"
                  className="field w-full"
                />
                <p className="mt-1 text-xs text-zinc-500">Space between labels on the roll.</p>
              </div>
              <div>
                <label htmlFor={`${uid}-11`} className="field-label mb-1.5">
                  Backing width <span className="font-normal text-zinc-500">(optional)</span>
                </label>
                <input id={`${uid}-11`}
                  type="number"
                  step="0.01"
                  value={linerWidth}
                  onChange={(e) => setLinerWidth(e.target.value)}
                  placeholder="Auto"
                  className="field w-full"
                />
                <p className="mt-1 text-xs text-zinc-500">Width of the paper the labels sit on. Auto suits most rolls.</p>
              </div>
            </div>
            </>
          )}

          {/* Sheet-specific fields */}
          {type === 'sheet' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor={`${uid}-12`} className="field-label mb-1.5">
                    Columns
                  </label>
                  <input id={`${uid}-12`}
                    type="number"
                    min="1"
                    value={columns}
                    onChange={(e) => setColumns(e.target.value)}
                    className="field w-full"
                  />
                </div>
                <div>
                  <label htmlFor={`${uid}-13`} className="field-label mb-1.5">
                    Rows
                  </label>
                  <input id={`${uid}-13`}
                    type="number"
                    min="1"
                    value={rows}
                    onChange={(e) => setRows(e.target.value)}
                    className="field w-full"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor={`${uid}-14`} className="field-label mb-1.5">
                    Top margin <span className="font-normal text-zinc-500">(in)</span>
                  </label>
                  <input id={`${uid}-14`}
                    type="number"
                    step="0.001"
                    min="0"
                    value={topMargin}
                    onChange={(e) => setTopMargin(e.target.value)}
                    className="field w-full"
                  />
                </div>
                <div>
                  <label htmlFor={`${uid}-15`} className="field-label mb-1.5">
                    Side margin <span className="font-normal text-zinc-500">(in)</span>
                  </label>
                  <input id={`${uid}-15`}
                    type="number"
                    step="0.001"
                    min="0"
                    value={sideMargin}
                    onChange={(e) => setSideMargin(e.target.value)}
                    className="field w-full"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor={`${uid}-16`} className="field-label mb-1.5">
                    Horizontal gap <span className="font-normal text-zinc-500">(in)</span>
                  </label>
                  <input id={`${uid}-16`}
                    type="number"
                    step="0.001"
                    min="0"
                    value={horizontalGap}
                    onChange={(e) => setHorizontalGap(e.target.value)}
                    className="field w-full"
                  />
                </div>
                <div>
                  <label htmlFor={`${uid}-17`} className="field-label mb-1.5">
                    Vertical gap <span className="font-normal text-zinc-500">(in)</span>
                  </label>
                  <input id={`${uid}-17`}
                    type="number"
                    step="0.001"
                    min="0"
                    value={verticalGap}
                    onChange={(e) => setVerticalGap(e.target.value)}
                    className="field w-full"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="btn btn-secondary"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
            >
              <PlusIcon className="w-4 h-4" />
              Add label size
            </button>
          </div>
        </form>
    </Dialog>
  );
}

// SVG-based sheet preview component
function SheetPreview({
  labelWidth,
  labelHeight,
  columns,
  rows,
  topMargin,
  sideMargin,
  horizontalGap,
  verticalGap,
}: {
  labelWidth: number;
  labelHeight: number;
  columns: number;
  rows: number;
  topMargin: number;
  sideMargin: number;
  horizontalGap: number;
  verticalGap: number;
}) {
  // Sheet dimensions in inches
  const sheetW = 8.5;
  const sheetH = 11;

  // SVG coordinate space = inches (we'll use viewBox to scale)
  // Add padding around the sheet
  const pad = 0.15;
  const viewW = sheetW + pad * 2;
  const viewH = sheetH + pad * 2;

  // Display size
  const maxSize = 300;
  const displayW = maxSize * (viewW / viewH);
  const displayH = maxSize;

  // Generate label rectangles in inch coordinates
  const labels = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      const x = pad + sideMargin + col * (labelWidth + horizontalGap);
      const y = pad + topMargin + row * (labelHeight + verticalGap);

      // Skip if out of sheet bounds
      if (x + labelWidth > pad + sheetW + 0.01 || y + labelHeight > pad + sheetH + 0.01) continue;

      labels.push(
        <rect
          key={`${row}-${col}`}
          x={x}
          y={y}
          width={labelWidth}
          height={labelHeight}
          fill="rgba(245, 158, 11, 0.08)"
          stroke="#d97706"
          strokeWidth={0.01}
          rx={0.02}
        />
      );
    }
  }

  const totalLabels = columns * rows;

  return (
    <div className="flex flex-col items-center">
      <svg
        width={displayW}
        height={displayH}
        viewBox={`0 0 ${viewW} ${viewH}`}
        className="rounded-lg"
      >
        {/* Dark background behind sheet */}
        <rect width={viewW} height={viewH} fill="#0a0a0c" rx={0.08} />

        {/* Sheet (white page) */}
        <rect
          x={pad}
          y={pad}
          width={sheetW}
          height={sheetH}
          fill="#1a1a1f"
          stroke="#3f3f46"
          strokeWidth={0.02}
          rx={0.04}
        />

        {/* Labels */}
        {labels}
      </svg>
      <div className="mt-3 space-y-1 text-center">
        <div className="text-sm text-zinc-400">
          {columns} × {rows} = <span className="text-zinc-100 font-medium">{totalLabels}</span> labels per sheet
        </div>
        <div className="text-xs text-zinc-500">
          {labelWidth}&quot; × {labelHeight}&quot; labels · {topMargin.toFixed(2)}&quot; top, {sideMargin.toFixed(2)}&quot; side
          {(horizontalGap > 0 || verticalGap > 0) && ` · ${horizontalGap.toFixed(2)}" h-gap, ${verticalGap.toFixed(2)}" v-gap`}
        </div>
      </div>
    </div>
  );
}
