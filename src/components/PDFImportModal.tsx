'use client';

import { useState, useCallback } from 'react';
import { useFormatStore } from '@/lib/store';
import { parsePDFFile, generateFormatName, PDFParseResult } from '@/lib/pdfParser';
import { UploadIcon, XIcon } from '@/app/icons';

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
      setError(err instanceof Error ? err.message : 'We couldn’t read that PDF');
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
      <div className="w-full max-w-xl bg-zinc-900 rounded-xl border border-zinc-800 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-zinc-800">
          <h2 className="text-lg font-semibold text-zinc-50">Import from PDF</h2>
          <button
            onClick={handleClose}
            className="btn btn-ghost btn-icon" aria-label="Close"
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
                relative border border-dashed rounded-lg p-10 text-center transition-colors
                ${isDragging
                  ? 'border-amber-500 bg-amber-500/10'
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

              <UploadIcon className="w-8 h-8 mx-auto mb-3 text-zinc-400" />

              <h3 className="text-lg font-semibold text-zinc-200 mb-2">
                Drop your label sheet PDF
              </h3>
              <p className="text-sm text-zinc-500 mb-4">
                or click to browse
              </p>
              <p className="text-xs text-zinc-500">
                Supports PDF templates with visible label outlines
              </p>
            </div>
          ) : isParsing ? (
            // Loading state
            <div className="py-12 text-center">
              <div className="size-8 mx-auto mb-4 rounded-full border-2 border-amber-500 border-t-transparent animate-spin" aria-hidden="true" />
              <p className="text-zinc-400">Reading the PDF…</p>
            </div>
          ) : error ? (
            // Error state
            <div className="py-8 text-center">
              <XIcon className="w-8 h-8 mx-auto mb-3 text-red-400" />
              <h3 className="text-lg font-semibold text-red-400 mb-2">Failed to parse PDF</h3>
              <p className="text-sm text-zinc-500 mb-6">{error}</p>
              <button
                onClick={resetForm}
                className="btn btn-secondary"
              >
                Try Again
              </button>
            </div>
          ) : parseResult.success && parseResult.spec ? (
            // Results state
            <div className="space-y-6">
              <div className="flex items-center gap-3">
                <div className="flex size-8 shrink-0 items-center justify-center text-emerald-400">
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                </div>
                <div>
                  <h3 className="font-semibold text-zinc-50">Format detected</h3>
                  <p className="text-sm text-zinc-500">
                    Confidence: <span className={`
                      ${parseResult.spec.confidence === 'high' ? 'text-emerald-400' : ''}
                      ${parseResult.spec.confidence === 'medium' ? 'text-amber-300' : ''}
                      ${parseResult.spec.confidence === 'low' ? 'text-amber-300' : ''}
                    `}>{parseResult.spec.confidence}</span>
                  </p>
                </div>
              </div>

              {/* Detected specs */}
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-lg bg-zinc-950 p-3">
                  <div className="text-xs text-zinc-400 mb-1">Type</div>
                  <div className="font-medium text-zinc-200 capitalize">{parseResult.spec.type}</div>
                </div>
                <div className="rounded-lg bg-zinc-950 p-3">
                  <div className="text-xs text-zinc-400 mb-1">Label size</div>
                  <div className="font-medium text-zinc-200">
                    {parseResult.spec.width.toFixed(3)}&quot; × {parseResult.spec.height.toFixed(3)}&quot;
                  </div>
                </div>

                {parseResult.spec.type === 'sheet' && (
                  <>
                    <div className="rounded-lg bg-zinc-950 p-3">
                      <div className="text-xs text-zinc-400 mb-1">Grid</div>
                      <div className="font-medium text-zinc-200">
                        {parseResult.spec.columns} × {parseResult.spec.rows}
                      </div>
                    </div>
                    <div className="rounded-lg bg-zinc-950 p-3">
                      <div className="text-xs text-zinc-400 mb-1">Per sheet</div>
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
                  <label className="field-label mb-1.5">
                    Format Name
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="field"
                  />
                </div>
                <div>
                  <label className="field-label mb-1.5">
                    Description <span className="font-normal text-zinc-500">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="e.g., Imported from PDF template"
                    className="field"
                  />
                </div>
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={resetForm}
                  className="btn btn-secondary"
                >
                  Back
                </button>
                <button
                  onClick={handleSave}
                  className="btn btn-primary"
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
