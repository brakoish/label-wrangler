'use client';

import { useState, useEffect, useMemo, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Upload, Clipboard, Save, Play, AlertCircle, FileSpreadsheet } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { CustomSelect } from '@/components/ui/CustomSelect';
import { useFormatStore } from '@/lib/store';
import { useTemplateStore } from '@/lib/templateStore';
import { useRunStore } from '@/lib/runStore';
import { parseCsv, detectUrlColumn, extractColumn } from '@/lib/csv';
import { dynamicFieldsForTemplate, staticFieldsForRun } from '@/lib/runBuilder';
import { generateZPL } from '@/lib/zplGenerator';
import { RunPrinter } from '@/components/runs/RunPrinter';

function NewRunContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const presetId = searchParams.get('presetId');

  const { templates } = useTemplateStore();
  const { formats, getFormatById } = useFormatStore();
  const { presets, createRun, createPreset, updatePreset } = useRunStore();

  // Form state
  const [name, setName] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [staticValues, setStaticValues] = useState<Record<string, string>>({});
  const [mappedField, setMappedField] = useState<string | null>(null);
  const [inputMode, setInputMode] = useState<'paste' | 'csv'>('paste');
  const [pasteText, setPasteText] = useState('');
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<Record<string, string>[]>([]);
  const [csvColumn, setCsvColumn] = useState<string | null>(null);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [saveAsPresetName, setSaveAsPresetName] = useState('');
  const [createdRunId, setCreatedRunId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Apply preset on mount (or when presetId changes).
  useEffect(() => {
    if (!presetId) return;
    const p = presets.find((x) => x.id === presetId);
    if (!p) return;
    setName(`${p.name} \u2014 ${new Date().toLocaleDateString()}`);
    setTemplateId(p.templateId);
    setStaticValues(p.staticDefaults);
    setMappedField(p.mappedField);
    if (p.csvColumn) setCsvColumn(p.csvColumn);
  }, [presetId, presets]);

  // Selected template + format.
  const template = useMemo(() => templates.find((t) => t.id === templateId) ?? null, [templates, templateId]);
  const format = template ? getFormatById(template.formatId) : null;

  // Dynamic fields the template exposes.
  const dynamicFields = useMemo(() => (template ? dynamicFieldsForTemplate(template) : []), [template]);
  const staticFieldNames = useMemo(
    () => (template ? staticFieldsForRun(template, mappedField) : []),
    [template, mappedField],
  );

  // When a template is picked, auto-guess the variable field: prefer a 'qr'
  // element's field name, else the first dynamic field.
  useEffect(() => {
    if (!template) return;
    if (mappedField && dynamicFields.includes(mappedField)) return;
    const qrEl = template.elements.find((e) => e.type === 'qr' && !e.isStatic && e.fieldName);
    const first = qrEl?.fieldName ?? dynamicFields[0] ?? null;
    setMappedField(first);
  }, [template, dynamicFields, mappedField]);

  // Variable values list (the data source for each label).
  const variableValues = useMemo<string[]>(() => {
    if (inputMode === 'paste') {
      return pasteText
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
    }
    if (csvColumn && csvRows.length > 0) {
      return extractColumn({ headers: csvHeaders, rows: csvRows }, csvColumn);
    }
    return [];
  }, [inputMode, pasteText, csvColumn, csvRows, csvHeaders]);

  const handleFile = async (file: File) => {
    const text = await file.text();
    const parsed = parseCsv(text);
    setCsvHeaders(parsed.headers);
    setCsvRows(parsed.rows);
    // Auto-detect URL-ish column. If not found, fall back to first header.
    const auto = detectUrlColumn(parsed);
    setCsvColumn(auto ?? parsed.headers[0] ?? null);
    // Auto-fill static fields from row 1 if they match dynamic-field names.
    if (template && parsed.rows.length > 0) {
      const next: Record<string, string> = { ...staticValues };
      for (const f of staticFieldNames) {
        const match = parsed.headers.find((h) => h.toLowerCase().replace(/\s+/g, '') === f.toLowerCase().replace(/\s+/g, ''));
        if (match) next[f] = parsed.rows[0][match] ?? '';
      }
      setStaticValues(next);
    }
  };

  // Preview ZPL for the current row.
  const previewZpl = useMemo(() => {
    if (!template || !format) return '';
    const values: Record<string, string> = { ...staticValues };
    if (mappedField && variableValues[previewIndex]) {
      values[mappedField] = variableValues[previewIndex];
    }
    return generateZPL(template, format, values);
  }, [template, format, staticValues, mappedField, variableValues, previewIndex]);

  const canCreate =
    name.trim().length > 0 &&
    !!template &&
    !!format &&
    variableValues.length > 0;

  const handleCreateRun = async (autoStart = false) => {
    if (!canCreate || !template) return null;
    const run = await createRun({
      name: name.trim(),
      templateId: template.id,
      presetId: presetId ?? null,
      staticValues,
      dataSource: inputMode,
      sourceData: variableValues,
      mappedField,
      status: autoStart ? 'queued' : 'draft',
    });
    if (presetId) {
      // Bump preset usage stats.
      void updatePreset(presetId, { touch: true });
    }
    return run;
  };

  const handleSaveAndPrint = async () => {
    const run = await handleCreateRun(true);
    if (run) setCreatedRunId(run.id);
  };

  const handleSaveAsPreset = async () => {
    if (!template || !saveAsPresetName.trim()) return;
    const preset = await createPreset({
      name: saveAsPresetName.trim(),
      templateId: template.id,
      staticDefaults: staticValues,
      mappedField,
      csvColumn,
    });
    setSaveAsPresetName('');
    alert(`Preset "${preset.name}" saved.`);
  };

  // If we already created + queued the run, switch into the printer view.
  if (createdRunId) {
    return (
      <AppShell>
        <RunPrinter runId={createdRunId} onDone={() => router.push(`/runs/${createdRunId}`)} />
      </AppShell>
    );
  }

  return (
    <AppShell
      headerAction={
        <Link href="/runs" className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-400 hover:text-zinc-200 transition-colors">
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Runs
        </Link>
      }
    >
      <div className="flex-1 overflow-auto">
        <div className="max-w-[1100px] mx-auto w-full p-8 space-y-6">
          <h1 className="text-2xl font-bold text-zinc-100">New Print Run</h1>

          {/* Step 1: name + template */}
          <section className="glass rounded-2xl p-5 border border-zinc-800 space-y-4">
            <h2 className="text-xs text-zinc-500 uppercase tracking-wider font-semibold">Setup</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-zinc-400 block mb-1.5">Run Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Jack Herer 3.5g \u2014 Apr 21 batch"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg text-sm text-zinc-100 px-3 py-2 focus:outline-none focus:border-amber-500/40"
                />
              </div>
              <div>
                <label className="text-xs text-zinc-400 block mb-1.5">Template</label>
                {templates.length === 0 ? (
                  <p className="text-xs text-zinc-500 py-2">
                    No templates yet. <Link href="/designer" className="text-amber-400 hover:underline">Create one</Link>.
                  </p>
                ) : (
                  <CustomSelect
                    value={templateId}
                    onChange={setTemplateId}
                    placeholder="Select template..."
                    options={templates.map((t) => {
                      const f = formats.find((x) => x.id === t.formatId);
                      return {
                        value: t.id,
                        label: t.name,
                        sublabel: f ? `${f.name} \u2014 ${f.width}" \u00d7 ${f.height}"` : '',
                      };
                    })}
                  />
                )}
              </div>
            </div>
          </section>

          {template && (
            <>
              {/* Step 2: variable data */}
              <section className="glass rounded-2xl p-5 border border-zinc-800 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-xs text-zinc-500 uppercase tracking-wider font-semibold">Variable Data</h2>
                  <div className="flex items-center gap-0.5 p-0.5 rounded-md bg-zinc-900 border border-zinc-800">
                    <button
                      onClick={() => setInputMode('paste')}
                      className={`flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${inputMode === 'paste' ? 'bg-amber-500/20 text-amber-400' : 'text-zinc-500 hover:text-zinc-300'}`}
                    >
                      <Clipboard className="w-3 h-3" /> Paste
                    </button>
                    <button
                      onClick={() => setInputMode('csv')}
                      className={`flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${inputMode === 'csv' ? 'bg-amber-500/20 text-amber-400' : 'text-zinc-500 hover:text-zinc-300'}`}
                    >
                      <FileSpreadsheet className="w-3 h-3" /> CSV
                    </button>
                  </div>
                </div>

                {dynamicFields.length > 1 && (
                  <div>
                    <label className="text-xs text-zinc-400 block mb-1.5">Which field varies per label?</label>
                    <CustomSelect
                      value={mappedField ?? ''}
                      onChange={(v) => setMappedField(v || null)}
                      options={dynamicFields.map((f) => ({ value: f, label: f }))}
                    />
                  </div>
                )}

                {inputMode === 'paste' ? (
                  <div>
                    <label className="text-xs text-zinc-400 block mb-1.5">One value per line (e.g. METRC URLs)</label>
                    <textarea
                      value={pasteText}
                      onChange={(e) => setPasteText(e.target.value)}
                      rows={8}
                      placeholder={'HTTPS://1A4.COM/5LO1I9DSOPW43WR19JI8\nHTTPS://1A4.COM/5LO1I9DSOPW43WR19JI9\n...'}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-100 font-mono px-3 py-2 focus:outline-none focus:border-amber-500/40 resize-y"
                    />
                  </div>
                ) : (
                  <div className="space-y-3">
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-amber-500/30 text-sm text-zinc-300 transition-colors"
                    >
                      <Upload className="w-4 h-4" /> {csvHeaders.length > 0 ? 'Replace CSV' : 'Upload CSV'}
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".csv,text/csv"
                      hidden
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void handleFile(file);
                      }}
                    />
                    {csvHeaders.length > 0 && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs text-zinc-400 block mb-1.5">Variable column</label>
                          <CustomSelect
                            value={csvColumn ?? ''}
                            onChange={setCsvColumn}
                            options={csvHeaders.map((h) => ({ value: h, label: h }))}
                          />
                        </div>
                        <div className="flex items-end text-xs text-zinc-500">
                          {csvRows.length} rows found
                        </div>
                      </div>
                    )}
                  </div>
                )}
                <p className="text-xs text-zinc-500">
                  {variableValues.length > 0
                    ? <><span className="text-amber-400 font-semibold">{variableValues.length}</span> label{variableValues.length === 1 ? '' : 's'} queued</>
                    : 'Add some values to queue labels.'}
                </p>
              </section>

              {/* Step 3: static fields */}
              {staticFieldNames.length > 0 && (
                <section className="glass rounded-2xl p-5 border border-zinc-800 space-y-4">
                  <h2 className="text-xs text-zinc-500 uppercase tracking-wider font-semibold">Static Fields (same on every label)</h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {staticFieldNames.map((f) => (
                      <div key={f}>
                        <label className="text-xs text-zinc-400 block mb-1.5">{f}</label>
                        <input
                          type="text"
                          value={staticValues[f] ?? ''}
                          onChange={(e) => setStaticValues((s) => ({ ...s, [f]: e.target.value }))}
                          className="w-full bg-zinc-950 border border-zinc-800 rounded-lg text-sm text-zinc-100 px-3 py-2 focus:outline-none focus:border-amber-500/40"
                        />
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Step 4: preview */}
              {variableValues.length > 0 && format && (
                <section className="glass rounded-2xl p-5 border border-zinc-800 space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-xs text-zinc-500 uppercase tracking-wider font-semibold">Preview</h2>
                    <div className="flex items-center gap-2 text-xs">
                      <button
                        onClick={() => setPreviewIndex((i) => Math.max(0, i - 1))}
                        disabled={previewIndex === 0}
                        className="px-2 py-1 rounded-md bg-zinc-900 text-zinc-400 hover:text-zinc-200 disabled:opacity-30"
                      >
                        Prev
                      </button>
                      <span className="text-zinc-400 tabular-nums">
                        Label {previewIndex + 1} / {variableValues.length}
                      </span>
                      <button
                        onClick={() => setPreviewIndex((i) => Math.min(variableValues.length - 1, i + 1))}
                        disabled={previewIndex >= variableValues.length - 1}
                        className="px-2 py-1 rounded-md bg-zinc-900 text-zinc-400 hover:text-zinc-200 disabled:opacity-30"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                  <div className="rounded-xl bg-zinc-950/60 p-4">
                    <LocalZplPreview zpl={previewZpl} format={format} />
                  </div>
                </section>
              )}

              {/* Step 5: save preset + print */}
              <section className="glass rounded-2xl p-5 border border-zinc-800 space-y-3">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={saveAsPresetName}
                    onChange={(e) => setSaveAsPresetName(e.target.value)}
                    placeholder="Save as preset..."
                    className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg text-sm text-zinc-100 px-3 py-2 focus:outline-none focus:border-amber-500/40"
                  />
                  <button
                    onClick={handleSaveAsPreset}
                    disabled={!saveAsPresetName.trim() || !template}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-zinc-800 text-zinc-200 hover:bg-zinc-700 transition-colors disabled:opacity-40"
                  >
                    <Save className="w-3.5 h-3.5" /> Save
                  </button>
                </div>
                {!canCreate && (
                  <p className="text-xs text-amber-500 flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5" />
                    Need a run name, template, and at least one variable value to proceed.
                  </p>
                )}
                <button
                  onClick={handleSaveAndPrint}
                  disabled={!canCreate}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-sm font-semibold bg-gradient-to-r from-amber-500 to-amber-600 text-black hover:from-amber-400 hover:to-amber-500 transition-all shadow-lg shadow-amber-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Play className="w-4 h-4" /> Start Run ({variableValues.length} labels)
                </button>
              </section>
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}

// Tiny inline ZPL preview image used in the wizard. Renders via zpl-renderer-js WASM.
function LocalZplPreview({ zpl, format }: { zpl: string; format: { width: number; height: number; dpi?: number; type: string } }) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setErr(null);
    (async () => {
      try {
        const mod = await import('zpl-renderer-js');
        const { api } = await mod.ready;
        const widthMm = format.width * 25.4;
        const heightMm = format.height * 25.4;
        const dpmm = Math.round((format.dpi || 203) / 25.4);
        const b64 = await api.zplToBase64Async(zpl, widthMm, heightMm, dpmm);
        if (!cancelled) setUrl(`data:image/png;base64,${b64}`);
      } catch (e) {
        if (!cancelled) setErr((e as Error)?.message || 'Render failed');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [zpl, format.width, format.height, format.dpi]);

  if (err) return <p className="text-xs text-red-400">{err}</p>;
  if (!url) return <p className="text-xs text-zinc-500">Rendering\u2026</p>;
  return (
    <img
      src={url}
      alt="Label preview"
      className="rounded-lg border border-zinc-800 bg-white mx-auto"
      style={{ imageRendering: 'pixelated', maxWidth: '100%', maxHeight: '400px' }}
    />
  );
}

export default function NewRunPage() {
  return (
    <Suspense fallback={null}>
      <NewRunContent />
    </Suspense>
  );
}
