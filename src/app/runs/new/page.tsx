'use client';

import { useState, useEffect, useMemo, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Upload, Clipboard, Save, Play, AlertCircle, FileSpreadsheet, Download, Plus, Pencil } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { PageTitle } from '@/components/PageTitle';
import { CustomSelect } from '@/components/ui/CustomSelect';
import { useFormatStore } from '@/lib/store';
import { useTemplateStore } from '@/lib/templateStore';
import { NewTemplateDialog } from '@/components/designer/TemplateList';
import { useRunStore } from '@/lib/runStore';
import { parseCsv, detectUrlColumn } from '@/lib/csv';
import { dynamicFieldsForTemplate, staticFlippableElements } from '@/lib/runBuilder';
import { generateZPL } from '@/lib/zplGenerator';
import { RunPrinter } from '@/components/runs/RunPrinter';
import { LabelOutlineOverlay } from '@/components/LabelOutlineOverlay';
import { LayoutPreview } from '@/components/designer/LayoutPreview';
import type { FieldMapping, RunDataSource } from '@/lib/types';

function NewRunContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const presetId = searchParams.get('presetId');
  // Re-run action from the run detail page: `/runs/new?duplicateFrom=<runId>`.
  // Clones the source run's template, static values, mappings, and data so
  // the user just has to edit the name and hit Print. Static field values are
  // preserved too so same-batch re-prints are one click.
  const duplicateFrom = searchParams.get('duplicateFrom');

  const { templates, addTemplate, updateElementLocal, saveTemplate } = useTemplateStore();
  const { formats, getFormatById } = useFormatStore();
  const { runs, presets, createRun, createPreset, updatePreset } = useRunStore();

  // Form state
  const [name, setName] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [staticValues, setStaticValues] = useState<Record<string, string>>({});
  const [fieldMappings, setFieldMappings] = useState<Record<string, FieldMapping>>({});
  const [inputMode, setInputMode] = useState<'paste' | 'csv'>('csv');
  const [pasteText, setPasteText] = useState('');
  const [pasteField, setPasteField] = useState<string | null>(null);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<Record<string, string>[]>([]);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [saveAsPresetName, setSaveAsPresetName] = useState('');
  const [createdRunId, setCreatedRunId] = useState<string | null>(null);
  // Controls the 'create new template' dialog invoked from the template
  // picker. Kept local to this page so the modal render + submit logic
  // doesn't leak into the template store.
  const [showNewTemplateDialog, setShowNewTemplateDialog] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Apply preset on mount.
  useEffect(() => {
    if (!presetId) return;
    const p = presets.find((x) => x.id === presetId);
    if (!p) return;
    setName(`${p.name} — ${new Date().toLocaleDateString()}`);
    setTemplateId(p.templateId);
    setStaticValues(p.staticDefaults);
    setFieldMappings(p.fieldMappings || {});
    // Legacy migration: if no fieldMappings but has a mappedField, synthesize one.
    if ((!p.fieldMappings || Object.keys(p.fieldMappings).length === 0) && p.mappedField) {
      setFieldMappings({ [p.mappedField]: { mode: 'column', csvColumn: p.csvColumn ?? undefined } });
    }
  }, [presetId, presets]);

  // Apply duplicateFrom on mount. Clones template + mappings + static values
  // + source data so the user can re-run the same batch with a fresh name.
  // Hydrated after the runs store loads, so we wait until runs is populated.
  const didApplyDuplicateRef = useRef<string | null>(null);
  useEffect(() => {
    if (!duplicateFrom) return;
    if (didApplyDuplicateRef.current === duplicateFrom) return;
    const src = runs.find((r) => r.id === duplicateFrom);
    if (!src) return;
    didApplyDuplicateRef.current = duplicateFrom;
    setName(`${src.name} — ${new Date().toLocaleDateString()}`);
    setTemplateId(src.templateId);
    setStaticValues(src.staticValues || {});
    setFieldMappings(src.fieldMappings || {});
    // Source data shape: if the original run used CSV (object rows), switch
    // to CSV mode and reconstruct headers from the first row's keys. If it
    // was paste mode (string rows), switch to paste and join with newlines.
    const sd = src.sourceData as (string[] | Record<string, string>[]);
    if (sd.length > 0 && typeof sd[0] === 'object' && !Array.isArray(sd[0])) {
      const headers = Object.keys(sd[0] as Record<string, string>);
      setInputMode('csv');
      setCsvHeaders(headers);
      setCsvRows(sd as Record<string, string>[]);
    } else if (sd.length > 0 && typeof sd[0] === 'string') {
      setInputMode('paste');
      setPasteText((sd as string[]).join('\n'));
      if (src.mappedField) setPasteField(src.mappedField);
    }
  }, [duplicateFrom, runs]);

  const template = useMemo(() => templates.find((t) => t.id === templateId) ?? null, [templates, templateId]);
  const format = template ? getFormatById(template.formatId) : null;
  const dynamicFields = useMemo(() => (template ? dynamicFieldsForTemplate(template) : []), [template]);
  // Static QR / barcode elements that would probably make sense as dynamic.
  // We surface them so the user can one-click convert without a trip to the designer.
  const flippable = useMemo(() => (template ? staticFlippableElements(template) : []), [template]);

  // Self-heal: if the chosen template has dynamic elements without a fieldName
  // (common for older templates + QRs that predate the auto-name fix), backfill
  // names in-place and persist. The user would otherwise be locked out of
  // using those elements in a run because they wouldn't show up in the picker.
  const didHealTemplateRef = useRef<string | null>(null);
  useEffect(() => {
    if (!template) return;
    if (didHealTemplateRef.current === template.id) return;
    const needsHeal = template.elements.some((el) => !el.isStatic && (!el.fieldName || !el.fieldName.trim()));
    if (!needsHeal) {
      didHealTemplateRef.current = template.id;
      return;
    }
    const used = new Set<string>();
    for (const el of template.elements) {
      if (el.fieldName && el.fieldName.trim()) used.add(el.fieldName.trim());
    }
    for (const el of template.elements) {
      if (el.isStatic) continue;
      if (el.fieldName && el.fieldName.trim()) continue;
      // Generate a type-based name, incrementing until unique.
      let n = 1;
      let candidate = `${el.type}_${n}`;
      while (used.has(candidate)) {
        n++;
        candidate = `${el.type}_${n}`;
      }
      used.add(candidate);
      updateElementLocal(template.id, el.id, { fieldName: candidate });
    }
    // Persist once, then remember we've healed this template id.
    void saveTemplate(template.id);
    didHealTemplateRef.current = template.id;
  }, [template, updateElementLocal, saveTemplate]);

  // Initialize field mappings when template changes: default all to static.
  // If it's the first time (no existing mappings), also auto-map any field
  // whose name contains 'qr' to a column mode (waiting for CSV).
  useEffect(() => {
    if (!template) return;
    setFieldMappings((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const f of dynamicFields) {
        if (!(f in next)) {
          next[f] = { mode: 'static' };
          changed = true;
        }
      }
      // Remove mappings for fields no longer in this template.
      for (const k of Object.keys(next)) {
        if (!dynamicFields.includes(k)) {
          delete next[k];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [template, dynamicFields]);

  // When a CSV is loaded, attempt to auto-map any column whose header
  // closely matches a dynamic field name.
  const applyAutoColumnMapping = (headers: string[], rows: Record<string, string>[]) => {
    if (!template) return;
    setFieldMappings((prev) => {
      const next = { ...prev };
      const urlCol = detectUrlColumn({ headers, rows });
      for (const field of dynamicFields) {
        // 1) Exact/normalized name match.
        const match = headers.find(
          (h) => h.toLowerCase().replace(/\s+/g, '') === field.toLowerCase().replace(/\s+/g, ''),
        );
        if (match) {
          next[field] = { mode: 'column', csvColumn: match };
          continue;
        }
        // 2) If this is the QR-ish field and we have a URL column, map it.
        const isQrField = /qr|url|code|tag/i.test(field);
        if (isQrField && urlCol) {
          next[field] = { mode: 'column', csvColumn: urlCol };
        }
      }
      return next;
    });
    // Auto-fill static values from row 1 where column name matches.
    if (rows.length > 0) {
      setStaticValues((prev) => {
        const next = { ...prev };
        for (const f of dynamicFields) {
          const match = headers.find(
            (h) => h.toLowerCase().replace(/\s+/g, '') === f.toLowerCase().replace(/\s+/g, ''),
          );
          if (match && !next[f]) next[f] = rows[0][match] ?? '';
        }
        return next;
      });
    }
  };

  const handleFile = async (file: File) => {
    const text = await file.text();
    const parsed = parseCsv(text);
    setCsvHeaders(parsed.headers);
    setCsvRows(parsed.rows);
    applyAutoColumnMapping(parsed.headers, parsed.rows);
  };

  // List of fields mapped to columns (variable fields).
  const variableFields = useMemo(
    () => dynamicFields.filter((f) => fieldMappings[f]?.mode === 'column' && fieldMappings[f]?.csvColumn),
    [dynamicFields, fieldMappings],
  );
  const staticFieldNames = useMemo(
    () => dynamicFields.filter((f) => !fieldMappings[f] || fieldMappings[f].mode === 'static'),
    [dynamicFields, fieldMappings],
  );

  // Pick the pasteField default once template loads.
  useEffect(() => {
    if (!template || pasteField) return;
    // Prefer a QR-ish field, else the first dynamic field.
    const qr = dynamicFields.find((f) => /qr|url|code|tag/i.test(f));
    setPasteField(qr ?? dynamicFields[0] ?? null);
  }, [template, dynamicFields, pasteField]);

  // Compute the effective sourceData based on input mode.
  const sourceData = useMemo<string[] | Record<string, string>[]>(() => {
    if (inputMode === 'paste') {
      return pasteText.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    }
    return csvRows;
  }, [inputMode, pasteText, csvRows]);

  const labelCount = sourceData.length;

  // Preview ZPL for the current row.
  const previewZpl = useMemo(() => {
    if (!template || !format) return '';
    const values: Record<string, string> = { ...staticValues };
    const row = sourceData[previewIndex];

    if (typeof row === 'string' && pasteField) {
      values[pasteField] = row;
    } else if (row && typeof row === 'object' && !Array.isArray(row)) {
      for (const [field, mapping] of Object.entries(fieldMappings)) {
        if (mapping.mode === 'column' && mapping.csvColumn) {
          values[field] = (row as Record<string, string>)[mapping.csvColumn] ?? '';
        }
      }
    }
    return generateZPL(template, format, values);
  }, [template, format, staticValues, fieldMappings, sourceData, previewIndex, pasteField]);

  const canCreate =
    name.trim().length > 0 &&
    !!template &&
    !!format &&
    labelCount > 0 &&
    (inputMode === 'csv' ? variableFields.length > 0 : !!pasteField);

  const handleCreateRun = async (autoStart = false) => {
    if (!canCreate || !template) return null;
    let finalMappings = fieldMappings;
    let legacyField: string | null = null;
    if (inputMode === 'paste' && pasteField) {
      // Paste mode: model as a column mapping with a synthetic column key.
      finalMappings = { ...fieldMappings, [pasteField]: { mode: 'column', csvColumn: '__paste__' } };
      legacyField = pasteField;
    }
    const run = await createRun({
      name: name.trim(),
      templateId: template.id,
      presetId: presetId ?? null,
      staticValues,
      fieldMappings: finalMappings,
      dataSource: inputMode as RunDataSource,
      sourceData,
      mappedField: legacyField,
      status: autoStart ? 'queued' : 'draft',
    });
    if (presetId) void updatePreset(presetId, { touch: true });
    return run;
  };

  const handleSaveAndPrint = async () => {
    const run = await handleCreateRun(true);
    if (run) setCreatedRunId(run.id);
  };

  // Generate + download a blank CSV with headers for every template dynamic
  // field, so users can open it in Excel / Sheets, fill in rows, and re-upload.
  const downloadCsvTemplate = () => {
    if (!template || dynamicFields.length === 0) return;
    const escape = (s: string) => {
      if (/[,"\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const header = dynamicFields.map(escape).join(',');
    const sampleRow = dynamicFields.map(() => '').join(',');
    const csv = `${header}\n${sampleRow}\n`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${template.name.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}-template.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSaveAsPreset = async () => {
    if (!template || !saveAsPresetName.trim()) return;
    const preset = await createPreset({
      name: saveAsPresetName.trim(),
      templateId: template.id,
      staticDefaults: staticValues,
      fieldMappings,
    });
    setSaveAsPresetName('');
    alert(`Preset "${preset.name}" saved.`);
  };

  if (createdRunId) {
    return (
      <AppShell>
        <RunPrinter runId={createdRunId} onDone={() => router.push(`/runs/${createdRunId}`)} />
      </AppShell>
    );
  }

  // The main AppShell nav has a 'Runs' tab, so no redundant 'Back to Runs'
  // action is needed here.
  return (
    <AppShell>
      <PageTitle title={name.trim() ? `New Run · ${name.trim()}` : 'New Run'} />
      <div className="flex-1 overflow-auto">
        <div className="max-w-[1100px] mx-auto w-full p-8 space-y-6">
          <h1 className="text-2xl font-bold text-zinc-100">New Print Run</h1>

          {/* Setup */}
          <section className="glass rounded-2xl p-5 border border-zinc-800 space-y-4">
            <h2 className="text-xs text-zinc-500 uppercase tracking-wider font-semibold">Setup</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-zinc-400 block mb-1.5">Run Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Jack Herer 3.5g — Apr 21 batch"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg text-sm text-zinc-100 px-3 py-2 focus:outline-none focus:border-amber-500/40"
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs text-zinc-400">Template</label>
                  <div className="flex items-center gap-2">
                    {/* Edit the currently-selected template without losing
                        your spot in the wizard — round-trips via ?returnTo. */}
                    {template && (
                      <Link
                        href={`/designer?id=${template.id}&returnTo=${encodeURIComponent('/runs/new')}`}
                        className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-amber-400 transition-colors"
                        title="Open this template in the designer"
                      >
                        <Pencil className="w-3 h-3" /> Edit
                      </Link>
                    )}
                    <button
                      type="button"
                      onClick={() => setShowNewTemplateDialog(true)}
                      disabled={formats.length === 0}
                      title={formats.length === 0 ? 'Create a format first' : 'Create a new template inline'}
                      className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-amber-400 transition-colors disabled:opacity-40 disabled:hover:text-zinc-500"
                    >
                      <Plus className="w-3 h-3" /> New template
                    </button>
                  </div>
                </div>
                {templates.length === 0 ? (
                  <p className="text-xs text-zinc-500 py-2">
                    No templates yet. <button type="button" onClick={() => setShowNewTemplateDialog(true)} disabled={formats.length === 0} className="text-amber-400 hover:underline disabled:opacity-40">Create one</button>
                    {formats.length === 0 && <> (but you need a <Link href="/formats" className="text-amber-400 hover:underline">format</Link> first)</>}
                    .
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
                        sublabel: f ? `${f.name} — ${f.width}" × ${f.height}"` : '',
                      };
                    })}
                  />
                )}
              </div>
            </div>
          </section>

          {template && flippable.length > 0 && (
            <section className="glass rounded-2xl p-5 border border-amber-500/30 bg-amber-500/5 space-y-3">
              <h2 className="text-xs text-amber-400 uppercase tracking-wider font-semibold">Convert to Dynamic</h2>
              <p className="text-xs text-zinc-400">
                These elements are currently static. Convert them to dynamic so they can vary per label in this run.
              </p>
              <div className="flex flex-wrap gap-2">
                {flippable.map((f) => (
                  <button
                    key={f.id}
                    onClick={async () => {
                      // Flip this element to dynamic with the suggested name, then persist.
                      updateElementLocal(template.id, f.id, { isStatic: false, fieldName: f.suggestedName });
                      await saveTemplate(template.id);
                    }}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-500/15 text-amber-300 border border-amber-500/30 hover:bg-amber-500/25 transition-colors"
                  >
                    Make <span className="font-semibold">{f.type.toUpperCase()}</span> dynamic
                    <span className="text-[10px] text-amber-500/70">→ {f.suggestedName}</span>
                  </button>
                ))}
              </div>
            </section>
          )}
          {template && dynamicFields.length === 0 && flippable.length === 0 && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-300">
              This template has no dynamic fields. Open it in the <Link href={`/designer?id=${template.id}`} className="underline">designer</Link> and mark elements as Dynamic to use them in a print run.
            </div>
          )}

          {template && dynamicFields.length > 0 && (
            <>
              {/* Data source */}
              <section className="glass rounded-2xl p-5 border border-zinc-800 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-xs text-zinc-500 uppercase tracking-wider font-semibold">Data Source</h2>
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

                {inputMode === 'paste' ? (
                  <>
                    <div>
                      <label className="text-xs text-zinc-400 block mb-1.5">One value per line</label>
                      <textarea
                        value={pasteText}
                        onChange={(e) => setPasteText(e.target.value)}
                        rows={7}
                        placeholder={'HTTPS://1A4.COM/5LO1I9DSOPW43WR19JI8\nHTTPS://1A4.COM/5LO1I9DSOPW43WR19JI9\n...'}
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-100 font-mono px-3 py-2 focus:outline-none focus:border-amber-500/40 resize-y"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-zinc-400 block mb-1.5">Fill which field with these values?</label>
                      <CustomSelect
                        value={pasteField ?? ''}
                        onChange={(v) => setPasteField(v || null)}
                        options={dynamicFields.map((f) => ({ value: f, label: f }))}
                      />
                    </div>
                  </>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-amber-500/30 text-sm text-zinc-300 transition-colors"
                      >
                        <Upload className="w-4 h-4" /> {csvHeaders.length > 0 ? 'Replace CSV' : 'Upload CSV'}
                      </button>
                      <button
                        onClick={downloadCsvTemplate}
                        disabled={dynamicFields.length === 0}
                        title="Download a blank CSV with headers matching your template fields"
                        className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-amber-500/30 text-sm text-zinc-400 transition-colors disabled:opacity-40"
                      >
                        <Download className="w-4 h-4" /> CSV Template
                      </button>
                    </div>
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
                      <p className="text-xs text-zinc-500">
                        {csvHeaders.length} columns · {csvRows.length} rows
                      </p>
                    )}
                  </div>
                )}
              </section>

              {/* Field mapping (CSV mode only, after upload) */}
              {inputMode === 'csv' && csvHeaders.length > 0 && (
                <section className="glass rounded-2xl p-5 border border-zinc-800 space-y-4">
                  <h2 className="text-xs text-zinc-500 uppercase tracking-wider font-semibold">Field Mapping</h2>
                  <p className="text-xs text-zinc-500">
                    For each dynamic field, pick <span className="text-zinc-300">Static</span> (one value for all labels) or
                    <span className="text-zinc-300"> Column</span> (a different value per row from your CSV).
                  </p>
                  <div className="space-y-2">
                    {dynamicFields.map((field) => {
                      const mapping = fieldMappings[field] ?? { mode: 'static' };
                      return (
                        <div key={field} className="flex items-center gap-3 p-3 rounded-lg bg-zinc-950 border border-zinc-800/60">
                          <div className="w-36 shrink-0 font-medium text-sm text-zinc-200">{field}</div>
                          <div className="flex items-center gap-0.5 p-0.5 rounded-md bg-zinc-900 border border-zinc-800">
                            <button
                              onClick={() => setFieldMappings((m) => ({ ...m, [field]: { mode: 'static' } }))}
                              className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${mapping.mode === 'static' ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500'}`}
                            >
                              Static
                            </button>
                            <button
                              onClick={() => setFieldMappings((m) => ({ ...m, [field]: { mode: 'column', csvColumn: mapping.csvColumn ?? csvHeaders[0] } }))}
                              className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${mapping.mode === 'column' ? 'bg-amber-500/20 text-amber-400' : 'text-zinc-500'}`}
                            >
                              Column
                            </button>
                          </div>
                          {mapping.mode === 'column' ? (
                            <div className="flex-1 min-w-0">
                              <CustomSelect
                                value={mapping.csvColumn ?? ''}
                                onChange={(v) => setFieldMappings((m) => ({ ...m, [field]: { mode: 'column', csvColumn: v } }))}
                                options={csvHeaders.map((h) => ({ value: h, label: h }))}
                              />
                            </div>
                          ) : (
                            <input
                              type="text"
                              value={staticValues[field] ?? ''}
                              onChange={(e) => setStaticValues((s) => ({ ...s, [field]: e.target.value }))}
                              placeholder={`Static value for ${field}`}
                              className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg text-sm text-zinc-100 px-3 py-1.5 focus:outline-none focus:border-amber-500/40"
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

              {/* Paste-mode static fields */}
              {inputMode === 'paste' && staticFieldNames.length > 0 && (
                <section className="glass rounded-2xl p-5 border border-zinc-800 space-y-4">
                  <h2 className="text-xs text-zinc-500 uppercase tracking-wider font-semibold">Static Fields (same on every label)</h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {staticFieldNames.filter((f) => f !== pasteField).map((f) => (
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

              {/* Preview — always show once a format is selected; when there's
                  no data yet, we still render the template with its placeholders
                  so the user can see what they're working with. */}
              {format && (
                <section className="glass rounded-2xl p-5 border border-zinc-800 space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-xs text-zinc-500 uppercase tracking-wider font-semibold">Preview</h2>
                    {labelCount > 0 ? (
                      <div className="flex items-center gap-2 text-xs">
                        <button
                          onClick={() => setPreviewIndex((i) => Math.max(0, i - 1))}
                          disabled={previewIndex === 0}
                          className="px-2 py-1 rounded-md bg-zinc-900 text-zinc-400 hover:text-zinc-200 disabled:opacity-30"
                        >
                          Prev
                        </button>
                        <span className="text-zinc-400 tabular-nums">
                          Label {previewIndex + 1} / {labelCount}
                        </span>
                        <button
                          onClick={() => setPreviewIndex((i) => Math.min(labelCount - 1, i + 1))}
                          disabled={previewIndex >= labelCount - 1}
                          className="px-2 py-1 rounded-md bg-zinc-900 text-zinc-400 hover:text-zinc-200 disabled:opacity-30"
                        >
                          Next
                        </button>
                      </div>
                    ) : (
                      <span className="text-[11px] text-zinc-500">Showing defaults — add data for per-label preview</span>
                    )}
                  </div>
                  <div className="rounded-xl bg-zinc-950/60 p-4">
                    {format.type === 'sheet' ? (
                      // Sheets can't render via the ZPL WASM engine — show the
                      // actual sheet-grid layout so the user sees 10x20 /
                      // 8x11 / whatever their template actually is.
                      <LayoutPreview format={format} elements={template.elements} />
                    ) : (
                      <LocalZplPreview zpl={previewZpl} format={format} />
                    )}
                  </div>
                </section>
              )}

              {/* Save preset + print */}
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
                    {inputMode === 'csv' && variableFields.length === 0
                      ? 'Map at least one field to a CSV column to proceed.'
                      : 'Need a run name, template, and data to proceed.'}
                  </p>
                )}
                <button
                  onClick={handleSaveAndPrint}
                  disabled={!canCreate}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-sm font-semibold bg-gradient-to-r from-amber-500 to-amber-600 text-black hover:from-amber-400 hover:to-amber-500 transition-all shadow-lg shadow-amber-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Play className="w-4 h-4" /> Start Run ({labelCount} label{labelCount === 1 ? '' : 's'})
                </button>
              </section>
            </>
          )}
        </div>
      </div>
      {/* Inline 'New template' dialog. On submit we create the template,
          select it in this wizard so the user can keep going, and send
          them to the designer with a returnTo so they can lay out the
          actual elements and come back. */}
      <NewTemplateDialog
        isOpen={showNewTemplateDialog}
        onClose={() => setShowNewTemplateDialog(false)}
        onCreate={async (tName, tDesc, tFormatId) => {
          setShowNewTemplateDialog(false);
          const t = await addTemplate({ name: tName, description: tDesc, formatId: tFormatId, elements: [] });
          if (t) {
            setTemplateId(t.id);
            // Soft nudge to the designer so the user can actually lay out
            // the template; a returnTo brings them back here to continue
            // the run once they're done.
            router.push(`/designer?id=${t.id}&returnTo=${encodeURIComponent('/runs/new')}`);
          }
        }}
      />
    </AppShell>
  );
}

// Inline ZPL preview via zpl-renderer-js WASM. Accepts the extra thermal
// fields needed to size the canvas for multi-across rolls plus an optional
// outlines overlay matching the designer + run detail page treatment.
function LocalZplPreview({ zpl, format, showOutlines = true }: { zpl: string; format: { width: number; height: number; dpi?: number; type: string; labelsAcross?: number; horizontalGapThermal?: number; sideMarginThermal?: number; linerWidth?: number }; showOutlines?: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setErr(null);
    (async () => {
      try {
        const mod = await import('zpl-renderer-js');
        const { api } = await mod.ready;
        const across = Math.max(1, format.labelsAcross || 1);
        const gapIn = format.horizontalGapThermal || 0;
        const sideIn = format.sideMarginThermal || 0;
        const computedLinerIn = sideIn * 2 + across * format.width + (across - 1) * gapIn;
        const linerIn = format.linerWidth || computedLinerIn;
        const widthMm = linerIn * 25.4;
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
  }, [zpl, format.width, format.height, format.dpi, format.labelsAcross, format.horizontalGapThermal, format.sideMarginThermal, format.linerWidth]);

  if (err) return <p className="text-xs text-red-400">{err}</p>;
  if (!url) return <p className="text-xs text-zinc-500">Rendering…</p>;
  // LabelOutlineOverlay needs the full LabelFormat shape; coerce the loose
  // format prop (which only guarantees thermal fields) for the overlay. Safe
  // because the overlay only reads those thermal fields.
  return (
    <div className="relative inline-block mx-auto">
      <img
        src={url}
        alt="Label preview"
        className="rounded-lg border border-zinc-800 bg-white"
        style={{ imageRendering: 'pixelated', maxWidth: '100%', maxHeight: '400px', display: 'block' }}
      />
      {showOutlines && (format.labelsAcross ?? 1) > 1 && (
        <LabelOutlineOverlay format={format as unknown as import('@/lib/types').LabelFormat} />
      )}
    </div>
  );
}

export default function NewRunPage() {
  return (
    <Suspense fallback={null}>
      <NewRunContent />
    </Suspense>
  );
}
