'use client';

import { useState } from 'react';
import { LabelFormat, LabelType, COMMON_THERMAL_SIZES, COMMON_DPI_VALUES } from '@/lib/types';
import { useFormatStore } from '@/lib/store';
import { PlusIcon } from './icons';

interface AddFormatModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AddFormatModal({ isOpen, onClose }: AddFormatModalProps) {
  const addFormat = useFormatStore((s) => s.addFormat);

  const [type, setType] = useState<LabelType>('thermal');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  // Thermal fields
  const [width, setWidth] = useState('2');
  const [height, setHeight] = useState('1');
  const [dpi, setDpi] = useState(203);
  const [labelsAcross, setLabelsAcross] = useState(1);

  // Sheet fields
  const [columns, setColumns] = useState('3');
  const [rows, setRows] = useState('10');
  const [topMargin, setTopMargin] = useState('0.5');
  const [sideMargin, setSideMargin] = useState('0.1875');
  const [horizontalGap, setHorizontalGap] = useState('0.125');
  const [verticalGap, setVerticalGap] = useState('0');

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
  };

  const applyPreset = (preset: (typeof COMMON_THERMAL_SIZES)[number]) => {
    setWidth(preset.width.toString());
    setHeight(preset.height.toString());
    setName(`${preset.name} Thermal`);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="w-full max-w-lg bg-zinc-900 rounded-xl border border-zinc-800 shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
          <h2 className="text-lg font-semibold text-zinc-100">Add Label Format</h2>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Type Toggle */}
          <div className="flex rounded-lg bg-zinc-950 p-1">
            <button
              type="button"
              onClick={() => setType('thermal')}
              className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
                type === 'thermal'
                  ? 'bg-zinc-800 text-orange-400'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Thermal Roll
            </button>
            <button
              type="button"
              onClick={() => setType('sheet')}
              className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
                type === 'sheet'
                  ? 'bg-zinc-800 text-blue-400'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Sheet Labels
            </button>
          </div>

          {/* Name & Description */}
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-zinc-400 mb-1.5">
                Format Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={type === 'thermal' ? 'e.g., 2" × 1" Thermal' : 'e.g., Avery 5160'}
                className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-indigo-500 transition-colors"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-400 mb-1.5">
                Description (optional)
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g., Standard shipping label"
                className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-indigo-500 transition-colors"
              />
            </div>
          </div>

          {/* Thermal Presets */}
          {type === 'thermal' && (
            <div>
              <label className="block text-sm font-medium text-zinc-400 mb-2">
                Quick Select
              </label>
              <div className="flex flex-wrap gap-2">
                {COMMON_THERMAL_SIZES.map((preset) => (
                  <button
                    key={preset.name}
                    type="button"
                    onClick={() => applyPreset(preset)}
                    className="px-3 py-1.5 text-sm bg-zinc-950 border border-zinc-800 rounded-md text-zinc-300 hover:border-orange-500/50 hover:text-orange-400 transition-colors"
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
              <label className="block text-sm font-medium text-zinc-400 mb-1.5">
                Width (inches)
              </label>
              <input
                type="number"
                step="0.01"
                min="0.1"
                value={width}
                onChange={(e) => setWidth(e.target.value)}
                className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100 focus:outline-none focus:border-indigo-500 transition-colors"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-400 mb-1.5">
                Height (inches)
              </label>
              <input
                type="number"
                step="0.01"
                min="0.1"
                value={height}
                onChange={(e) => setHeight(e.target.value)}
                className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100 focus:outline-none focus:border-indigo-500 transition-colors"
              />
            </div>
          </div>

          {/* Thermal-specific fields */}
          {type === 'thermal' && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-zinc-400 mb-1.5">
                  DPI
                </label>
                <select
                  value={dpi}
                  onChange={(e) => setDpi(parseInt(e.target.value))}
                  className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100 focus:outline-none focus:border-indigo-500 transition-colors"
                >
                  {COMMON_DPI_VALUES.map((d) => (
                    <option key={d} value={d}>{d} DPI</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-400 mb-1.5">
                  Labels Across
                </label>
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={labelsAcross}
                  onChange={(e) => setLabelsAcross(parseInt(e.target.value) || 1)}
                  className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100 focus:outline-none focus:border-indigo-500 transition-colors"
                />
              </div>
            </div>
          )}

          {/* Sheet-specific fields */}
          {type === 'sheet' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-1.5">
                    Columns
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={columns}
                    onChange={(e) => setColumns(e.target.value)}
                    className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100 focus:outline-none focus:border-indigo-500 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-1.5">
                    Rows
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={rows}
                    onChange={(e) => setRows(e.target.value)}
                    className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100 focus:outline-none focus:border-indigo-500 transition-colors"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-1.5">
                    Top Margin (in)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={topMargin}
                    onChange={(e) => setTopMargin(e.target.value)}
                    className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100 focus:outline-none focus:border-indigo-500 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-1.5">
                    Side Margin (in)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={sideMargin}
                    onChange={(e) => setSideMargin(e.target.value)}
                    className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100 focus:outline-none focus:border-indigo-500 transition-colors"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-1.5">
                    Horizontal Gap (in)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={horizontalGap}
                    onChange={(e) => setHorizontalGap(e.target.value)}
                    className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100 focus:outline-none focus:border-indigo-500 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-1.5">
                    Vertical Gap (in)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={verticalGap}
                    onChange={(e) => setVerticalGap(e.target.value)}
                    className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100 focus:outline-none focus:border-indigo-500 transition-colors"
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
              className="px-4 py-2 text-sm font-medium text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex items-center gap-2 px-4 py-2 bg-indigo-500 hover:bg-indigo-600 text-white text-sm font-medium rounded-lg transition-colors"
            >
              <PlusIcon className="w-4 h-4" />
              Add Format
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}