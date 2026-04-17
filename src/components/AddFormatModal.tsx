'use client';

import { useState, useCallback, useMemo } from 'react';
import { LabelFormat, LabelType, COMMON_THERMAL_SIZES, COMMON_DPI_VALUES } from '@/lib/types';
import { useFormatStore } from '@/lib/store';
import { parsePDFFile, generateFormatName } from '@/lib/pdfParser';
import { PlusIcon, FileIcon } from '@/app/icons';

interface AddFormatModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AddFormatModal({ isOpen, onClose }: AddFormatModalProps) {
  const addFormat = useFormatStore((s) => s.addFormat);

  const [type, setType] = useState<LabelType>('thermal');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const [width, setWidth] = useState('2');
  const [height, setHeight] = useState('1');
  const [dpi, setDpi] = useState(203);
  const [labelsAcross, setLabelsAcross] = useState(1);

  const [columns, setColumns] = useState('3');
  const [rows, setRows] = useState('10');
  const [topMargin, setTopMargin] = useState('0.5');
  const [sideMargin, setSideMargin] = useState('0.1875');
  const [horizontalGap, setHorizontalGap] = useState('0.125');
  const [verticalGap, setVerticalGap] = useState('0');

  const [isParsing, setIsParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [pdfUploaded, setPdfUploaded] = useState(false);

  // Calculate derived values
  const derivedValues = useMemo(() => {
    const w = parseFloat(width) || 0;
    const h = parseFloat(height) || 0;
    const cols = parseInt(columns) || 1;
    const r = parseInt(rows) || 1;
    const sheetW = 8.5;
    const sheetH = 11;
    const tM = parseFloat(topMargin) || 0;
    const sM = parseFloat(sideMargin) || 0;
    const hGap = parseFloat(horizontalGap) || 0;
    const vGap = parseFloat(verticalGap) || 0;

    return {
      labelsPerSheet: type === 'sheet' ? cols * r : 1,
      pageWidth: sheetW,
      pageHeight: sheetH,
      topMargin: tM,
      sideMargin: sM,
      horizontalGap: hGap,
      verticalGap: vGap,
    };
  }, [width, height, columns, rows, topMargin, sideMargin, horizontalGap, verticalGap, type]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const baseFormat = {
      name: name || (type === 'thermal' ? 'Custom Thermal' : 'Custom Sheet'),
      description: description || undefined,
      type,
      width: parseFloat(width) || 2,
      height: parseFloat(height) || 1,
    };

    if (type === 'thermal') {
      addFormat({
        ...baseFormat,
        dpi,
        labelsAcross,
      });
    } else {
      const cols = parseInt(columns) || 1;
      const rowCount = parseInt(rows) || 1;

      addFormat({
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
      }
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Failed to parse PDF');
    } finally {
      setIsParsing(false);
    }
  }, []);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-[#151518] rounded-2xl border border-zinc-800 shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-zinc-800 sticky top-0 bg-[#151518] z-10">
          <h2 className="text-lg font-bold text-white">New Label Format</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Type Toggle */}
          <div className="flex rounded-xl bg-zinc-900/50 p-1 border border-zinc-800">
            <button
              type="button"
              onClick={() => setType('thermal')}
              className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-semibold transition-all ${
                type === 'thermal'
                  ? 'bg-gradient-to-r from-orange-500 to-orange-600 text-white shadow-lg shadow-orange-500/20'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Thermal Roll
            </button>
            <button
              type="button"
              onClick={() => setType('sheet')}
              className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-semibold transition-all ${
                type === 'sheet'
                  ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-lg shadow-blue-500/20'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Sheet Labels
            </button>
          </div>

          {/* PDF Upload - Sheet labels only */}
          {type === 'sheet' && (
            <div>
              <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-3">
                Import from PDF Template
              </label>
              <div className="relative">
                <input
                  type="file"
                  accept=".pdf"
                  onChange={handlePDFUpload}
                  disabled={isParsing}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
                />
                <div className={`
                  flex items-center justify-center gap-3 px-4 py-3 rounded-xl border-2 border-dashed transition-all
                  ${isParsing 
                    ? 'border-amber-500/50 bg-amber-500/5' 
                    : 'border-zinc-700 hover:border-zinc-600 bg-zinc-900/30'
                  }
                `}>
                  {isParsing ? (
                    <>
                      <div className="w-5 h-5 rounded-full border-2 border-amber-500 border-t-transparent animate-spin" />
                      <span className="text-sm text-amber-400">Analyzing PDF...</span>
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
            <div className="p-4 bg-zinc-900/30 rounded-xl border border-zinc-800">
              <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-3">
                Layout Preview
              </label>
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
              <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">
                Format Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={type === 'thermal' ? 'e.g., 2" × 1" Thermal' : 'e.g., Avery 5160'}
                className="w-full px-4 py-3 bg-zinc-900/50 border border-zinc-800 rounded-xl text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-amber-500/50 focus:bg-zinc-900 transition-all"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">
                Description <span className="text-zinc-600 normal-case">(optional)</span>
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g., Standard shipping label"
                className="w-full px-4 py-3 bg-zinc-900/50 border border-zinc-800 rounded-xl text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-amber-500/50 focus:bg-zinc-900 transition-all"
              />
            </div>
          </div>

          {/* Thermal Presets */}
          {type === 'thermal' && (
            <div>
              <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-3">
                Quick Select
              </label>
              <div className="flex flex-wrap gap-2">
                {COMMON_THERMAL_SIZES.map((preset) => (
                  <button
                    key={preset.name}
                    type="button"
                    onClick={() => applyPreset(preset)}
                    className="px-3 py-1.5 text-sm bg-zinc-900/50 border border-zinc-800 rounded-lg text-zinc-300 hover:border-orange-500/50 hover:text-orange-400 transition-all"
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
              <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">
                Width <span className="text-zinc-600">(inches)</span>
              </label>
              <input
                type="number"
                step="0.01"
                min="0.1"
                value={width}
                onChange={(e) => setWidth(e.target.value)}
                className="w-full px-4 py-3 bg-zinc-900/50 border border-zinc-800 rounded-xl text-zinc-100 focus:outline-none focus:border-amber-500/50 focus:bg-zinc-900 transition-all"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">
                Height <span className="text-zinc-600">(inches)</span>
              </label>
              <input
                type="number"
                step="0.01"
                min="0.1"
                value={height}
                onChange={(e) => setHeight(e.target.value)}
                className="w-full px-4 py-3 bg-zinc-900/50 border border-zinc-800 rounded-xl text-zinc-100 focus:outline-none focus:border-amber-500/50 focus:bg-zinc-900 transition-all"
              />
            </div>
          </div>

          {/* Thermal-specific fields */}
          {type === 'thermal' && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">
                  DPI
                </label>
                <select
                  value={dpi}
                  onChange={(e) => setDpi(parseInt(e.target.value))}
                  className="w-full px-4 py-3 bg-zinc-900/50 border border-zinc-800 rounded-xl text-zinc-100 focus:outline-none focus:border-amber-500/50 focus:bg-zinc-900 transition-all appearance-none cursor-pointer"
                >
                  {COMMON_DPI_VALUES.map((d) => (
                    <option key={d} value={d}>{d} DPI</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">
                  Labels Across
                </label>
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={labelsAcross}
                  onChange={(e) => setLabelsAcross(parseInt(e.target.value) || 1)}
                  className="w-full px-4 py-3 bg-zinc-900/50 border border-zinc-800 rounded-xl text-zinc-100 focus:outline-none focus:border-amber-500/50 focus:bg-zinc-900 transition-all"
                />
              </div>
            </div>
          )}

          {/* Sheet-specific fields */}
          {type === 'sheet' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">
                    Columns
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={columns}
                    onChange={(e) => setColumns(e.target.value)}
                    className="w-full px-4 py-3 bg-zinc-900/50 border border-zinc-800 rounded-xl text-zinc-100 focus:outline-none focus:border-amber-500/50 focus:bg-zinc-900 transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">
                    Rows
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={rows}
                    onChange={(e) => setRows(e.target.value)}
                    className="w-full px-4 py-3 bg-zinc-900/50 border border-zinc-800 rounded-xl text-zinc-100 focus:outline-none focus:border-amber-500/50 focus:bg-zinc-900 transition-all"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">
                    Top Margin <span className="text-zinc-600">(in)</span>
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={topMargin}
                    onChange={(e) => setTopMargin(e.target.value)}
                    className="w-full px-4 py-3 bg-zinc-900/50 border border-zinc-800 rounded-xl text-zinc-100 focus:outline-none focus:border-amber-500/50 focus:bg-zinc-900 transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">
                    Side Margin <span className="text-zinc-600">(in)</span>
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={sideMargin}
                    onChange={(e) => setSideMargin(e.target.value)}
                    className="w-full px-4 py-3 bg-zinc-900/50 border border-zinc-800 rounded-xl text-zinc-100 focus:outline-none focus:border-amber-500/50 focus:bg-zinc-900 transition-all"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">
                    Horizontal Gap <span className="text-zinc-600">(in)</span>
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={horizontalGap}
                    onChange={(e) => setHorizontalGap(e.target.value)}
                    className="w-full px-4 py-3 bg-zinc-900/50 border border-zinc-800 rounded-xl text-zinc-100 focus:outline-none focus:border-amber-500/50 focus:bg-zinc-900 transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">
                    Vertical Gap <span className="text-zinc-600">(in)</span>
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={verticalGap}
                    onChange={(e) => setVerticalGap(e.target.value)}
                    className="w-full px-4 py-3 bg-zinc-900/50 border border-zinc-800 rounded-xl text-zinc-100 focus:outline-none focus:border-amber-500/50 focus:bg-zinc-900 transition-all"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t border-zinc-800">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 text-sm font-medium text-zinc-400 hover:text-white transition-colors rounded-xl hover:bg-zinc-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-amber-500 to-amber-600 text-black text-sm font-semibold rounded-xl hover:from-amber-400 hover:to-amber-500 transition-all shadow-lg shadow-amber-500/20"
            >
              <PlusIcon className="w-4 h-4" />
              Create Format
            </button>
          </div>
        </form>
      </div>
    </div>
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
  // Calculate scaling to fit in preview area
  const sheetWidth = 8.5;
  const sheetHeight = 11;
  const maxPreviewSize = 280;

  const sheetAspect = sheetWidth / sheetHeight;
  const previewWidth = sheetAspect > 1 ? maxPreviewSize : maxPreviewSize * sheetAspect;
  const previewHeight = sheetAspect > 1 ? maxPreviewSize / sheetAspect : maxPreviewSize;

  const scaleX = previewWidth / sheetWidth;
  const scaleY = previewHeight / sheetHeight;
  const scale = Math.min(scaleX, scaleY);

  const labelW = labelWidth * scale;
  const labelH = labelHeight * scale;
  const startX = sideMargin * scale;
  const startY = topMargin * scale;
  const gapX = horizontalGap * scale;
  const gapY = verticalGap * scale;

  // Generate label rectangles
  const labels = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      const x = startX + col * (labelW + gapX);
      const y = startY + row * (labelH + gapY);
      
      // Skip if label would extend beyond preview
      if (x + labelW > previewWidth || y + labelH > previewHeight) continue;
      
      labels.push(
        <rect
          key={`${row}-${col}`}
          x={x}
          y={y}
          width={labelW}
          height={labelH}
          fill="none"
          stroke="url(#previewGradient)"
          strokeWidth="0.5"
          rx="1"
        />
      );
    }
  }

  const totalLabels = columns * rows;

  return (
    <div className="flex flex-col items-center">
      <svg
        width={previewWidth}
        height={previewHeight}
        viewBox={`0 0 ${previewWidth} ${previewHeight}`}
        className="rounded-lg bg-zinc-950"
      >
        <defs>
          <linearGradient id="previewGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#f59e0b" />
            <stop offset="100%" stopColor="#d97706" />
          </linearGradient>
        </defs>
        {/* Sheet background */}
        <rect
          width={previewWidth}
          height={previewHeight}
          fill="#0f0f12"
          rx="4"
          stroke="#27272a"
          strokeWidth="1"
        />
        {/* Margin guides */}
        <rect
          x={startX}
          y={startY}
          width={previewWidth - startX * 2}
          height={previewHeight - startY * 2}
          fill="none"
          stroke="#27272a"
          strokeWidth="0.5"
          strokeDasharray="4 2"
          rx="2"
        />
        {/* Labels */}
        {labels}
      </svg>
      <div className="mt-3 space-y-1 text-center">
        <div className="text-sm text-zinc-400">
          {columns} × {rows} = <span className="text-zinc-200 font-medium">{totalLabels}</span> labels per sheet
        </div>
        <div className="text-xs text-zinc-600">
          Margins: {topMargin.toFixed(2)}" top, {sideMargin.toFixed(2)}" side · Gaps: {horizontalGap.toFixed(2)}" h, {verticalGap.toFixed(2)}" v
        </div>
      </div>
    </div>
  );
}