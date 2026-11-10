'use client';

import { useState, useEffect, useMemo, useRef, Suspense, useCallback, useId } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Upload, Clipboard, Save, Play, AlertCircle, FileSpreadsheet, Download, Plus, Pencil, Search, CheckCircle2, Circle, Eye, EyeOff } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { PageTitle } from '@/components/PageTitle';
import { CustomSelect } from '@/components/ui/CustomSelect';
import { SegmentedIndicator } from '@/components/ui/Segmented';
import { useFormatStore } from '@/lib/store';
import { useTemplateStore } from '@/lib/templateStore';
import { NewTemplateDialog } from '@/components/designer/TemplateList';
import { useRunStore } from '@/lib/runStore';
import { parseCsv, detectUrlColumn } from '@/lib/csv';
import { dynamicFieldsForTemplate, staticFlippableElements } from '@/lib/runBuilder';
import { generateZPLWithImages } from '@/lib/zplGenerator';
import { renderZplToDataUrl } from '@/lib/zplRenderClient';
import { prepareRunPreview, type RunPreviewState } from '@/lib/runPreview';
import { RunImagePicker } from '@/components/runs/RunImagePicker';
import { applyRunImages, validateRunImages, type RunImageSelections } from '@/lib/runImages';
import { BlankValueCheck } from '@/components/runs/BlankValueCheck';
import { blankCheckAllowsPrinting, checkRunData, describeBlankSummary, rememberBlankChoice } from '@/lib/runDataCheck';
import { confirmDialog, toast } from '@/components/ui/feedback';
import { friendlyError, isNetworkError } from '@/lib/userMessages';
import { LabelOutlineOverlay } from '@/components/LabelOutlineOverlay';
import { LayoutPreview } from '@/components/designer/LayoutPreview';
import { MANIFEST_FIELD_OPTIONS, MANIFEST_FIELDS } from '@/lib/manifestFields';
import type { FieldMapping, RunDataSource } from '@/lib/types';
import { contentModeUpdates } from '@/lib/elementBinding';

const PASTE_COLUMN = '__paste__';
const MANIFEST_HEADERS = [...MANIFEST_FIELDS];

const FIELD_ALIASES: Record<string, string[]> = {
  strain: ['strain', 'productName', 'itemName'],
  product: ['productName', 'itemName'],
  size: ['quantity'],
  tac: ['tacPercent'],
  tacpercent: ['tacPercent', 'totalActiveCannabinoidsPercent'],
  totalactivecannabinoids: ['totalActiveCannabinoidsPercent', 'tacPercent'],
  totalactivecannabinoidspercent: ['totalActiveCannabinoidsPercent', 'tacPercent'],
  totalcannabinoids: ['totalCannabinoidsPercent'],
  totalcannabinoidspercent: ['totalCannabinoidsPercent'],
  tacmg: ['tacMgG'],
  tacmgg: ['tacMgG', 'totalActiveCannabinoidsMgG'],
  tacmggg: ['tacMgG', 'totalActiveCannabinoidsMgG'],
  tacmgpackage: ['tacMgPackage', 'totalActiveCannabinoidsMgPackage'],
  tacmgpkg: ['tacMgPackage', 'totalActiveCannabinoidsMgPackage'],
  tacperserving: ['tacMgServing', 'tacPerServing', 'totalActiveCannabinoidsMgServing'],
  tacmgserving: ['tacMgServing', 'tacPerServing', 'totalActiveCannabinoidsMgServing'],
  tacmgperserving: ['tacMgServing', 'tacPerServing', 'totalActiveCannabinoidsMgServing'],
  totalactivecannabinoidsmg: ['totalActiveCannabinoidsMgG', 'tacMgG'],
  totalactivecannabinoidsmgg: ['totalActiveCannabinoidsMgG', 'tacMgG'],
  totalactivecannabinoidsmgserving: ['totalActiveCannabinoidsMgServing', 'tacMgServing'],
  totalactivecannabinoidsperserving: ['totalActiveCannabinoidsMgServing', 'tacMgServing'],
  totalcannabinoidsmg: ['totalCannabinoidsMgG'],
  totalcannabinoidsmgg: ['totalCannabinoidsMgG'],
  thc: ['thcPercent'],
  thcpercent: ['thcPercent'],
  thcmg: ['thcMgG'],
  thcmgg: ['thcMgG'],
  thcmgpackage: ['thcMgPackage'],
  thcmgpkg: ['thcMgPackage'],
  thcperserving: ['thcMgServing', 'thcPerServing'],
  thcmgserving: ['thcMgServing', 'thcPerServing'],
  thcmgperserving: ['thcMgServing', 'thcPerServing'],
  cbd: ['cbdPercent'],
  cbdpercent: ['cbdPercent'],
  cbdmg: ['cbdMgG'],
  cbdmgg: ['cbdMgG'],
  cbdmgpackage: ['cbdMgPackage'],
  cbdmgpkg: ['cbdMgPackage'],
  cbdperserving: ['cbdMgServing', 'cbdPerServing'],
  cbdmgserving: ['cbdMgServing', 'cbdPerServing'],
  cbdmgperserving: ['cbdMgServing', 'cbdPerServing'],
  servingsize: ['servingSize'],
  serving: ['servingSize'],
  servings: ['servingCount', 'numberOfDoses', 'servingsPerPackage'],
  servingcount: ['servingCount', 'numberOfDoses', 'servingsPerPackage'],
  numberofdoses: ['numberOfDoses', 'servingCount', 'servingsPerPackage'],
  servingsperpackage: ['servingsPerPackage', 'servingCount', 'numberOfDoses'],
  qr1: ['retailId'],
  qrqpt: ['retailId'],
  qr: ['retailId'],
  qrcode: ['retailId'],
  retailid: ['retailId'],
  metrcretailid: ['retailId'],
  mfgdate: ['manufacturedDate', 'packagedDate'],
  manufactureddate: ['manufacturedDate', 'packagedDate'],
  packageddate: ['packagedDate', 'manufacturedDate'],
  expdate: ['expirationDate'],
  expirationdate: ['expirationDate'],
  lot: ['lotNumber', 'batchNumber', 'batch'],
  lotnumber: ['lotNumber', 'batchNumber', 'batch'],
  batch: ['batchNumber', 'lotNumber', 'batch'],
  batchnumber: ['batchNumber', 'lotNumber', 'batch'],
  uid: ['retailId', 'packageTag', 'tag'],
  packagetag: ['packageTag', 'tag'],
};

type RunInputMode = 'manual' | 'paste' | 'csv' | 'manifest';
type ManifestRow = Record<string, string>;

function normalizedFieldName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function findBestHeaderForField(field: string, headers: string[], rows: Record<string, string>[]) {
  const normalizedField = normalizedFieldName(field);
  const exact = headers.find((h) => normalizedFieldName(h) === normalizedField);
  if (exact) return exact;

  if (/^qr\d*$/.test(normalizedField) && headers.includes('retailId')) return 'retailId';

  for (const alias of FIELD_ALIASES[normalizedField] ?? []) {
    if (headers.includes(alias)) return alias;
  }

  const urlCol = detectUrlColumn({ headers, rows });
  const isQrField = /qr|url|code|tag/i.test(field);
  if (isQrField && urlCol) return urlCol;

  return null;
}

function manifestPackageKey(row: ManifestRow) {
  return row.packageTag || row.tag || row.id || `${row.itemName}-${row.batch}`;
}

function shortRunDate(date = new Date()) {
  return `${date.getMonth() + 1}/${date.getDate()}/${String(date.getFullYear()).slice(-2)}`;
}

function NewRunContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const presetId = searchParams.get('presetId');
  const sourceParam = searchParams.get('source');
  const manifestDeepLinkQuery =
    searchParams.get('packageTag') ||
    searchParams.get('manifestPackage') ||
    (sourceParam === 'manifest' ? searchParams.get('q') : null);
  const deepLinkTemplateId = searchParams.get('templateId');
  // Re-run action from the run detail page: `/runs/new?duplicateFrom=<runId>`.
  // Clones the source run's template, static values, mappings, and data so
  // the user just has to edit the name and hit Print. Static field values are
  // preserved too so same-batch re-prints are one click.
  const duplicateFrom = searchParams.get('duplicateFrom');

  const { templates, addTemplate, updateElementLocal, saveTemplate } = useTemplateStore();
  const { formats, getFormatById } = useFormatStore();
  const { runs, presets, fetchRun, createRun, createPreset, updatePreset } = useRunStore();

  // Form state
  const [name, setName] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [imagesByTemplate, setImagesByTemplate] = useState<Record<string, RunImageSelections>>({});
  const [imageBusy, setImageBusy] = useState(false);
  const [staticValues, setStaticValues] = useState<Record<string, string>>({});
  const staticValuesRef = useRef(staticValues);
  useEffect(() => { staticValuesRef.current = staticValues; }, [staticValues]);
  const [fieldMappings, setFieldMappings] = useState<Record<string, FieldMapping>>({});
  const [hiddenRunFields, setHiddenRunFields] = useState<string[]>([]);
  const [inputMode, setInputMode] = useState<RunInputMode>('manual');
  const [pasteText, setPasteText] = useState('');
  const [pasteField, setPasteField] = useState<string | null>(null);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<Record<string, string>[]>([]);
  const [manifestSearch, setManifestSearch] = useState('');
  const [manifestRows, setManifestRows] = useState<ManifestRow[]>([]);
  // Saved rows may omit package metadata. Keep their exact order and mappings
  // until a new Manifest search explicitly replaces them.
  const [savedManifestRows, setSavedManifestRows] = useState<ManifestRow[] | null>(null);
  const [selectedManifestPackageKey, setSelectedManifestPackageKey] = useState<string | null>(null);
  const [manifestError, setManifestError] = useState<string | null>(null);
  const [isSearchingManifest, setIsSearchingManifest] = useState(false);
  const [hasSearchedManifest, setHasSearchedManifest] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [saveAsPresetName, setSaveAsPresetName] = useState('');
  const [manualQty, setManualQty] = useState(1);
  const [manualQtyDraft, setManualQtyDraft] = useState('1');
  const [isCreatingRun, setIsCreatingRun] = useState(false);
  const [leaveBlank, setLeaveBlank] = useState(false);
  const [leavingAfterCreate, setLeavingAfterCreate] = useState(false);
  const formId = useId();
  const [createRunError, setCreateRunError] = useState<string | null>(null);
  // Controls the 'create new template' dialog invoked from the template
  // picker. Kept local to this page so the modal render + submit logic
  // doesn't leak into the template store.
  const [showNewTemplateDialog, setShowNewTemplateDialog] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastAutoManifestNameRef = useRef('');

  useEffect(() => {
    setManualQtyDraft(String(manualQty));
  }, [manualQty]);

  const commitManualQty = useCallback((raw: string) => {
    const next = Math.max(1, Math.min(9999, parseInt(raw, 10) || 1));
    setManualQty(next);
    setManualQtyDraft(String(next));
  }, []);

  useEffect(() => {
    if (!deepLinkTemplateId || presetId || duplicateFrom) return;
    if (!templates.some((t) => t.id === deepLinkTemplateId)) return;
    setTemplateId(deepLinkTemplateId);
  }, [deepLinkTemplateId, duplicateFrom, presetId, templates]);

  useEffect(() => {
    if (presetId || duplicateFrom) return;
    if (sourceParam === 'manifest' || sourceParam === 'csv' || sourceParam === 'paste' || sourceParam === 'manual') {
      setInputMode(sourceParam);
    }
  }, [duplicateFrom, presetId, sourceParam]);

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
    if (!src || !src.designSnapshot || (src.totalLabels > 0 && src.sourceData.length === 0)) {
      void fetchRun(duplicateFrom);
      return;
    }
    didApplyDuplicateRef.current = duplicateFrom;
    setName(`${src.name} — ${new Date().toLocaleDateString()}`);
    setTemplateId(src.templateId);
    // Legacy defaults may not meet the stricter upload limits.
    const copiedImages: RunImageSelections = {};
    for (const element of src.designSnapshot.template.elements) {
      if (element.type !== 'image' || !element.runSelectable) continue;
      try { validateRunImages({ ...copiedImages, [element.id]: element.src }); copiedImages[element.id] = element.src; } catch { /* Keep the template default for unsupported legacy artwork. */ }
    }
    setImagesByTemplate(current => ({ ...current, [src.templateId]: copiedImages }));
    setStaticValues(src.staticValues || {});
    setFieldMappings(src.fieldMappings || {});
    // Source data is migrating toward one row-object shape. Older paste runs
    // may still be string arrays, and newer paste runs use a synthetic column.
    const sd = src.sourceData as (string[] | Record<string, string>[]);
    if (sd.length > 0 && typeof sd[0] === 'object' && !Array.isArray(sd[0])) {
      const rows = sd as Record<string, string>[];
      const headers = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
      const pasteMappedField = Object.entries(src.fieldMappings || {}).find(([, mapping]) => mapping.csvColumn === PASTE_COLUMN)?.[0] ?? src.mappedField;
      if (src.dataSource === 'paste' || headers.includes(PASTE_COLUMN)) {
        setInputMode('paste');
        setPasteText(rows.map((row) => row[PASTE_COLUMN] ?? '').filter(Boolean).join('\n'));
        if (pasteMappedField) setPasteField(pasteMappedField);
      } else {
        setInputMode(src.dataSource === 'manual' ? 'manual' : src.dataSource === 'manifest' ? 'manifest' : 'csv');
        if (src.dataSource === 'manifest') {
          setManifestRows(rows as ManifestRow[]);
          setSavedManifestRows(rows as ManifestRow[]);
          setSelectedManifestPackageKey(manifestPackageKey(rows[0] as ManifestRow));
        } else {
          setCsvHeaders(headers);
          setCsvRows(rows);
        }
      }
    } else if (sd.length > 0 && typeof sd[0] === 'string') {
      setInputMode('paste');
      setPasteText((sd as string[]).join('\n'));
      if (src.mappedField) setPasteField(src.mappedField);
    }
  }, [duplicateFrom, fetchRun, runs]);

  useEffect(() => { if (templateId) void useTemplateStore.getState().fetchTemplate(templateId); }, [templateId]);
  const template = useMemo(() => templates.find((t) => t.id === templateId && !t.summaryOnly) ?? null, [templates, templateId]);
  const imageSelections = useMemo(() => imagesByTemplate[templateId] ?? {}, [imagesByTemplate, templateId]);
  const previewTemplate = useMemo(() => template ? applyRunImages(template, Object.fromEntries(Object.entries(imageSelections).filter(([id]) => template.elements.some(e => e.id === id && e.type === 'image' && e.runSelectable)))) : null, [template, imageSelections]);
  const format = template ? getFormatById(template.formatId) : null;
  const allDynamicFields = useMemo(() => (template ? dynamicFieldsForTemplate(template) : []), [template]);
  const hiddenRunFieldSet = useMemo(() => new Set(hiddenRunFields), [hiddenRunFields]);
  const dynamicFields = useMemo(
    () => allDynamicFields.filter((field) => !hiddenRunFieldSet.has(field)),
    [allDynamicFields, hiddenRunFieldSet],
  );
  const visibleFieldSet = useMemo(() => new Set(dynamicFields), [dynamicFields]);
  const visibleStaticValues = useMemo(() => {
    const next: Record<string, string> = {};
    for (const field of dynamicFields) {
      if (staticValues[field] !== undefined) next[field] = staticValues[field];
    }
    return next;
  }, [dynamicFields, staticValues]);
  // Static QR / barcode elements that would probably make sense as dynamic.
  // We surface them so the user can one-click convert without a trip to the designer.
  const flippable = useMemo(() => (template ? staticFlippableElements(template) : []), [template]);

  useEffect(() => {
    setHiddenRunFields((prev) => prev.filter((field) => allDynamicFields.includes(field)));
  }, [allDynamicFields]);

  const toggleRunFieldVisibility = (field: string) => {
    setHiddenRunFields((prev) => (
      prev.includes(field) ? prev.filter((f) => f !== field) : [...prev, field]
    ));
  };

  // Older templates can have dynamic elements without a fieldName, so they do
  // not show up in the field picker. Naming them changes the shared design, so
  // it is an explicit action (button below) rather than a silent save on open,
  // which used to bump the template revision and break other designer tabs.
  const unnamedDynamic = useMemo(() => template ? template.elements.filter((el) => el.type !== 'image' && !el.isStatic && (!el.fieldName || !el.fieldName.trim())) : [], [template]);
  const [namingFields, setNamingFields] = useState(false);
  const [namingError, setNamingError] = useState<string | null>(null);
  const nameUnnamedFields = async () => {
    if (!template || !unnamedDynamic.length) return;
    const used = new Set<string>();
    for (const el of template.elements) {
      if (el.fieldName && el.fieldName.trim()) used.add(el.fieldName.trim());
    }
    setNamingFields(true); setNamingError(null);
    try {
      for (const el of unnamedDynamic) {
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
      await saveTemplate(template.id);
    } catch (error) {
      setNamingError((error as Error).message || 'Could not save the design. Try again.');
    } finally {
      setNamingFields(false);
    }
  };

  // Initialize field mappings when template changes: default all to static.
  // If it's the first time (no existing mappings), also auto-map any field
  // whose name contains 'qr' to a column mode (waiting for CSV).
  useEffect(() => {
    if (!template) return;
    setFieldMappings((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const f of allDynamicFields) {
        if (!(f in next)) {
          next[f] = { mode: 'static' };
          changed = true;
        }
      }
      // Remove mappings for fields no longer in this template.
      for (const k of Object.keys(next)) {
        if (!allDynamicFields.includes(k)) {
          delete next[k];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [template, allDynamicFields]);

  // When a CSV is loaded, attempt to auto-map any column whose header
  // closely matches a dynamic field name.
  const applyAutoColumnMapping = useCallback((headers: string[], rows: Record<string, string>[], unmatchedFromSheet = false) => {
    if (!template) return;
    setFieldMappings((prev) => {
      const next = { ...prev };
      for (const field of dynamicFields) {
        const match = findBestHeaderForField(field, headers, rows);
        if (match) {
          next[field] = { mode: 'column', csvColumn: match };
        } else if (unmatchedFromSheet && !(staticValuesRef.current[field] ?? '').trim()) {
          // No matching column: leave the picker empty so the person sees it
          // needs a choice, instead of quietly switching to an empty
          // "Same on every label" box.
          next[field] = { mode: 'column', csvColumn: '' };
        }
      }
      return next;
    });
    // Auto-fill static values from row 1 where column name matches.
    if (rows.length > 0) {
      setStaticValues((prev) => {
        const next = { ...prev };
        for (const f of dynamicFields) {
          const match = findBestHeaderForField(f, headers, rows);
          if (match && !next[f]) next[f] = rows[0][match] ?? '';
        }
        return next;
      });
    }
  }, [dynamicFields, template]);

  const handleFile = async (file: File) => {
    const text = await file.text();
    const parsed = parseCsv(text);
    setCsvHeaders(parsed.headers);
    setCsvRows(parsed.rows);
    setLeaveBlank(false);
    applyAutoColumnMapping(parsed.headers, parsed.rows, true);
  };

  const searchManifest = useCallback(async (rawQuery: string) => {
    const query = rawQuery.trim();
    if (query.length < 2) return;
    setIsSearchingManifest(true);
    setHasSearchedManifest(true);
    setManifestError(null);
    try {
      const res = await fetch(`/api/nabis/search?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Manifest search failed');
      const rows = Array.isArray(data.packages) ? data.packages as ManifestRow[] : [];
      setManifestRows(rows);
      setSelectedManifestPackageKey(rows[0] ? manifestPackageKey(rows[0]) : null);
      setPreviewIndex(0);
      applyAutoColumnMapping(MANIFEST_HEADERS, rows);
      if (data.error) setManifestError(data.error);
    } catch (error) {
      setManifestError(error instanceof Error ? error.message : 'Manifest search failed');
      setManifestRows([]);
      setSelectedManifestPackageKey(null);
    } finally {
      setIsSearchingManifest(false);
    }
  }, [applyAutoColumnMapping]);

  const handleManifestSearch = async () => {
    await searchManifest(manifestSearch);
  };

  const didApplyManifestDeepLinkRef = useRef<string | null>(null);
  useEffect(() => {
    const query = manifestDeepLinkQuery?.trim();
    if (!query || query.length < 2) return;
    if (didApplyManifestDeepLinkRef.current === query) return;
    didApplyManifestDeepLinkRef.current = query;
    setInputMode('manifest');
    setManifestSearch(query);
    void searchManifest(query);
  }, [manifestDeepLinkQuery, searchManifest]);

  useEffect(() => {
    if (inputMode !== 'manifest' || manifestRows.length === 0 || manifestRows === savedManifestRows) return;
    applyAutoColumnMapping(MANIFEST_HEADERS, manifestRows);
  }, [applyAutoColumnMapping, inputMode, manifestRows, savedManifestRows]);

  // List of fields mapped to columns (variable fields).
  const variableFields = useMemo(
    () => dynamicFields.filter((f) => fieldMappings[f]?.mode === 'column' && fieldMappings[f]?.csvColumn),
    [dynamicFields, fieldMappings],
  );
  const staticFieldNames = useMemo(
    () => dynamicFields.filter((f) => !fieldMappings[f] || fieldMappings[f].mode === 'static'),
    [dynamicFields, fieldMappings],
  );

  const fromSheetLabel = inputMode === 'manifest' ? 'From Manifest' : 'From spreadsheet';
  // Fields with no matching spreadsheet column and no typed value.
  const unmatchedCsvFields = useMemo(() => dynamicFields.filter((f) => {
    const mapping = fieldMappings[f];
    if (mapping?.mode === 'column') return !mapping.csvColumn || !csvHeaders.includes(mapping.csvColumn);
    return !(staticValues[f] ?? '').trim();
  }), [dynamicFields, fieldMappings, csvHeaders, staticValues]);

  // Pick the pasteField default once template loads.
  useEffect(() => {
    if (!template) return;
    if (pasteField && dynamicFields.includes(pasteField)) return;
    // Prefer a QR-ish field, else the first dynamic field.
    const qr = dynamicFields.find((f) => /qr|url|code|tag/i.test(f));
    setPasteField(qr ?? dynamicFields[0] ?? null);
  }, [template, dynamicFields, pasteField]);

  const manifestSelectedRows = useMemo(() => {
    if (manifestRows === savedManifestRows) return manifestRows;
    if (!selectedManifestPackageKey) return [];
    return manifestRows.filter((row) => manifestPackageKey(row) === selectedManifestPackageKey);
  }, [manifestRows, selectedManifestPackageKey, savedManifestRows]);

  // Compute the effective sourceData based on input mode. New runs always use
  // row objects so manual/paste/CSV/Manifest can feed the same downstream shape.
  const sourceData = useMemo<Record<string, string>[]>(() => {
    if (inputMode === 'manual') {
      return Array.from({ length: Math.max(1, manualQty) }, () => ({ ...visibleStaticValues }));
    }
    if (inputMode === 'paste') {
      return pasteText
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((value) => ({ [PASTE_COLUMN]: value }));
    }
    if (inputMode === 'manifest') {
      return manifestSelectedRows;
    }
    return csvRows;
  }, [inputMode, pasteText, csvRows, manifestSelectedRows, manualQty, visibleStaticValues]);

  const labelCount = inputMode === 'manual' ? Math.max(1, manualQty) : sourceData.length;

  const manifestPackageSummaries = useMemo(() => {
    const packages = new Map<string, { row: ManifestRow; labelRows: number }>();
    for (const row of manifestRows) {
      const key = manifestPackageKey(row);
      const existing = packages.get(key);
      if (existing) {
        existing.labelRows += 1;
        continue;
      }
      packages.set(key, { row, labelRows: 1 });
    }
    return Array.from(packages.values());
  }, [manifestRows]);

  const selectedManifestPackageSummary = useMemo(
    () => manifestPackageSummaries.find(({ row }) => manifestPackageKey(row) === selectedManifestPackageKey) ?? null,
    [manifestPackageSummaries, selectedManifestPackageKey],
  );

  useEffect(() => {
    if (inputMode !== 'manifest' || !selectedManifestPackageSummary) return;
    const itemName = selectedManifestPackageSummary.row.itemName?.trim();
    if (!itemName) return;

    const autoName = `${itemName} - ${shortRunDate()}`;
    setName((current) => {
      const trimmed = current.trim();
      if (trimmed && trimmed !== lastAutoManifestNameRef.current) return current;
      lastAutoManifestNameRef.current = autoName;
      return autoName;
    });
  }, [inputMode, selectedManifestPackageSummary]);

  const previewValuesForIndex = useCallback((index: number) => {
    const values: Record<string, string> = { ...visibleStaticValues };
    const row = sourceData[index];

    if (row && typeof row === 'object' && !Array.isArray(row)) {
      for (const [field, mapping] of Object.entries(fieldMappings)) {
        if (!visibleFieldSet.has(field)) continue;
        if (mapping.mode === 'column' && mapping.csvColumn) {
          values[field] = (row as Record<string, string>)[mapping.csvColumn] ?? '';
        }
      }
    }
    return values;
  }, [visibleStaticValues, sourceData, fieldMappings, visibleFieldSet]);

  // Preview values for the current row.
  const previewValues = useMemo(() => previewValuesForIndex(previewIndex), [previewValuesForIndex, previewIndex]);

  const sheetPreviewValues = useMemo(() => {
    if (!format || format.type !== 'sheet') return undefined;
    const labelsPerSheet = Math.max(1, (format.columns || 1) * (format.rows || 1));
    const pageStart = Math.floor(previewIndex / labelsPerSheet) * labelsPerSheet;
    return Array.from({ length: labelsPerSheet }, (_, offset) => {
      const rowIndex = pageStart + offset;
      if (rowIndex >= labelCount) return undefined;
      return previewValuesForIndex(rowIndex);
    });
  }, [format, labelCount, previewIndex, previewValuesForIndex]);

  const selectedSheetLabelOffset = useMemo(() => {
    if (!format || format.type !== 'sheet') return undefined;
    const labelsPerSheet = Math.max(1, (format.columns || 1) * (format.rows || 1));
    return previewIndex % labelsPerSheet;
  }, [format, previewIndex]);

  // Preview ZPL for the current row. Image elements need async preparation so
  // the local Zebra render matches the browser canvas and actual print path.
  // Input identity also invalidates the old proof before effect cleanup runs.
  const previewInput = useMemo(() => ({ template: previewTemplate ?? template, format, values: previewValues }), [template, previewTemplate, format, previewValues]);
  const [previewResult, setPreviewResult] = useState<{ input: typeof previewInput; state: RunPreviewState } | null>(null);
  const previewState: RunPreviewState = previewResult?.input === previewInput
    ? previewResult.state
    : { status: 'loading' };
  useEffect(() => {
    if (!previewInput.template || !previewInput.format || previewInput.format.type !== 'thermal') return;
    const { template, format, values } = previewInput;
    return prepareRunPreview(
      () => generateZPLWithImages(template, format, values),
      (zpl) => renderZplToDataUrl(zpl, format),
      (state) => setPreviewResult({ input: previewInput, state }),
    );
  }, [previewInput]);
  const previewReady = format?.type !== 'thermal' || previewState.status === 'ready';

  const rowHeaders = inputMode === 'manifest' ? MANIFEST_HEADERS : csvHeaders;

  // The exact data the run will be created with, so the whole-run blank check
  // sees what the printer will see (hidden fields included: they would print
  // the design's sample text).
  const runDataForCheck = useMemo(() => {
    let mappings: Record<string, FieldMapping> = fieldMappings;
    let rows: Record<string, string>[] = sourceData;
    if (inputMode === 'manual') {
      mappings = Object.fromEntries(dynamicFields.map((f) => [f, { mode: 'static' } as FieldMapping]));
      rows = Array.from({ length: Math.max(1, manualQty) }, () => ({}));
    } else if (inputMode === 'paste' && pasteField) {
      mappings = { ...fieldMappings, [pasteField]: { mode: 'column', csvColumn: PASTE_COLUMN } };
    }
    mappings = Object.fromEntries(Object.entries(mappings).filter(([field]) => visibleFieldSet.has(field)));
    return { sourceData: rows, fieldMappings: mappings, staticValues: visibleStaticValues, mappedField: inputMode === 'paste' ? pasteField : null };
  }, [fieldMappings, sourceData, inputMode, dynamicFields, manualQty, pasteField, visibleFieldSet, visibleStaticValues]);
  const blankCheck = useMemo(() => checkRunData(previewTemplate ?? template ?? { elements: [] }, runDataForCheck), [previewTemplate, template, runDataForCheck]);
  useEffect(() => { setLeaveBlank(false); }, [blankCheck.signature]);
  const hasData = inputMode === 'manual' || labelCount > 0;
  const blanksOk = !hasData || blankCheckAllowsPrinting(blankCheck, leaveBlank);

  const canCreate =
    !imageBusy &&
    name.trim().length > 0 &&
    !!template &&
    !!format &&
    blanksOk &&
    (inputMode === 'manual'
      ? dynamicFields.every((f) => (staticValues[f] ?? '').trim().length > 0) && manualQty >= 1
      : labelCount > 0 && (inputMode === 'csv' || inputMode === 'manifest' ? variableFields.length > 0 : !!pasteField));

  // One plain reason, shown next to the Start button, for why it is disabled.
  const blockReason = !name.trim()
    ? 'Give this run a name to start.'
    : !template
      ? 'Choose a label design to start.'
      : !format
        ? 'This design has no label size. Open it in the designer to pick one.'
        : imageBusy
          ? 'Waiting for the picture to finish uploading…'
          : inputMode === 'manual' && !dynamicFields.every((f) => (staticValues[f] ?? '').trim().length > 0)
            ? 'Fill in every field to start.'
            : inputMode !== 'manual' && labelCount === 0
              ? inputMode === 'csv' ? 'Upload a spreadsheet (CSV) to start.' : inputMode === 'paste' ? 'Paste at least one value to start.' : 'Search and pick a Manifest package to start.'
              : (inputMode === 'csv' || inputMode === 'manifest') && variableFields.length === 0
                ? 'Pick a spreadsheet column for at least one field.'
                : inputMode === 'paste' && !pasteField
                  ? 'Choose which field the pasted values fill.'
                  : !blanksOk
                    ? `${describeBlankSummary(blankCheck)} — see the list above Start.`
                    : format.type === 'thermal' && previewState.status === 'error'
                      ? 'Fix the preview error above to start.'
                      : format.type === 'thermal' && previewState.status === 'loading'
                        ? 'Checking the label preview…'
                        : format.type === 'thermal' && previewState.status === 'empty'
                          ? 'No label output was generated. Check the design and data.'
                          : null;

  // Leaving a half-filled run loses the spreadsheet and settings: ask first.
  const formDirty = !leavingAfterCreate && (name.trim().length > 0 || !!templateId || csvRows.length > 0 || pasteText.trim().length > 0 || manifestRows.length > 0);
  const confirmLeave = useCallback(async () => {
    if (!formDirty) return true;
    return confirmDialog({ title: 'Leave this new run?', body: 'Your spreadsheet and settings will be lost.', confirmLabel: 'Leave', cancelLabel: 'Stay here', danger: true });
  }, [formDirty]);
  useEffect(() => {
    if (!formDirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [formDirty]);

  const compactSourceDataForRun = (
    rows: Record<string, string>[],
    mappings: Record<string, FieldMapping>,
  ): Record<string, string>[] => {
    const mappedColumns = new Set(
      Object.values(mappings)
        .filter((mapping) => mapping.mode === 'column' && mapping.csvColumn)
        .map((mapping) => mapping.csvColumn as string),
    );
    return rows.map((row) => {
      const compactRow: Record<string, string> = {};
      for (const column of mappedColumns) {
        if (column in row) compactRow[column] = row[column];
      }
      return compactRow;
    });
  };

  const handleCreateRun = async (autoStart = false) => {
    if (!canCreate || !previewReady || !template || isCreatingRun) return null;
    setIsCreatingRun(true);
    setCreateRunError(null);
    let finalMappings = fieldMappings;
    let legacyField: string | null = null;
    let finalSourceData: Record<string, string>[] = sourceData;
    try {
      if (inputMode === 'manual') {
        // Manual mode only needs placeholder rows for count/progress; values
        // come from staticValues.
        finalSourceData = Array.from({ length: Math.max(1, manualQty) }, () => ({}));
        finalMappings = {};
        for (const f of dynamicFields) {
          finalMappings[f] = { mode: 'static' };
        }
      } else if (inputMode === 'paste' && pasteField) {
        // Paste mode: model as a column mapping with a synthetic column key.
        finalMappings = { ...fieldMappings, [pasteField]: { mode: 'column', csvColumn: PASTE_COLUMN } };
        legacyField = pasteField;
      }
      finalMappings = Object.fromEntries(Object.entries(finalMappings).filter(([field]) => visibleFieldSet.has(field)));
      finalSourceData = compactSourceDataForRun(finalSourceData, finalMappings);
      const run = await createRun({
        name: name.trim(),
        templateId: template.id,
        imageSelections,
        presetId: presetId ?? null,
        staticValues: visibleStaticValues,
        fieldMappings: finalMappings,
        dataSource: inputMode as RunDataSource,
        sourceData: finalSourceData,
        mappedField: legacyField,
        status: autoStart ? 'queued' : 'draft',
      });
      if (presetId) void updatePreset(presetId, { touch: true });
      if (blankCheck.issues.length && leaveBlank) rememberBlankChoice(typeof window !== 'undefined' ? window.localStorage : null, run.id, blankCheck.signature);
      return run;
    } catch (error) {
      console.error('Error creating run:', error);
      setCreateRunError(isNetworkError(error)
        ? "Couldn't reach Label Wrangler — check your internet and press Start run again. Nothing was printed and your data is still here."
        : friendlyError(error, 'Could not start this run. Nothing was printed and your data is still here.'));
      return null;
    } finally {
      setIsCreatingRun(false);
    }
  };

  const handleSaveAndPrint = async () => {
    const run = await handleCreateRun(true);
    if (run) {
      // The run has its own address now, so a refresh or Back keeps it.
      setLeavingAfterCreate(true);
      router.replace(`/runs/${run.id}`);
    }
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
      staticDefaults: visibleStaticValues,
      fieldMappings: Object.fromEntries(Object.entries(fieldMappings).filter(([field]) => visibleFieldSet.has(field))),
    });
    setSaveAsPresetName('');
    toast(`Preset "${preset.name}" saved.`);
  };

  const setupComplete = name.trim().length > 0 && !!template && !!format;
  const fieldsComplete = !!template && allDynamicFields.length > 0 && dynamicFields.length > 0;
  // Data is only "done" once there is a design with fields and real values
  // for them (an empty field list used to read as ✓).
  const dataComplete = fieldsComplete && blanksOk && (inputMode === 'manual'
    ? dynamicFields.every((f) => (staticValues[f] ?? '').trim().length > 0) && manualQty >= 1
    : inputMode === 'paste'
      ? pasteText.trim().length > 0 && !!pasteField
      : labelCount > 0 && variableFields.length > 0);
  const workflowSteps = [
    { label: 'Setup', done: setupComplete },
    { label: 'Fields', done: fieldsComplete },
    { label: 'Data', done: dataComplete },
    { label: 'Review', done: canCreate },
  ];

  // The main AppShell nav has a 'Runs' tab, so no redundant 'Back to Runs'
  // action is needed here.
  return (
    <AppShell beforeLeave={confirmLeave}>
      <PageTitle title={name.trim() ? `New Run · ${name.trim()}` : 'New Run'} />
      <div className="flex-1 overflow-auto">
        <div className="max-w-[1180px] mx-auto w-full p-4 sm:p-6 lg:p-8 space-y-5 pb-48 sm:pb-28">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <h1 className="text-2xl font-semibold text-zinc-50">New print run</h1>
            <ol className="flex flex-wrap items-center gap-x-4 gap-y-1">
              {workflowSteps.map((step, index) => (
                <li
                  key={step.label}
                  className={`flex min-w-0 items-center gap-1.5 text-sm ${
                    step.done ? 'text-emerald-400' : index === workflowSteps.findIndex((s) => !s.done) ? 'text-zinc-100' : 'text-zinc-500'
                  }`}
                >
                  <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${
                    step.done ? 'bg-emerald-400' : index === workflowSteps.findIndex((s) => !s.done) ? 'bg-amber-500' : 'border border-zinc-600'
                  }`} />
                  <span className="truncate font-medium">{step.label}<span className="sr-only">{step.done ? ' (done)' : ' (not done yet)'}</span></span>
                </li>
              ))}
            </ol>
          </div>

          {/* Setup */}
          <section className="card p-4 sm:p-5 space-y-4">
            <SectionHeader
              title="Setup"
              detail="Name the job and choose the label template."
            />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor={`${formId}-name`} className="field-label mb-1.5">Run name</label>
                <input
                  id={`${formId}-name`}
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Jack Herer 3.5g — Apr 21 batch"
                  className="field"
                />
              </div>
              <div>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span id={`${formId}-template`} className="field-label">Label design</span>
                  <div className="-mr-2 flex items-center">
                    {/* Edit the currently-selected template without losing
                        your spot in the wizard — round-trips via ?returnTo. */}
                    {template && (
                      <Link
                        href={`/designer?id=${template.id}&returnTo=${encodeURIComponent('/runs/new')}`}
                        className="btn btn-ghost btn-sm"
                        title="Open this design in the designer"
                      >
                        <Pencil className="hidden size-4 sm:block" aria-hidden="true" /> Edit design
                      </Link>
                    )}
                    <button
                      type="button"
                      onClick={() => setShowNewTemplateDialog(true)}
                      disabled={formats.length === 0}
                      title={formats.length === 0 ? 'Create a label size first' : 'Create a new label design'}
                      className="btn btn-ghost btn-sm"
                    >
                      <Plus className="w-3 h-3" /> New design
                    </button>
                  </div>
                </div>
                {templates.length === 0 ? (
                  <p className="text-xs text-zinc-500 py-2">
                    No label designs yet. <button type="button" onClick={() => setShowNewTemplateDialog(true)} disabled={formats.length === 0} className="text-amber-400 hover:underline disabled:opacity-40">Create one</button>
                    {formats.length === 0 && <> (you need a <Link href="/formats" className="text-amber-400 hover:underline">label size</Link> first)</>}
                    .
                  </p>
                ) : (
                  <CustomSelect
                    aria-labelledby={`${formId}-template`}
                    value={templateId}
                    onChange={setTemplateId}
                    placeholder="Choose a label design…"
                    options={templates.filter((t) => !t.archivedAt || t.id === templateId).map((t) => {
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
            {template && format && (
              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <span className="section-title">Design preview</span>
                  <span className="truncate text-xs text-zinc-500" title={`${template.name} · ${format.name}`}>
                    {template.name} · {format.name}
                  </span>
                </div>
                <div className="rounded-lg bg-zinc-950 p-3">
                  <LayoutPreview thermalRenderMode={template.thermalRenderMode} format={format} elements={(previewTemplate ?? template).elements} testData={previewValues} />
                </div>
              </div>
            )}
          </section>

          {template && <RunImagePicker key={template.id} template={template} selections={imageSelections} onBusyChange={setImageBusy} onChange={value => setImagesByTemplate(current => ({ ...current, [template.id]: value }))} />}

          {template && unnamedDynamic.length > 0 && (
            <section className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 sm:p-5 space-y-3">
              <h2 className="text-sm font-semibold text-amber-300">Unnamed Fields</h2>
              <p className="text-sm text-zinc-300">
                {unnamedDynamic.length === 1 ? '1 dynamic element has' : `${unnamedDynamic.length} dynamic elements have`} no field name, so {unnamedDynamic.length === 1 ? 'it' : 'they'} can&apos;t be filled in this run. Naming them saves the shared design.
              </p>
              <button
                onClick={() => void nameUnnamedFields()}
                disabled={namingFields}
                className="btn btn-primary btn-sm"
              >
                {namingFields ? 'Saving design…' : 'Name fields and save design'}
              </button>
              {namingError && <p role="alert" className="text-xs text-red-400">{namingError}</p>}
            </section>
          )}

          {template && flippable.length > 0 && (
            <section className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 sm:p-5 space-y-3">
              <h2 className="text-sm font-semibold text-amber-300">Make it change per label</h2>
              <p className="text-sm text-zinc-300">
                These are set to &ldquo;Same on every label&rdquo;. Switch one to &ldquo;Changes per label&rdquo; to fill it from your spreadsheet. What it shows now stays as the preview sample.
              </p>
              <div className="flex flex-wrap gap-2">
                {flippable.map((f) => (
                  <button
                    key={f.id}
                    onClick={async () => {
                      // Flip this element to dynamic with the suggested name, then persist.
                      // Keep the current text as the preview sample.
                      const current = template.elements.find((el) => el.id === f.id);
                      updateElementLocal(template.id, f.id, current ? { ...contentModeUpdates({ ...current, fieldName: '' }, false, () => f.suggestedName) } : { isStatic: false, fieldName: f.suggestedName });
                      await saveTemplate(template.id);
                    }}
                    className="btn btn-secondary btn-sm h-auto py-1.5 text-left"
                  >
                    Make the <span className="font-semibold">{f.type === 'qr' ? 'QR code' : f.type}</span> change per label
                    <span className="text-zinc-400">→ {f.suggestedName}</span>
                  </button>
                ))}
              </div>
            </section>
          )}
          {template && allDynamicFields.length === 0 && flippable.length === 0 && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-300">
              Nothing on this design changes per label. Open it in the <Link href={`/designer?id=${template.id}`} className="underline">designer</Link> and set the parts that should change to &ldquo;Changes per label&rdquo;.
            </div>
          )}

          {template && allDynamicFields.length > 0 && (
            <>
              <section className="card p-4 sm:p-5 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <SectionHeader
                    title="Fields"
                    detail="Hide anything that should not be filled for this run."
                  />
                  {hiddenRunFields.length > 0 && (
                    <span className="text-xs text-zinc-500">
                      {hiddenRunFields.length} hidden
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {allDynamicFields.map((field) => {
                    const hidden = hiddenRunFieldSet.has(field);
                    return (
                      <button
                        key={field}
                        type="button"
                        onClick={() => toggleRunFieldVisibility(field)}
                        title={hidden ? `Show ${field} in this run` : `Hide ${field} from this run`}
                        aria-pressed={!hidden}
                        className={`btn btn-sm border ${
                          hidden
                            ? 'border-zinc-800 bg-transparent text-zinc-500 line-through hover:text-zinc-300'
                            : 'border-zinc-700 bg-zinc-800 text-zinc-100 hover:bg-zinc-700'
                        }`}
                      >
                        {hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        <span>{field}</span>
                      </button>
                    );
                  })}
                </div>
              </section>

              {/* Data source */}
              <section className="card p-4 sm:p-5 space-y-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <SectionHeader
                    title="Data source"
                    detail="Choose how Label Wrangler should fill the fields."
                  />
                  <div className="segmented w-full md:w-auto" role="group" aria-label="Data source">
                    <SegmentedIndicator index={['manual', 'paste', 'csv', 'manifest'].indexOf(inputMode)} count={4} />
                    <button
                      onClick={() => setInputMode('manual')}
                      aria-pressed={inputMode === 'manual'}
                    >
                      <Pencil className="w-3 h-3" /> Manual
                    </button>
                    <button
                      onClick={() => setInputMode('paste')}
                      aria-pressed={inputMode === 'paste'}
                    >
                      <Clipboard className="hidden size-4 sm:block" aria-hidden="true" /> Paste
                    </button>
                    <button
                      onClick={() => setInputMode('csv')}
                      aria-pressed={inputMode === 'csv'}
                    >
                      <FileSpreadsheet className="hidden size-4 sm:block" aria-hidden="true" /> CSV
                    </button>
                    <button
                      onClick={() => setInputMode('manifest')}
                      aria-pressed={inputMode === 'manifest'}
                    >
                      <Search className="hidden size-4 sm:block" aria-hidden="true" /> Manifest
                    </button>
                  </div>
                </div>

                {inputMode === 'manual' ? (
                  <div className="space-y-3">
                    <p className="text-sm text-zinc-300">
                      Type a value for each part that changes, then set how many copies to print.
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {dynamicFields.map((field) => (
                        <div key={field}>
                          <label htmlFor={`${formId}-manual-${field}`} className="field-label mb-1.5">{field}</label>
                          <input
                            id={`${formId}-manual-${field}`}
                            type="text"
                            value={staticValues[field] ?? ''}
                            onChange={(e) => setStaticValues((s) => ({ ...s, [field]: e.target.value }))}
                            placeholder={`Value for ${field}`}
                            className="field"
                          />
                        </div>
                      ))}
                    </div>
                    <div className="flex items-center gap-3 pt-1">
                      <label htmlFor={`${formId}-qty`} className="field-label">Quantity</label>
                      <input
                        id={`${formId}-qty`}
                        type="number"
                        min={1}
                        max={9999}
                        value={manualQtyDraft}
                        onChange={(e) => {
                          const nextDraft = e.target.value;
                          setManualQtyDraft(nextDraft);
                          const next = parseInt(nextDraft, 10);
                          if (Number.isFinite(next)) setManualQty(Math.max(1, Math.min(9999, next)));
                        }}
                        onBlur={() => commitManualQty(manualQtyDraft)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.currentTarget.blur();
                          } else if (e.key === 'Escape') {
                            setManualQtyDraft(String(manualQty));
                            e.currentTarget.blur();
                          }
                        }}
                        className="field w-24 tabular-nums"
                      />
                      <span className="text-xs text-zinc-500">labels</span>
                    </div>
                  </div>
                ) : inputMode === 'paste' ? (
                  <>
                    <div>
                      <label htmlFor={`${formId}-paste`} className="field-label mb-1.5">One value per line</label>
                      <textarea
                        id={`${formId}-paste`}
                        value={pasteText}
                        onChange={(e) => setPasteText(e.target.value)}
                        rows={7}
                        placeholder={'HTTPS://1A4.COM/5LO1I9DSOPW43WR19JI8\nHTTPS://1A4.COM/5LO1I9DSOPW43WR19JI9\n...'}
                        className="field font-mono text-xs resize-y"
                      />
                    </div>
                    <div>
                      <span id={`${formId}-paste-field`} className="field-label mb-1.5">Fill which field with these values?</span>
                      <CustomSelect
                        aria-labelledby={`${formId}-paste-field`}
                        value={pasteField ?? ''}
                        onChange={(v) => setPasteField(v || null)}
                        options={dynamicFields.map((f) => ({ value: f, label: f }))}
                      />
                    </div>
                  </>
                ) : inputMode === 'csv' ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="btn btn-primary"
                      >
                        <Upload className="w-4 h-4" /> {csvHeaders.length > 0 ? 'Replace CSV' : 'Upload CSV'}
                      </button>
                      <button
                        onClick={downloadCsvTemplate}
                        disabled={dynamicFields.length === 0}
                        title="Download a blank CSV with headers matching your template fields"
                        className="btn btn-secondary"
                      >
                        <Download className="w-4 h-4" /> Blank spreadsheet
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
                ) : (
                  <div className="space-y-3">
                    <div className="flex gap-2">
                      <input
                        value={manifestSearch}
                        onChange={(e) => {
                          setManifestSearch(e.target.value);
                          setHasSearchedManifest(false);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void handleManifestSearch();
                        }}
                        placeholder="Search package tag, item, or batch"
                        aria-label="Search Manifest packages"
                        className="field min-w-0 flex-1"
                      />
                      <button
                        onClick={handleManifestSearch}
                        disabled={manifestSearch.trim().length < 2 || isSearchingManifest}
                        className="btn btn-secondary"
                      >
                        <Search className="w-4 h-4" /> {isSearchingManifest ? 'Searching' : 'Search'}
                      </button>
                    </div>
                    {manifestError && <p className="text-xs text-amber-400">{manifestError}</p>}
                    {selectedManifestPackageSummary && (
                      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-amber-300" title={selectedManifestPackageSummary.row.itemName}>
                              {selectedManifestPackageSummary.row.itemName || '(no item)'}
                            </p>
                            <p className="truncate font-mono text-xs text-amber-300" title={selectedManifestPackageSummary.row.tag}>
                              {selectedManifestPackageSummary.row.tag || '(no tag)'}
                            </p>
                          </div>
                          <span className="shrink-0 text-xs font-medium text-amber-300">
                            {selectedManifestPackageSummary.labelRows.toLocaleString()} label{selectedManifestPackageSummary.labelRows === 1 ? '' : 's'}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center gap-2 text-xs text-amber-300">
                          <span className="truncate" title={selectedManifestPackageSummary.row.lotNumber || selectedManifestPackageSummary.row.batch}>
                            Lot {selectedManifestPackageSummary.row.lotNumber || selectedManifestPackageSummary.row.batch || '-'}
                          </span>
                          <span aria-hidden="true">/</span>
                          <span>Selected package</span>
                        </div>
                      </div>
                    )}
                    {manifestRows.length > 0 && (
                      <div className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
                        <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
                          <span className="section-title">Choose a package</span>
                          <span className="text-xs text-zinc-500">
                            {manifestPackageSummaries.length.toLocaleString()} package{manifestPackageSummaries.length === 1 ? '' : 's'}
                          </span>
                        </div>
                        <div className="max-h-56 overflow-auto">
                        {manifestPackageSummaries.map(({ row, labelRows }) => {
                          const key = manifestPackageKey(row);
                          const isSelected = key === selectedManifestPackageKey;
                          return (
                            <button
                              key={key}
                              type="button"
                              onClick={() => {
                                setSelectedManifestPackageKey(key);
                                setPreviewIndex(0);
                              }}
                              className={`grid w-full grid-cols-[auto_minmax(0,1.6fr)_minmax(0,1fr)_auto] gap-3 border-b px-3 py-2.5 text-left text-xs transition-colors last:border-b-0 ${
                                isSelected
                                  ? 'border-amber-500/30 bg-amber-500/10'
                                  : 'border-zinc-900 hover:bg-zinc-900/80'
                              }`}
                            >
                              <span className={`mt-0.5 ${isSelected ? 'text-amber-300' : 'text-zinc-500'}`}>
                                {isSelected ? <CheckCircle2 className="h-4 w-4" /> : <Circle className="h-4 w-4" />}
                              </span>
                              <span className="min-w-0">
                                <span className="block truncate text-zinc-200" title={row.itemName}>{row.itemName || '(no item)'}</span>
                                <span className="block truncate font-mono text-xs text-zinc-500" title={row.tag}>{row.tag || '(no tag)'}</span>
                              </span>
                              <span className="min-w-0 truncate text-zinc-500" title={row.lotNumber || row.batch}>
                                {row.lotNumber || row.batch || '(no batch)'}
                              </span>
                              <span className={`whitespace-nowrap text-right font-medium ${isSelected ? 'text-amber-300' : 'text-zinc-500'}`}>
                                {labelRows.toLocaleString()} label{labelRows === 1 ? '' : 's'}
                              </span>
                            </button>
                          );
                        })}
                        </div>
                      </div>
                    )}
                    {!isSearchingManifest && hasSearchedManifest && manifestRows.length === 0 && !manifestError && (
                      <div className="rounded-lg bg-zinc-950 px-3 py-3 text-sm text-zinc-400">
                        No Manifest packages found.
                      </div>
                    )}
                  </div>
                )}
              </section>

              {/* Field mapping for row-backed sources. */}
              {(inputMode === 'csv' || inputMode === 'manifest') && rowHeaders.length > 0 && labelCount > 0 && (
                <section className="card p-4 sm:p-5 space-y-4">
                  <SectionHeader
                    title="Field mapping"
                    detail={`Match each field on the label to a ${inputMode === 'manifest' ? 'Manifest field' : 'column in your spreadsheet'}.`}
                  />
                  {inputMode === 'csv' && unmatchedCsvFields.length > 0 && (
                    <div role="alert" className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300 space-y-1">
                      <p className="text-sm font-semibold text-amber-300">
                        We couldn&apos;t find {unmatchedCsvFields.length === 1 ? 'a column' : 'columns'} called {unmatchedCsvFields.map((f) => `"${f}"`).join(unmatchedCsvFields.length === 2 ? ' and ' : ', ')} in your file.
                      </p>
                      <p>Your file has: {csvHeaders.join(', ') || '(no columns)'}.</p>
                      <p>Pick which column fills each field below, or choose &ldquo;Same on every label&rdquo; and type one value.</p>
                    </div>
                  )}
                  <p className="text-xs text-zinc-500">
                    <span className="text-zinc-300">Same on every label</span> prints one value you type. <span className="text-zinc-300">{fromSheetLabel}</span> prints a different value on each label.
                  </p>
                  <div className="space-y-2">
                    {dynamicFields.map((field) => {
                      const mapping = fieldMappings[field] ?? { mode: 'static' };
                      const needsChoice = mapping.mode === 'column' ? !mapping.csvColumn : !(staticValues[field] ?? '').trim();
                      return (
                        <div key={field} className={`flex flex-col gap-2 rounded-lg border-l-2 bg-zinc-950 p-3 sm:flex-row sm:items-center sm:gap-3 ${needsChoice ? 'border-amber-500' : 'border-transparent'}`}>
                          <div id={`${formId}-map-${field}`} className="w-36 shrink-0 font-medium text-sm text-zinc-200 break-words">{field}</div>
                          <div role="radiogroup" aria-labelledby={`${formId}-map-${field}`} className="segmented w-full sm:w-auto sm:shrink-0">
                            <SegmentedIndicator index={mapping.mode === 'column' ? 1 : 0} count={2} />
                            <button
                              type="button"
                              role="radio"
                              aria-checked={mapping.mode === 'static'}
                              onClick={() => setFieldMappings((m) => ({ ...m, [field]: { mode: 'static' } }))}
                              data-active={mapping.mode === 'static'}
                            >
                              Same on every label
                            </button>
                            <button
                              type="button"
                              role="radio"
                              aria-checked={mapping.mode === 'column'}
                              onClick={() => setFieldMappings((m) => ({ ...m, [field]: { mode: 'column', csvColumn: mapping.csvColumn ?? '' } }))}
                              data-active={mapping.mode === 'column'}
                            >
                              {fromSheetLabel}
                            </button>
                          </div>
                          {mapping.mode === 'column' ? (
                            <div className="flex-1 min-w-0">
                              <CustomSelect
                                aria-label={`Column for ${field}`}
                                placeholder="Choose a column…"
                                value={mapping.csvColumn ?? ''}
                                onChange={(v) => setFieldMappings((m) => ({ ...m, [field]: { mode: 'column', csvColumn: v } }))}
                                options={inputMode === 'manifest' ? MANIFEST_FIELD_OPTIONS : rowHeaders.map((h) => ({ value: h, label: h }))}
                              />
                            </div>
                          ) : (
                            <input
                              type="text"
                              aria-label={`Value for ${field} on every label`}
                              value={staticValues[field] ?? ''}
                              onChange={(e) => setStaticValues((s) => ({ ...s, [field]: e.target.value }))}
                              placeholder="Type the value for every label"
                              className="field flex-1 min-w-0"
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
                <section className="card p-4 sm:p-5 space-y-4">
                  <SectionHeader
                    title="Same on every label"
                    detail="Values here print the same on every label."
                  />
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {staticFieldNames.filter((f) => f !== pasteField).map((f) => (
                      <div key={f}>
                        <label htmlFor={`${formId}-static-${f}`} className="field-label mb-1.5">{f}</label>
                        <input
                          id={`${formId}-static-${f}`}
                          type="text"
                          value={staticValues[f] ?? ''}
                          onChange={(e) => setStaticValues((s) => ({ ...s, [f]: e.target.value }))}
                          className="field"
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
                <section className="card p-4 sm:p-5 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <SectionHeader
                      title="Review"
                      detail="Check the label output before starting the run."
                    />
                    {labelCount > 0 ? (
                      <div className="flex items-center gap-2 text-sm">
                        <button
                          onClick={() => setPreviewIndex((i) => Math.max(0, i - 1))}
                          disabled={previewIndex === 0}
                          className="btn btn-secondary btn-sm"
                        >
                          Prev
                        </button>
                        <span className="text-zinc-400 tabular-nums">
                          Label {previewIndex + 1} / {labelCount}
                        </span>
                        <button
                          onClick={() => setPreviewIndex((i) => Math.min(labelCount - 1, i + 1))}
                          disabled={previewIndex >= labelCount - 1}
                          className="btn btn-secondary btn-sm"
                        >
                          Next
                        </button>
                      </div>
                    ) : (
                      <span className="text-sm text-zinc-500">Showing the design&apos;s sample text</span>
                    )}
                  </div>
                  <div className="rounded-lg bg-zinc-950 p-3 sm:p-4">
                    {format.type === 'sheet' ? (
                      // Sheets can't render via the ZPL WASM engine — show the
                      // actual sheet-grid layout so the user sees 10x20 /
                      // 8x11 / whatever their template actually is.
                      <LayoutPreview
                    thermalRenderMode={template.thermalRenderMode}
                        format={format}
                        elements={(previewTemplate ?? template).elements}
                        testData={previewValues}
                        testDataByLabel={sheetPreviewValues}
                        selectedLabelOffset={selectedSheetLabelOffset}
                      />
                    ) : (
                      <LocalZplPreview state={previewState} format={format} />
                    )}
                  </div>
                </section>
              )}

              {/* Save preset + print */}
              <section className="card p-4 sm:p-5 space-y-3">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={saveAsPresetName}
                    onChange={(e) => setSaveAsPresetName(e.target.value)}
                    placeholder="Save these settings as a preset"
                    className="field flex-1"
                  />
                  <button
                    onClick={handleSaveAsPreset}
                    disabled={!saveAsPresetName.trim() || !template}
                    className="btn btn-secondary"
                  >
                    <Save className="size-4" aria-hidden="true" /> Save
                  </button>
                </div>
                {hasData && template && <BlankValueCheck check={blankCheck} leaveBlank={leaveBlank} onLeaveBlankChange={setLeaveBlank} />}
                {format?.type === 'thermal' && (
                  <p className="text-xs text-amber-400">
                    {previewState.status === 'error'
                      ? 'Cannot start: correct the preview error above, then review again.'
                      : previewState.status === 'loading'
                        ? 'Rendering current label before starting…'
                        : previewState.status === 'empty'
                          ? 'Cannot start: no label output was generated. Check the design and data.'
                          : <span className="text-zinc-400">Fit and layout are checked for the label shown; other rows have not been validated for fit. Step through a few with Prev / Next.</span>}
                  </p>
                )}
              </section>
              <div className="fixed inset-x-0 bottom-0 z-30 border-t border-zinc-800 bg-zinc-950 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                <div className="mx-auto flex max-w-[1180px] flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-zinc-100 max-sm:hidden">
                      {name.trim() || 'Untitled run'}
                    </p>
                    <p className="truncate text-xs text-zinc-500 max-sm:hidden">
                      {template?.name || 'No design selected'} · {labelCount.toLocaleString()} label{labelCount === 1 ? '' : 's'}
                    </p>
                  </div>
                  <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                    {createRunError ? (
                      <p role="alert" className="flex items-start gap-1.5 text-xs text-red-400 sm:max-w-md">
                        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {createRunError}
                      </p>
                    ) : blockReason && !isCreatingRun ? (
                      <p role="status" className="flex items-start gap-1.5 text-xs text-amber-400 sm:max-w-md">
                        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {blockReason}
                      </p>
                    ) : null}
                    <button
                      onClick={handleSaveAndPrint}
                      disabled={!canCreate || !previewReady || isCreatingRun}
                      className="btn btn-primary w-full shrink-0 sm:w-auto"
                    >
                      <Play className="h-4 w-4" /> {isCreatingRun ? 'Starting…' : `Start run (${labelCount.toLocaleString()} label${labelCount === 1 ? '' : 's'})`}
                    </button>
                  </div>
                </div>
              </div>
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

function SectionHeader({
  title,
  detail,
}: {
  title: string;
  detail: string;
}) {
  return (
    <div className="min-w-0">
      <h2 className="text-base font-semibold text-zinc-100">{title}</h2>
      <p className="mt-0.5 text-sm text-zinc-400">{detail}</p>
    </div>
  );
}

// Inline ZPL preview via zpl-renderer-js WASM. Accepts the extra thermal
// fields needed to size the canvas for multi-across rolls plus an optional
// outlines overlay matching the designer + run detail page treatment.
function LocalZplPreview({ state, format, showOutlines = true }: { state: RunPreviewState; format: { width: number; height: number; dpi?: number; type: string; labelsAcross?: number; horizontalGapThermal?: number; sideMarginThermal?: number; linerWidth?: number }; showOutlines?: boolean }) {
  if (state.status === 'error') return <p role="alert" className="text-xs text-red-400">{state.message} Correct the field value or template layout, then review again.</p>;
  if (state.status === 'loading') return <p role="status" className="text-xs text-zinc-500">Rendering…</p>;
  if (state.status === 'empty') return <p className="text-xs text-zinc-500">No label output was generated. Check the template and data.</p>;
  // LabelOutlineOverlay needs the full LabelFormat shape; coerce the loose
  // format prop (which only guarantees thermal fields) for the overlay. Safe
  // because the overlay only reads those thermal fields.
  return (
    <div className="relative inline-block mx-auto">
      <img
        src={state.url}
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
