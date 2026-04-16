'use client';

import { useState, useCallback } from 'react';
import { useFormatStore } from '@/lib/store';
import { parsePDFFile, generateFormatName, PDFParseResult } from '@/lib/pdfParser';
import { UploadIcon, FileIcon, XIcon } from '@/app/icons';

interface PDFImportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function PDFImportModal({ isOpen, onClose }: PDFImportModalProps) {
  const addFormat = useFormatStore((s) => s.addFormat);

  const [isDragging, setIsDragging] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [parseResult, setParseResult] = useState<PDFParseResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files).filter((f) => f.type === 'application/pdf');
    if (files.length > 0) {
      await processFile(files[0]);
    }
  }, []);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      await processFile(file);
    }
  }, []);

  const processFile = async (file: File) => {
    setIsParsing(true);
    setError(null);
    setParseResult(null);

    try {
      const result = await parsePDFFile(file);
      setParseResult(result);

      if (result.success && result.spec) {
        setName(generateFormatName(result.spec));
        setDescription(`Imported from ${file.name}`);
      } else if (result.error) {
        setError(result.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse PDF');
    } finally {
      setIsParsing(false);
    }
  };

  const handleSave = () => {
    if (!parseResult?.success || !parseResult.spec) return;

    const spec = parseResult.spec;

    if (spec.type === 'thermal') {
      addFormat({
        name: name || 'Imported Thermal Format',
        description: description || undefined,
        type: 'thermal',
        width: spec.width,
        height: spec.height,
        dpi: 203,
        labelsAcross: 1,
      });
    } else {
      addFormat({
        name: name || 'Imported Sheet Format',
        description: description || undefined,
        type: 'sheet',
        width: spec.width,
        height: spec.height,
        sheetWidth: spec.sheetWidth || 8.5,
        sheetHeight: spec.sheetHeight || 11,
        columns: spec.columns || 1,
        rows: spec.rows || 1,
        topMargin: spec.topMargin || 0,
        sideMargin: spec.sideMargin || 0,
        horizontalGap: spec.horizontalGap || 0,
        verticalGap: spec.verticalGap || 0,
      });
    }

    onClose();
    resetForm();
  };

  const resetForm = () => {
    setParseResult(null);
    setName('');
    setDescription('');
    setError(null);
  };

  const handleClose = () => {
    onClose();
    resetForm();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-xl bg-[#151518] rounded-2xl border border-zinc-800 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-zinc-800">
          <h2 className="text-lg font-bold text-white">Import from PDF</h2>
          <button
            onClick={handleClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
          >
            <XIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6">
          {!parseResult ? (
            // Upload area
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`
                relative border-2 border-dashed rounded-2xl p-12 text-center transition-all
                ${isDragging
                  ? 'border-indigo-500 bg-indigo-500/10'
                  : 'border-zinc-700 hover:border-zinc-600'
                }
              `}
            >
              <input
                type="file"
                accept=".pdf"
                onChange={handleFileSelect}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />

              <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-zinc-800 flex items-center justify-center">
                <UploadIcon className="w-8 h-8 text-zinc-400" />
              </div>

              <h3 className="text-lg font-semibold text-zinc-200 mb-2">
                Drop your label sheet PDF
              </h3>
              <p className="text-sm text-zinc-500 mb-4">
                or click to browse
              </p>
              <p className="text-xs text-zinc-600">
                Supports PDF templates with visible label outlines
              </p>
            </div>
          ) : isParsing ? (
            // Loading state
            <div className="py-12 text-center">
              <div className="w-12 h-12 mx-auto mb-4 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
              <p className="text-zinc-400">Analyzing PDF...</p>
            </div>
          ) : error ? (
            // Error state
            <div className="py-8 text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-red-500/10 flex items-center justify-center">
                <XIcon className="w-8 h-8 text-red-400" />
              </div>
              <h3 className="text-lg font-semibold text-red-400 mb-2">Failed to parse PDF</h3>
              <p className="text-sm text-zinc-500 mb-6">{error}</p>
              <button
                onClick={resetForm}
                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg transition-colors"
              >
                Try Again
              </button>
            </div>
          ) : parseResult.success && parseResult.spec ? (
            // Results state
            <div className="space-y-6">
              <div className="flex items-center gap-3 p-4 bg-zinc-900/50 rounded-xl border border-zinc-800">
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center">
                  <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                </div>
                <div>
                  <h3 className="font-semibold text-white">Format Detected</h3>
                  <p className="text-sm text-zinc-500">
                    Confidence: <span className={`
                      ${parseResult.spec.confidence === 'high' ? 'text-green-400' : ''}
                      ${parseResult.spec.confidence === 'medium' ? 'text-yellow-400' : ''}
                      ${parseResult.spec.confidence === 'low' ? 'text-orange-400' : ''}
                    `}>{parseResult.spec.confidence}</span>
                  </p>
                </div>
              </div>

              {/* Detected specs */}
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-zinc-900/30 rounded-xl border border-zinc-800">
                  <div className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Type</div>
                  <div className="font-medium text-zinc-200 capitalize">{parseResult.spec.type}</div>
                </div>
                <div className="p-4 bg-zinc-900/30 rounded-xl border border-zinc-800">
                  <div className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Label Size</div>
                  <div className="font-medium text-zinc-200">
                    {parseResult.spec.width.toFixed(3)}" × {parseResult.spec.height.toFixed(3)}"
                  </div>
                </div>

                {parseResult.spec.type === 'sheet' && (
                  <>
                    <div className="p-4 bg-zinc-900/30 rounded-xl border border-zinc-800">
                      <div className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Grid</div>
                      <div className="font-medium text-zinc-200">
                        {parseResult.spec.columns} × {parseResult.spec.rows}
                      </div>
                    </div>
                    <div className="p-4 bg-zinc-900/30 rounded-xl border border-zinc-800">
                      <div className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Per Sheet</div>
                      <div className="font-medium text-zinc-200">
                        {(parseResult.spec.columns || 1) * (parseResult.spec.rows || 1)} labels
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* Editable fields */}
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">
                    Format Name
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full px-4 py-3 bg-zinc-900/50 border border-zinc-800 rounded-xl text-zinc-100 focus:outline-none focus:border-indigo-500/50 focus:bg-zinc-900 transition-all"
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
                    placeholder="e.g., Imported from PDF template"
                    className="w-full px-4 py-3 bg-zinc-900/50 border border-zinc-800 rounded-xl text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-indigo-500/50 focus:bg-zinc-900 transition-all"
                  />
                </div>
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-3 pt-4 border-t border-zinc-800">
                <button
                  onClick={resetForm}
                  className="px-5 py-2.5 text-sm font-medium text-zinc-400 hover:text-white transition-colors rounded-xl hover:bg-zinc-800"
                >
                  Back
                </button>
                <button
                  onClick={handleSave}
                  className="px-5 py-2.5 bg-white text-black text-sm font-semibold rounded-xl hover:bg-zinc-200 transition-colors shadow-lg shadow-white/10"
                >
                  Save Format
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
