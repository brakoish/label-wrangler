'use client';

import { useState, useEffect, useMemo, useRef, Suspense, useCallback, useId } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Upload, Clipboard, Play, AlertCircle, FileSpreadsheet, Download, Plus, Pencil, Search, CheckCircle2, Circle, Eye, EyeOff, ChevronRight, RotateCcw } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { PageTitle } from '@/components/PageTitle';
import { IconSwap } from '@/components/motion/IconSwap';
import { CustomSelect } from '@/components/ui/CustomSelect';
import { SegmentedIndicator } from '@/components/ui/Segmented';
import { useFormatStore } from '@/lib/store';
import { ErrorState, StateActions } from '@/components/EmptyState';
import { useTemplateStore } from '@/lib/templateStore';
import { NewTemplateDialog } from '@/components/designer/TemplateList';
import { useRunStore } from '@/lib/runStore';
import { parseCsv, detectUrlColumn, type ParsedCsv } from '@/lib/csv';
import { dynamicFieldsForTemplate, staticFlippableElements } from '@/lib/runBuilder';
import { generateZPLWithImages } from '@/lib/zplGenerator';
import { blankLabelDataUrl, isNothingToDrawError, renderZplToDataUrl, thermalRenderGeometry } from '@/lib/zplRenderClient';
import { prepareRunPreview, type RunPreviewState } from '@/lib/runPreview';
import { RunImagePicker } from '@/components/runs/RunImagePicker';
import { applyRunImages, validateRunImages, type RunImageSelections } from '@/lib/runImages';
import { BlankSummary, ProblemList, blankHeading, type BlankChoice } from '@/components/checks/RunChecks';
import { BarcodeWarning, FixInDesignerLink } from '@/components/checks/BarcodeWarning';
import { LongValueWarning } from '@/components/checks/LongValueWarning';
import { isLongValueIssue, longLabelWords, longValueReason, longValueRows, type LongValueRows } from '@/components/checks/longValues';
import { barcodeTickLabel, barcodeWaitWords } from '@/lib/runBarcodeTicks';
import { blankCheckAllowsPrinting, blankLabelIndexes, checkRunData, rememberBlankChoice } from '@/lib/runDataCheck';
import { stopFixWords, LAYOUT_GO_AHEAD, barcodeIssueStops, barcodeVerdict, rememberPrintGoAhead, runLayoutIssues, runPrintCheck } from '@/lib/runLayoutCheck';
import { confirmDialog, toast } from '@/components/ui/feedback';
import { friendlyError, friendlyRenderError, isNetworkError, SEARCH_DETAILS_INCOMPLETE } from '@/lib/userMessages';
import { LabelOutlineOverlay } from '@/components/LabelOutlineOverlay';
import { LayoutPreview } from '@/components/designer/LayoutPreview';
import { MANIFEST_FIELD_OPTIONS, MANIFEST_FIELDS } from '@/lib/manifestFields';
import type { FieldMapping, RunDataSource, TemplateElement } from '@/lib/types';
import { contentModeUpdates } from '@/lib/elementBinding';
import { friendlyFieldName, nextFieldName, setSpreadsheetHeaderRow, setSpreadsheetRowMap } from '@/lib/fieldLabels';
import { sameValueRiskKey, sameValueRisks, scannableFieldNames, staticValuesForRun } from '@/lib/runFieldSetup';
import { checkRunBarcodes, describeBarcodeGroups } from '@/lib/barcodeCheck';
import { runBarcodeFixes } from '@/lib/runBarcodeFix';
import { labelsWords, missingDetailFields, missingDetailsWords, rowMissingDetails, runMissingDetails } from '@/lib/nabisDetails';
import { leaveFieldsOff } from '@/lib/runLeaveOff';
import { cleanHiddenCharacters, labelsWithBadCharacters } from '@/lib/runCharacterRows';
import { blankPreviewItems, type PreviewBlankBox } from '@/lib/runPreviewBlanks';
import { QR_SCAN_INCHES, type BarcodeAutoFix } from '@/lib/barcodeAutoFix';
import { EXAMPLE_CODE_VALUES } from '@/lib/sampleValues';
import { applyPlainNumbers, bestCodeColumn, codeFieldTypes, doubledCurrencyRisks, exampleCodeRisks, fieldNameForColumn, type CodeType } from '@/lib/runCodeColumns';
import { checkRunPrinterCharacters, summarizePrinterCharacterIssues } from '@/lib/printerCharacters';
import { EXCEL_SAVE_AS_CSV, isOleFile, isZipFile, readXlsx } from '@/lib/xlsx';
import { saveLastColumns } from '@/lib/lastColumns';
import { PopLayer, useDismiss } from '@/components/ui/PopLayer';
import { clearRunDraft, lastRunSource, readRunDraft, rememberRunSource, saveRunDraft, type RunDraft } from '@/lib/runDraft';

/** “Moved and resized the barcode”: what “Fix it for me” changes, in plain words. */
function runFixWords(before: TemplateElement, after: TemplateElement, ahead = false): string {
  if (before.type !== after.type) return `${ahead ? 'This swaps' : 'Swapped'} the barcode for a ${after.type === 'qr' ? 'QR code' : after.type}`;
  const done: string[] = [];
  if ((before.rotation || 0) !== (after.rotation || 0)) done.push(ahead ? 'turns' : 'turned');
  if (before.x !== after.x || before.y !== after.y) done.push(ahead ? 'moves' : 'moved');
  if (before.width !== after.width || before.height !== after.height) done.push(ahead ? 'resizes' : 'resized');
  const verbs = done.length ? andList(done) : ahead ? 'changes' : 'changed';
  return ahead ? `This ${verbs} the barcode` : `${verbs.charAt(0).toUpperCase()}${verbs.slice(1)} the barcode`;
}

/** “Strain, THC, CBD and Batch”: a plain list join for the wait reasons. */
function andList(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

const PASTE_COLUMN = '__paste__';
const NO_LONG_ROWS: LongValueRows = { indexes: [], fields: [], stops: false };

/** Open the design with the problem barcode selected, and come back here after. */
function designerFixHref(templateId: string, elementId?: string): string {
  return `/designer?id=${encodeURIComponent(templateId)}${elementId ? `&select=${encodeURIComponent(elementId)}` : ''}&returnTo=${encodeURIComponent('/runs/new')}`;
}

/**
 * Pasted lines, one label each. A first line that names the field it fills
 * ("SKU") is a heading, not a label; tab-separated lines are a table.
 */
function pastedValues(text: string, field: string | null): { values: string[]; heading: string; table: boolean } {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const table = lines.length > 1 && lines.slice(0, 5).filter((line) => line.includes('\t')).length >= 2;
  const simple = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
  const first = lines[0] ?? '';
  const heading = lines.length > 1 && field && (simple(first) === simple(field) || simple(first) === simple(friendlyFieldName(field))) ? first : '';
  return { values: heading ? lines.slice(1) : lines, heading, table };
}
const MANIFEST_HEADERS = [...MANIFEST_FIELDS];

/**
 * Whether row 1 looks like data or a title rather than column names (most
 * cells blank, numbers, dates, prices or long tags): only then is "Column
 * names aren't in row 1?" worth asking.
 */
function headingsLookLikeData(headers: ReadonlyArray<string>): boolean {
  if (!headers.length) return false;
  const valueLike = headers.filter((h) => !h.trim() || /^column \d+$/i.test(h.trim()) || /^[\d\s$€£.,:/%-]+$/.test(h.trim()) || /\d{5,}/.test(h) || h.trim().length > 40).length;
  return valueLike * 2 >= headers.length;
}

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

function findBestHeaderForField(field: string, headers: string[], rows: Record<string, string>[], codeType?: CodeType) {
  const normalizedField = normalizedFieldName(field);
  const exact = headers.find((h) => normalizedFieldName(h) === normalizedField);
  if (exact) return exact;
  // A barcode or QR code named "Barcode 1": the column that looks like its
  // codes (SKU, UPC, a package tag; a link for a QR code).
  if (codeType && /^(barcode|qr ?code|qr)\s*\d*$/i.test(field.trim())) return bestCodeColumn(codeType, headers, rows);

  if (/^qr\d*$/.test(normalizedField) && headers.includes('retailId')) return 'retailId';

  for (const alias of FIELD_ALIASES[normalizedField] ?? []) {
    if (headers.includes(alias)) return alias;
  }

  if (codeType) {
    const column = bestCodeColumn(codeType, headers, rows);
    if (column) return column;
  }
  const urlCol = detectUrlColumn({ headers, rows });
  const isQrField = codeType === 'qr' || /qr|url|link/i.test(field);
  if (isQrField && urlCol) return urlCol;

  return null;
}

function manifestPackageKey(row: ManifestRow) {
  return row.packageTag || row.tag || row.id || `${row.itemName}-${row.batch}`;
}

function shortRunDate(date = new Date()) {
  return `${date.getMonth() + 1}/${date.getDate()}/${String(date.getFullYear()).slice(-2)}`;
}

const SOURCES: ReadonlyArray<{ value: RunInputMode; label: string; Icon: typeof Pencil }> = [
  { value: 'manual', label: 'Type', Icon: Pencil },
  { value: 'paste', label: 'Paste', Icon: Clipboard },
  { value: 'csv', label: 'Spreadsheet', Icon: FileSpreadsheet },
  { value: 'manifest', label: 'Nabis', Icon: Search },
];

/**
 * Where the values come from: one choice of four, as a radio group that works
 * like every other segmented control (arrow keys, Home and End choose; Tab
 * enters and leaves). Each source keeps what was put in it, so moving away
 * and back loses nothing. On a narrow phone the four sit in two rows so no
 * label is squeezed.
 */
function SourceSwitch({ value, onChange }: { value: RunInputMode; onChange: (value: RunInputMode) => void }) {
  const active = Math.max(0, SOURCES.findIndex((s) => s.value === value));
  return (
    <div
      role="radiogroup"
      aria-label="Where the values come from"
      className="segmented source-switch w-full md:w-auto"
    >
      <SegmentedIndicator index={active} count={SOURCES.length} />
      {SOURCES.map(({ value: option, label, Icon }) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={option === value}
          data-active={option === value}
          onClick={() => onChange(option)}
        >
          <Icon className="hidden size-4 sm:block" aria-hidden="true" /> {label}
        </button>
      ))}
    </div>
  );
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

  const { templates, addTemplate, updateElementLocal, saveTemplate, updateTemplate } = useTemplateStore();
  const templatesLoadError = useTemplateStore((state) => state.error);
  const templatesHydrated = useTemplateStore((state) => state.hydrated);
  const { formats, getFormatById } = useFormatStore();
  const formatsLoadError = useFormatStore((state) => state.error);
  const templatesRetrying = useTemplateStore((state) => state.loading);
  const formatsRetrying = useFormatStore((state) => state.loading);
  // Nothing to pick from: the page says so in the shared error state, under
  // its title, with one Try again for everything that failed.
  const libraryFailed = (templates.length === 0 && !!templatesLoadError) || (formats.length === 0 && !!formatsLoadError);
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
  const [inputMode, setInputMode] = useState<RunInputMode>('csv');
  const [pasteText, setPasteText] = useState('');
  const [pasteField, setPasteField] = useState<string | null>(null);
  // Type mode marks an empty field only after it was left empty, not on arrival.
  const [touchedManual, setTouchedManual] = useState<ReadonlySet<string>>(() => new Set());
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<Record<string, string>[]>([]);
  // The digits behind numbers Excel formats ("$1,234.50" -> "1234.50"),
  // only where they differ; barcodes and QR codes print these.
  const [csvPlainRows, setCsvPlainRows] = useState<Record<string, string>[] | null>(null);
  // Fields the person switched to the plain number (the design adds its own "$").
  const [plainNumberFields, setPlainNumberFields] = useState<string[]>([]);
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
    // A preset or a re-run starts as it always has (Type, unless the copied
    // run says otherwise below).
    if (presetId || duplicateFrom) { setInputMode('manual'); return; }
    if (sourceParam === 'manifest' || sourceParam === 'csv' || sourceParam === 'paste' || sourceParam === 'manual') {
      setInputMode(sourceParam);
    } else {
      // No link asked for one: start where the last run started (a
      // spreadsheet the first time). A kept draft or a preset sets its own.
      setInputMode(lastRunSource());
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
          setCsvPlainRows(null);
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
  const format = template ? getFormatById(template.formatId) : null;
  const allDynamicFields = useMemo(() => (template ? dynamicFieldsForTemplate(template) : []), [template]);
  const codeTypes = useMemo(() => codeFieldTypes(template), [template]);
  const hiddenRunFieldSet = useMemo(() => new Set(hiddenRunFields), [hiddenRunFields]);

  const manifestSelectedRows = useMemo(() => {
    if (manifestRows === savedManifestRows) return manifestRows;
    if (!selectedManifestPackageKey) return [];
    return manifestRows.filter((row) => manifestPackageKey(row) === selectedManifestPackageKey);
  }, [manifestRows, selectedManifestPackageKey, savedManifestRows]);

  // A Nabis search cut short (time limit, or Metrc busy) leaves rows without
  // their retail IDs or lab potency: Start waits until the person searches
  // again or ticks to leave those parts off (named), so neither the sample
  // nor a blank prints in their place.
  const nabisGap = useMemo(() => {
    if (inputMode !== 'manifest') return { labels: [], missing: [], signature: '' };
    const mappings = Object.fromEntries(Object.entries(fieldMappings).filter(([field]) => allDynamicFields.includes(field) && !hiddenRunFieldSet.has(field)));
    return runMissingDetails(manifestSelectedRows, mappings);
  }, [inputMode, fieldMappings, allDynamicFields, hiddenRunFieldSet, manifestSelectedRows]);
  const nabisGapFields = useMemo(() => {
    if (!nabisGap.labels.length) return [];
    const mappings = Object.fromEntries(Object.entries(fieldMappings).filter(([field]) => allDynamicFields.includes(field) && !hiddenRunFieldSet.has(field)));
    return missingDetailFields(manifestSelectedRows, mappings, nabisGap.labels);
  }, [nabisGap, fieldMappings, allDynamicFields, hiddenRunFieldSet, manifestSelectedRows]);
  const [nabisGapOkKey, setNabisGapOkKey] = useState('');
  const nabisTicked = nabisGap.labels.length > 0 && nabisGapOkKey === nabisGap.signature;
  const nabisOk = !nabisGap.labels.length || nabisTicked;
  const nabisGapWhat = missingDetailsWords(nabisGap.missing);

  // Parts left off this run: picked by the person, or left off by the Nabis
  // tick above. They are not filled, checked or drawn, and the run's saved
  // design leaves them out, so nothing prints there.
  // Keyed by the names, not the array: the Nabis auto-mapping effect re-runs
  // whenever dynamicFields changes identity, so it must only change with them.
  const leftOffKey = Array.from(new Set([...hiddenRunFields, ...(nabisTicked ? nabisGapFields : [])].filter((field) => allDynamicFields.includes(field)))).sort().join('\n');
  const leftOffFields = useMemo(() => new Set(leftOffKey ? leftOffKey.split('\n') : []), [leftOffKey]);
  const dynamicFields = useMemo(
    () => allDynamicFields.filter((field) => !leftOffFields.has(field)),
    [allDynamicFields, leftOffFields],
  );
  const visibleTemplate = useMemo(() => (template ? leaveFieldsOff(template, leftOffFields) : null), [template, leftOffFields]);
  const previewTemplate = useMemo(() => visibleTemplate ? applyRunImages(visibleTemplate, Object.fromEntries(Object.entries(imageSelections).filter(([id]) => visibleTemplate.elements.some(e => e.id === id && e.type === 'image' && e.runSelectable)))) : null, [visibleTemplate, imageSelections]);
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
  const flippable = useMemo(() => {
    if (!template) return [];
    // Suggest plain names ("Barcode 1") rather than "barcode_1".
    const named: { fieldName?: string }[] = template.elements.filter((el) => el.fieldName?.trim());
    return staticFlippableElements(template).map((f) => {
      const suggestedName = nextFieldName(f.type, named);
      named.push({ fieldName: suggestedName });
      return { ...f, suggestedName };
    });
  }, [template]);

  useEffect(() => {
    setHiddenRunFields((prev) => prev.filter((field) => allDynamicFields.includes(field)));
  }, [allDynamicFields]);

  const toggleRunFieldVisibility = (field: string) => {
    setHiddenRunFields((prev) => (
      prev.includes(field) ? prev.filter((f) => f !== field) : [...prev, field]
    ));
  };
  // Parts just left off from the "No column for…" notice: said in the same
  // spot with Put it back, so one click never quietly drops a code.
  const [justLeftOff, setJustLeftOff] = useState<string[]>([]);
  const leaveOffFromNotice = (field: string) => {
    setHiddenRunFields((prev) => (prev.includes(field) ? prev : [...prev, field]));
    setJustLeftOff((prev) => (prev.includes(field) ? prev : [...prev, field]));
  };
  const putBack = (fields: string[]) => {
    setHiddenRunFields((prev) => prev.filter((f) => !fields.includes(f)));
    setJustLeftOff((prev) => prev.filter((f) => !fields.includes(f)));
  };
  // A QR code or barcode is the part most likely to be required on the label.
  const codeKind = (field: string) => {
    const el = template?.elements.find((e) => e.fieldName === field && !e.isStatic);
    return el?.type === 'qr' ? 'QR code' : el?.type === 'barcode' ? 'barcode' : null;
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
    const named: { fieldName?: string }[] = template.elements.filter((el) => el.fieldName?.trim());
    setNamingFields(true); setNamingError(null);
    try {
      for (const el of unnamedDynamic) {
        // A plain, unique name such as "Barcode 1" that also works as a
        // spreadsheet heading.
        const candidate = nextFieldName(el.type, named);
        named.push({ fieldName: candidate });
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
        const match = findBestHeaderForField(field, headers, rows, codeTypes[field]);
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
    // Static values are never copied from the data (row 1 used to be
    // pre-filled, which printed one SKU barcode on every label). A "Same on
    // every label" value comes from the person typing it.
  }, [codeTypes, dynamicFields, template]);

  const [fileError, setFileError] = useState<string | null>(null);
  const [csvFileName, setCsvFileName] = useState('');
  // Where the headings were found, and the file, so the person can say
  // "my headings are in row 3" and read it again.
  // The header-row box shows itself only when detection needed help; otherwise it waits behind a quiet question.
  const [headerRowAsked, setHeaderRowAsked] = useState(false);
  const [fileInfo, setFileInfo] = useState<{ headerRow: number; titleSkipped: boolean; sheetName?: string; sheetCount?: number; sheetNames?: string[]; sheetIndex?: number } | null>(null);
  const lastFile = useRef<File | null>(null);
  useEffect(() => () => setSpreadsheetHeaderRow(1), []);
  const handleFile = async (file: File, headerRow?: number, sheet?: number) => {
    setFileError(null);
    let parsed: ParsedCsv;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (isZipFile(bytes)) {
        // An Excel workbook. Read its first sheet; if that fails, say how to
        // make a CSV instead of showing the zip's bytes as "columns".
        // With no sheet picked, the sheet whose headings match the design's fields.
        try { parsed = await readXlsx(bytes, { headerRow, sheet, preferHeaders: sheet === undefined ? dynamicFields : undefined }); } catch { setFileError(EXCEL_SAVE_AS_CSV); return; }
        if (!parsed.headers.length && (parsed.sheetNames?.length ?? 1) > 1 && sheet !== undefined) {
          // A picked sheet with nothing on it: say so, and keep the sheet list to pick another.
          setFileInfo((info) => (info ? { ...info, sheetIndex: sheet } : info));
          setFileError(`The sheet ‘${parsed.sheetName ?? ''}’ is empty. Pick another sheet.`);
          return;
        }
        if (!parsed.headers.length) { setFileError('This Excel file has nothing in it. Put the headings in row 1, then upload it again.'); return; }
      } else if (isOleFile(bytes)) {
        setFileError('This is an older Excel file (.xls). In Excel choose File > Save As > CSV, then upload that.');
        return;
      } else {
        const text = new TextDecoder().decode(bytes);
        if (text.slice(0, 4096).includes('\u0000')) { setFileError('This file isn’t a spreadsheet. Upload a CSV or Excel (.xlsx) file.'); return; }
        parsed = parseCsv(text, { headerRow });
      }
    } catch {
      setFileError('We couldn’t read that file. Save it again as CSV, then upload it.');
      return;
    }
    lastFile.current = file;
    setCsvFileName(file.name);
    setFileInfo({ headerRow: parsed.headerRow ?? 1, titleSkipped: !!parsed.titleSkipped, sheetName: parsed.sheetName, sheetCount: parsed.sheetCount, sheetNames: parsed.sheetNames, sheetIndex: parsed.sheetIndex });
    setSpreadsheetHeaderRow(parsed.headerRow ?? 1);
    // The designer offers these headings as a list ("Spreadsheet column").
    saveLastColumns(typeof window === 'undefined' ? null : window.localStorage, parsed.headers, file.name);
    setCsvHeaders(parsed.headers);
    setCsvRows(parsed.rows);
    setCsvPlainRows(parsed.plainRows ?? null);
    setPlainNumberFields([]);
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
      if (!res.ok) throw new Error(data.error || 'Couldn’t search Nabis');
      const rows = Array.isArray(data.packages) ? data.packages as ManifestRow[] : [];
      setManifestRows(rows);
      setSelectedManifestPackageKey(rows[0] ? manifestPackageKey(rows[0]) : null);
      setPreviewIndex(0);
      applyAutoColumnMapping(MANIFEST_HEADERS, rows);
      if (data.error) setManifestError(data.error);
      else if (data.detailsIncomplete) setManifestError(SEARCH_DETAILS_INCOMPLETE);
    } catch (error) {
      setManifestError(error instanceof Error ? error.message : 'Couldn’t search Nabis');
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
    // Prefer the first barcode, then a tag or code field, then a QR code,
    // else the first field: pasted lists are usually package tags.
    const types = codeFieldTypes(template);
    const pick = dynamicFields.find((f) => types[f] === 'barcode')
      ?? dynamicFields.find((f) => /\btag\b|barcode|uid|package/i.test(f))
      ?? dynamicFields.find((f) => types[f] === 'qr')
      ?? dynamicFields.find((f) => /qr|url|code/i.test(f));
    setPasteField(pick ?? dynamicFields[0] ?? null);
  }, [template, dynamicFields, pasteField]);

  // Compute the effective sourceData based on input mode. New runs always use
  // row objects so manual/paste/CSV/Manifest can feed the same downstream shape.
  const sourceData = useMemo<Record<string, string>[]>(() => {
    if (inputMode === 'manual') {
      return Array.from({ length: Math.max(1, manualQty) }, () => ({ ...visibleStaticValues }));
    }
    if (inputMode === 'paste') {
      return pastedValues(pasteText, pasteField).values.map((value) => ({ [PASTE_COLUMN]: value }));
    }
    if (inputMode === 'manifest') {
      return manifestSelectedRows;
    }
    return csvRows;
  }, [inputMode, pasteText, pasteField, csvRows, manifestSelectedRows, manualQty, visibleStaticValues]);
  const pasteInfo = useMemo(() => pastedValues(pasteText, pasteField), [pasteText, pasteField]);
  // A table copied from Excel (tab-separated): read it like an uploaded file.
  const usePasteAsSpreadsheet = () => {
    const parsed = parseCsv(pasteText.split(/\r?\n/).map((line) => line.split('\t').map((cell) => /[",]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell).join(',')).join('\n'));
    if (!parsed.headers.length) return;
    lastFile.current = null;
    setCsvFileName('Pasted table');
    setFileInfo({ headerRow: parsed.headerRow ?? 1, titleSkipped: !!parsed.titleSkipped });
    setSpreadsheetHeaderRow(parsed.headerRow ?? 1);
    setCsvHeaders(parsed.headers);
    setCsvRows(parsed.rows);
    setCsvPlainRows(null);
    applyAutoColumnMapping(parsed.headers, parsed.rows, true);
    setInputMode('csv');
  };

  // What each field really reads from a spreadsheet: barcodes and QR codes
  // (and fields switched to the plain number) read the digits behind a
  // formatted cell, not "$1,234.50", through a "(plain number)" copy of the
  // column. Text mapped to the same column keeps what Excel shows.
  const plainData = useMemo(() => {
    if (inputMode !== 'csv') return { rows: sourceData, mappings: fieldMappings };
    const plainFields = new Set([...Object.keys(codeTypes), ...plainNumberFields]);
    return applyPlainNumbers({ rows: sourceData, plainRows: csvPlainRows, mappings: fieldMappings, plainFields, currencyFields: new Set(plainNumberFields) });
  }, [inputMode, sourceData, fieldMappings, codeTypes, plainNumberFields, csvPlainRows]);
  // Tabs and invisible characters in the cells never print: taken out, and said so.
  const hiddenClean = useMemo(() => (inputMode === 'manual' ? { rows: plainData.rows, fixes: [] } : cleanHiddenCharacters(plainData.rows, plainData.mappings)), [inputMode, plainData]);
  const allDataRows = hiddenClean.rows;
  const dataMappings = plainData.mappings;

  // The run's data as the checks see it (hidden fields included: they would
  // print the design's sample text), for any set of rows.
  const checkDataFor = useCallback((rowsIn: Record<string, string>[]) => {
    let mappings: Record<string, FieldMapping> = dataMappings;
    let rows: Record<string, string>[] = rowsIn;
    if (inputMode === 'manual') {
      mappings = Object.fromEntries(dynamicFields.map((f) => [f, { mode: 'static' } as FieldMapping]));
      rows = Array.from({ length: Math.max(1, manualQty) }, () => ({}));
    } else if (inputMode === 'paste' && pasteField) {
      mappings = { ...fieldMappings, [pasteField]: { mode: 'column', csvColumn: PASTE_COLUMN } };
    }
    mappings = Object.fromEntries(Object.entries(mappings).filter(([field]) => visibleFieldSet.has(field)));
    // Only "Same on every label" fields keep a typed value (what Start saves).
    return { sourceData: rows, fieldMappings: mappings, staticValues: staticValuesForRun(dynamicFields, mappings, visibleStaticValues), mappedField: inputMode === 'paste' ? pasteField : null };
  }, [fieldMappings, dataMappings, inputMode, dynamicFields, manualQty, pasteField, visibleFieldSet, visibleStaticValues]);

  // Blank cells, over every row: one blank in 2,000 rows must not hold back
  // the other 1,999, so the person can leave those labels out, or (where the
  // design really prints blank) print them blank.
  const checkTemplate = previewTemplate ?? visibleTemplate;
  const allCheckData = useMemo(() => checkDataFor(allDataRows), [checkDataFor, allDataRows]);
  const blankCheck = useMemo(() => checkRunData(checkTemplate ?? { elements: [] }, allCheckData), [checkTemplate, allCheckData]);
  const skippable = useMemo(() => (inputMode === 'manual' ? null : blankLabelIndexes(checkTemplate ?? { elements: [] }, allCheckData, blankCheck)), [inputMode, checkTemplate, allCheckData, blankCheck]);
  const [blankChoice, setBlankChoiceState] = useState<{ choice: BlankChoice; signature: string }>({ choice: '', signature: '' });
  const blankChoiceNow: BlankChoice = blankChoice.signature === blankCheck.signature ? blankChoice.choice : '';
  const setBlankChoice = (choice: BlankChoice) => setBlankChoiceState({ choice, signature: blankCheck.signature });
  const skipRows = blankChoiceNow === 'skip' && !!skippable;
  const leaveBlank = blankChoiceNow === 'blank' && blankCheck.canLeaveBlank;
  // The rows the run is made from: every row, or every row but the blank ones.
  // Labels whose spreadsheet values can't print (é in a barcode, an emoji in
  // the printer's font): they can be left out too, like blank rows.
  const charFromSheet = useCallback((field: string) => allCheckData.fieldMappings[field]?.mode === 'column', [allCheckData]);
  const charBadIndexes = useMemo(() => (inputMode === 'manual' || !checkTemplate ? [] : labelsWithBadCharacters(checkTemplate, format, allCheckData, charFromSheet)), [inputMode, checkTemplate, format, allCheckData, charFromSheet]);
  // The two kinds apart, so each list's button leaves out only its own labels.
  const charBadBarcodeIndexes = useMemo(() => (inputMode === 'manual' || !checkTemplate ? [] : labelsWithBadCharacters(checkTemplate, format, allCheckData, charFromSheet, 'barcode')), [inputMode, checkTemplate, format, allCheckData, charFromSheet]);
  const charBadTextIndexes = useMemo(() => (inputMode === 'manual' || !checkTemplate ? [] : labelsWithBadCharacters(checkTemplate, format, allCheckData, charFromSheet, 'text')), [inputMode, checkTemplate, format, allCheckData, charFromSheet]);
  const charBadKey = charBadIndexes.join(',');
  const charSkippable = charBadIndexes.length > 0 && charBadIndexes.length < allDataRows.length;
  const [charSkip, setCharSkip] = useState<{ key: string; indexes: number[] }>({ key: '', indexes: [] });
  const charSkipped = useMemo(() => (charSkippable && charSkip.key === charBadKey ? charSkip.indexes : []), [charSkippable, charSkip, charBadKey]);
  const skipChars = charSkipped.length > 0;
  const leaveCharsOut = (indexes: ReadonlyArray<number>) => setCharSkip({ key: charBadKey, indexes: Array.from(new Set([...charSkipped, ...indexes])).sort((a, b) => a - b) });
  // A value too long for its barcode on some labels only (one long SKU): a
  // problem with those rows, so they can be left out too, like blank rows.
  const longRows = useMemo<LongValueRows>(() => (inputMode === 'manual' || !checkTemplate ? NO_LONG_ROWS : longValueRows(checkTemplate, format, allCheckData, charFromSheet)), [inputMode, checkTemplate, format, allCheckData, charFromSheet]);
  const longKey = longRows.indexes.join(',');
  const [longSkip, setLongSkip] = useState<{ key: string; indexes: number[] }>({ key: '', indexes: [] });
  const longSkipped = useMemo(() => (longKey && longSkip.key === longKey ? longSkip.indexes : []), [longKey, longSkip]);
  const keptRows = useMemo(() => {
    const skip = new Set<number>([...(skipRows && skippable ? skippable : []), ...charSkipped, ...longSkipped]);
    if (!skip.size) return null;
    return allDataRows.map((_, index) => index).filter((index) => !skip.has(index));
  }, [skipRows, skippable, charSkipped, longSkipped, allDataRows]);
  const dataRows = useMemo(() => (keptRows ? keptRows.map((index) => allDataRows[index]) : allDataRows), [keptRows, allDataRows]);
  // Row numbers in every message stay the ones in the file.
  useEffect(() => { setSpreadsheetRowMap(keptRows); }, [keptRows]);
  useEffect(() => () => setSpreadsheetRowMap(null), []);
  const labelCount = inputMode === 'manual' ? Math.max(1, manualQty) : dataRows.length;
  // The spreadsheet row a label (0-based, in this run) comes from.
  const sheetRowOf = (index: number) => (keptRows ? keptRows[index] ?? index : index) + 1 + (fileInfo?.headerRow ?? 1);

  const manifestPackageSummaries = useMemo(() => {
    const packages = new Map<string, { row: ManifestRow; labelRows: number; missing: boolean }>();
    for (const row of manifestRows) {
      const key = manifestPackageKey(row);
      const missing = rowMissingDetails(row).length > 0;
      const existing = packages.get(key);
      if (existing) {
        existing.labelRows += 1;
        existing.missing ||= missing;
        continue;
      }
      packages.set(key, { row, labelRows: 1, missing });
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
    const row = dataRows[index];

    if (row && typeof row === 'object' && !Array.isArray(row)) {
      for (const [field, mapping] of Object.entries(dataMappings)) {
        if (!visibleFieldSet.has(field)) continue;
        if (mapping.mode === 'column' && mapping.csvColumn) {
          values[field] = (row as Record<string, string>)[mapping.csvColumn] ?? '';
        }
      }
    }
    return values;
  }, [visibleStaticValues, dataRows, dataMappings, visibleFieldSet]);

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
  // Rolls with two or more across print a pair (labels 1+2, 3+4…) on each
  // feed: show the pair the printer really prints, not one label twice.
  const across = format?.type === 'thermal' ? Math.max(1, format.labelsAcross || 1) : 1;
  const feedStart = Math.floor(previewIndex / across) * across;
  const previewLanes = useMemo<Record<string, string> | Array<Record<string, string> | null>>(() => {
    if (across === 1 || labelCount === 0) return previewValues;
    return Array.from({ length: across }, (_, lane) => (feedStart + lane < labelCount ? previewValuesForIndex(feedStart + lane) : null));
  }, [across, labelCount, previewValues, feedStart, previewValuesForIndex]);
  useEffect(() => { if (labelCount > 0 && previewIndex > labelCount - 1) setPreviewIndex(Math.max(0, labelCount - 1)); }, [labelCount, previewIndex]);
  // A part with no value is drawn empty (marked), never as the design's sample.
  const previewBlanks = useMemo(() => {
    const base = previewTemplate ?? visibleTemplate;
    if (!base || !(inputMode === 'manual' || labelCount > 0)) return { template: base, emptyFields: [] as string[], boxes: [] as PreviewBlankBox[] };
    const shown = format?.type === 'sheet' ? (sheetPreviewValues ?? [previewValues]) : Array.isArray(previewLanes) ? previewLanes : [previewLanes];
    return blankPreviewItems(base, shown, dynamicFields);
  }, [previewTemplate, visibleTemplate, inputMode, labelCount, format, sheetPreviewValues, previewValues, previewLanes, dynamicFields]);

  const rowHeaders = inputMode === 'manifest' ? MANIFEST_HEADERS : csvHeaders;

  // The exact data the run will be created with.
  const runDataForCheck = useMemo(() => checkDataFor(dataRows), [checkDataFor, dataRows]);
  const hasData = inputMode === 'manual' || labelCount > 0;
  const blanksOk = !hasData || skipRows || blankCheckAllowsPrinting(blankCheck, leaveBlank);

  // A field set to "Same on every label" while the spreadsheet has a column
  // for it that changes per row: one SKU barcode on every label is almost
  // always a mistake, so Start waits for an explicit "yes, the same".
  const [lastColumns, setLastColumns] = useState<Record<string, string>>({});
  const sameRisks = useMemo(() => {
    if (!template || (inputMode !== 'csv' && inputMode !== 'manifest') || sourceData.length < 2) return [];
    const headers = inputMode === 'manifest' ? MANIFEST_HEADERS : csvHeaders;
    const candidateColumns = Object.fromEntries(dynamicFields.map((f) => [f, (lastColumns[f] && headers.includes(lastColumns[f]) ? lastColumns[f] : null) ?? findBestHeaderForField(f, headers, sourceData, codeTypes[f])]));
    return sameValueRisks({ fields: dynamicFields, mappings: fieldMappings, staticValues: visibleStaticValues, candidateColumns, rows: sourceData, scannableFields: scannableFieldNames(template) });
  }, [template, inputMode, sourceData, csvHeaders, dynamicFields, lastColumns, fieldMappings, visibleStaticValues, codeTypes]);
  const sameRiskKey = sameValueRiskKey(sameRisks);
  const [sameConfirmedKey, setSameConfirmedKey] = useState('');
  const sameOk = !sameRisks.length || sameConfirmedKey === sameRiskKey;
  // A field the person deliberately set to "Same on every label" is explained
  // in its own row; don't also call it unmatched at the top.
  const unmatchedShown = unmatchedCsvFields.filter((f) => !sameRisks.some((r) => r.field === f));

  // A barcode or QR code fixed to the design's example value (or next to a
  // column of real codes) would print the same code on every label: Start
  // waits until it changes per label or the person says that's right.
  const rowsBacked = inputMode === 'csv' || inputMode === 'manifest';
  const exampleRisks = useMemo(() => exampleCodeRisks(template, rowsBacked ? (inputMode === 'manifest' ? MANIFEST_HEADERS : csvHeaders) : [], rowsBacked ? sourceData : []), [template, rowsBacked, inputMode, csvHeaders, sourceData]);
  // The design's own example ("https://example.com", "123456789") is not a
  // value: it is never confirmed as "the same on every label". The person
  // types the real one (or makes it change per label) before it can print.
  const placeholderRisks = exampleRisks.filter((r) => r.isExample);
  const confirmRisks = exampleRisks.filter((r) => !r.isExample);
  const exampleKey = confirmRisks.map((r) => `${r.elementId}:${r.value}:${r.column ?? ''}`).join('|');
  const [exampleConfirmedKey, setExampleConfirmedKey] = useState('');
  const examplesOk = !placeholderRisks.length && (!confirmRisks.length || exampleConfirmedKey === exampleKey);
  const [realValues, setRealValues] = useState<Record<string, string>>({});
  const [realSaving, setRealSaving] = useState<string | null>(null);
  const [realNote, setRealNote] = useState<{ elementId: string; tone: 'ok' | 'error'; text: string } | null>(null);
  const saveRealValue = async (elementId: string) => {
    const value = (realValues[elementId] ?? '').trim();
    const el = template?.elements.find((e) => e.id === elementId);
    if (!template || !el || !value || realSaving) return;
    const kind = el.type === 'qr' ? 'QR code' : 'barcode';
    setRealSaving(elementId);
    setRealNote(null);
    updateElementLocal(template.id, elementId, { content: value });
    try {
      await saveTemplate(template.id);
      setRealNote({ elementId, tone: 'ok', text: 'Saved to the design.' });
    } catch {
      setRealNote({ elementId, tone: 'error', text: `The ${kind} shows it on this page, but the design couldn’t be saved. Check your connection, then try again.` });
    } finally {
      setRealSaving(null);
    }
  };
  const [flipNote, setFlipNote] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [flipping, setFlipping] = useState<string | null>(null);
  const flipToPerLabel = async (elementId: string, suggestedName: string) => {
    if (!template) return;
    const current = template.elements.find((el) => el.id === elementId);
    if (!current || (current.type !== 'barcode' && current.type !== 'qr')) return;
    const kind = current.type === 'qr' ? 'QR code' : 'barcode';
    const headers = inputMode === 'manifest' ? MANIFEST_HEADERS : csvHeaders;
    const column = rowsBacked ? bestCodeColumn(current.type, headers, sourceData) : null;
    const taken = template.elements.map((el) => el.fieldName ?? '').filter(Boolean);
    const fieldName = fieldNameForColumn(column && inputMode === 'manifest' ? friendlyFieldName(column) : column, suggestedName, taken);
    setFlipping(elementId);
    setFlipNote(null);
    updateElementLocal(template.id, elementId, contentModeUpdates({ ...current, fieldName: '' }, false, () => fieldName));
    setFieldMappings((m) => ({ ...m, [fieldName]: rowsBacked ? { mode: 'column', csvColumn: column ?? '' } : { mode: 'static' } }));
    try {
      await saveTemplate(template.id);
      setFlipNote({
        tone: 'ok',
        text: column
          ? `The ${kind} now changes per label, from your “${inputMode === 'manifest' ? friendlyFieldName(column) : column}” ${inputMode === 'manifest' ? 'Nabis detail' : 'column'}. This is saved to the design.`
          : rowsBacked
            ? `The ${kind} now changes per label. Choose its ${inputMode === 'manifest' ? 'Nabis detail' : 'column'} under “${friendlyFieldName(fieldName)}” below. This is saved to the design.`
            : `The ${kind} now changes per label. Fill in “${friendlyFieldName(fieldName)}” below. This is saved to the design.`,
      });
    } catch {
      setFlipNote({ tone: 'error', text: `The ${kind} changes per label on this page, but the design couldn’t be saved. Check your connection, then open the design and save it.` });
    } finally {
      setFlipping(null);
    }
  };

  // The design adds "$" in front of a column that already starts with "$".
  const currencyRisks = useMemo(() => (inputMode === 'csv' ? doubledCurrencyRisks(template, fieldMappings, sourceData, csvPlainRows).filter((r) => visibleFieldSet.has(r.field) && !plainNumberFields.includes(r.field)) : []), [inputMode, template, fieldMappings, sourceData, csvPlainRows, visibleFieldSet, plainNumberFields]);

  // Every barcode value must be one its barcode type can hold; checked for
  // every label, so label 10 can't stop a run part-way.
  const barcodeCheck = useMemo(() => (checkTemplate && hasData ? checkRunBarcodes(checkTemplate, runDataForCheck, format) : { issues: [], badLabels: 0, warnings: [], checkedLabels: 0, fitCounts: {} }), [checkTemplate, hasData, runDataForCheck, format]);
  // A barcode value the renderer can't draw (é in a Code 128) would leave no
  // picture at all: draw the rest of the label, with a striped box where
  // that barcode goes, so the rest can still be checked. Picture only.
  const undrawn = useMemo(() => {
    const base = previewBlanks.template;
    if (!base || format?.type !== 'thermal') return null;
    // Also any barcode the exact renderer refuses (too long for its box): the
    // problem is said once, under the picture, never again as a red error here.
    const hits = barcodeCheck.issues.filter((issue) => ((issue.kind === 'characters' && !issue.fit?.printable) || barcodeIssueStops(issue, format)) && !!issue.elementId && (issue.label === 0 || (issue.label > feedStart && issue.label <= feedStart + across)));
    if (!hits.length) return null;
    const ids = new Set(hits.map((issue) => issue.elementId as string));
    const boxes: PreviewBlankBox[] = [];
    for (const issue of hits) {
      const el = base.elements.find((e) => e.id === issue.elementId);
      if (!el || ((Math.round(el.rotation || 0) % 360) + 360) % 360 !== 0) continue;
      // A fixed barcode (label 0) is the same on every label of the feed.
      const lanes = issue.label === 0 ? Array.from({ length: across }, (_, lane) => lane) : [issue.label - 1 - feedStart];
      for (const lane of lanes) if (!boxes.some((b) => b.lane === lane && b.x === el.x && b.y === el.y)) boxes.push({ lane, x: el.x, y: el.y, width: el.width, height: Math.max(1, el.height) });
    }
    return { template: { ...base, elements: base.elements.filter((el) => !ids.has(el.id)) }, boxes };
  }, [previewBlanks.template, format, barcodeCheck.issues, feedStart, across]);
  const previewInput = useMemo(() => ({ template: previewBlanks.template, format, values: previewLanes, blanked: previewBlanks.emptyFields.length > 0, undrawn }), [previewBlanks.template, previewBlanks.emptyFields.length, format, previewLanes, undrawn]);
  const [previewResult, setPreviewResult] = useState<{ input: typeof previewInput; state: RunPreviewState; undrawn: boolean } | null>(null);
  const previewState: RunPreviewState = previewResult?.input === previewInput
    ? previewResult.state
    : { status: 'loading' };
  const previewUndrawn = previewResult?.input === previewInput && previewResult.undrawn && previewState.status === 'ready' ? undrawn : null;
  useEffect(() => {
    if (!previewInput.template || !previewInput.format || previewInput.format.type !== 'thermal') return;
    const { template, format, values, blanked, undrawn } = previewInput;
    let fellBack = false;
    const fallback = async (error: unknown): Promise<string> => {
      if (!undrawn || fellBack) throw error;
      fellBack = true;
      const zpl = await generateZPLWithImages(undrawn.template, format, values).catch(() => { throw error; });
      return renderZplToDataUrl(zpl, format).catch((again) => {
        if (isNothingToDrawError(again)) return blankLabelDataUrl(format);
        throw error;
      });
    };
    let early: string | null = null;
    return prepareRunPreview(
      // Exact-picture designs refuse such a value while making the picture.
      () => generateZPLWithImages(template, format, values).catch(async (error) => { early = await fallback(error); return 'drawn'; }),
      // Nothing typed yet: every part is left out of the picture, so draw the
      // plain label with its striped empty parts, not the renderer's refusal.
      (zpl) => (early !== null ? Promise.resolve(early) : renderZplToDataUrl(zpl, format).catch((error) => {
        if (blanked && isNothingToDrawError(error)) return blankLabelDataUrl(format);
        return fallback(error);
      })),
      (state) => setPreviewResult({ input: previewInput, state, undrawn: fellBack }),
    );
  }, [previewInput]);
  const previewReady = format?.type !== 'thermal' || previewState.status === 'ready';
  // A barcode the printer would cut off is shown first, in red, with its
  // fix; going ahead takes an explicit tick (the verdict emulates the
  // printer, and these designs may be printing today). Only what the exact
  // renderer refuses stops the run: nothing could print.
  const fieldIsFromSheet = (field: string) => inputMode === 'csv' && runDataForCheck.fieldMappings[field]?.mode === 'column';
  // A value too long on some labels only is said apart, as a problem with
  // those rows (leave them out, or fix the file); the rest are the design's.
  const designIssues = useMemo(() => barcodeCheck.issues.filter((issue) => !isLongValueIssue(issue, longRows)), [barcodeCheck.issues, longRows]);
  const longIssues = barcodeCheck.issues.length > designIssues.length;
  const barcodeWords = barcodeVerdict(designIssues, barcodeCheck.badLabels, format, fieldIsFromSheet);
  const barcodeKey = useMemo(() => designIssues.map((issue) => `${issue.field}|${issue.label}|${issue.kind}|${issue.fit?.reason ?? ''}`).join('\n'), [designIssues]);
  // One plain sentence and one "Print anyway" tick per problem, as on the run page.
  const barcodeItems = useMemo(() => describeBarcodeGroups(designIssues, barcodeCheck.checkedLabels, fieldIsFromSheet, 50, barcodeCheck.fitCounts).items,
    // fieldIsFromSheet reads inputMode and the mappings, both in runDataForCheck.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [designIssues, barcodeCheck, inputMode, runDataForCheck]);
  // The long values still in this run (not left out for any reason).
  const runSkipSet = useMemo(() => {
    if (!keptRows) return new Set<number>();
    const kept = new Set(keptRows);
    return new Set(allDataRows.map((_, i) => i).filter((i) => !kept.has(i)));
  }, [keptRows, allDataRows]);
  const longFields = useMemo(() => (longIssues ? longRows.fields.map((f) => ({ ...f, indexes: f.indexes.filter((i) => !runSkipSet.has(i)) })).filter((f) => f.indexes.length > 0) : []), [longIssues, longRows, runSkipSet]);
  const longLeft = useMemo(() => Array.from(new Set(longFields.flatMap((f) => f.indexes))).sort((a, b) => a - b), [longFields]);
  const longStops = longFields.some((f) => f.stops);
  const longLeftKey = `${longLeft.join(',')}|${longFields.map((f) => f.field).join(',')}`;
  const [longTickKey, setLongTickKey] = useState('');
  const longOk = !longLeft.length || (!longStops && longTickKey === longLeftKey);
  const leaveLongOut = () => setLongSkip({ key: longKey, indexes: Array.from(new Set([...longSkipped, ...longLeft])).sort((a, b) => a - b) });
  const [barcodeTicks, setBarcodeTicks] = useState<{ key: string; items: string[] }>({ key: '', items: [] });
  const barcodeItemTicked = (item: string) => barcodeTicks.key === barcodeKey && barcodeTicks.items.includes(item);
  const tickBarcodeItem = (item: string, value: boolean) => setBarcodeTicks((current) => {
    const items = current.key === barcodeKey ? current.items : [];
    return { key: barcodeKey, items: value ? [...items.filter((i) => i !== item), item] : items.filter((i) => i !== item) };
  });
  const designGoAhead = !barcodeWords.stops && designIssues.length > 0 && barcodeItems.length > 0 && barcodeItems.every(barcodeItemTicked);
  const designOk = designIssues.length === 0 || designGoAhead;
  // Every problem ticked to print anyway (carried to the run page as one go-ahead).
  const barcodeGoAhead = barcodeCheck.issues.length > 0 && longOk && (designIssues.length === 0 ? longLeft.length > 0 : designGoAhead);
  const barcodesClear = barcodeCheck.issues.length === 0;
  const barcodesOk = barcodesClear || (designOk && longOk);
  // "Fix it for me" / "Use a QR code instead" right here, offered only when
  // the changed design prints that barcode whole on every label and lands on
  // nothing. It changes the design's barcode only, is saved, and has Undo.
  const barcodeFixes = useMemo(
    () => (designIssues.some((issue) => issue.kind === 'too-long' || (issue.kind === 'characters' && barcodeIssueStops(issue, format))) && template && !template.summaryOnly
      ? runBarcodeFixes(checkTemplate, runDataForCheck, format, designIssues, Math.min(labelCount || 1, 2000))
      : null),
    [designIssues, template, checkTemplate, runDataForCheck, format, labelCount],
  );
  const [runFixNote, setRunFixNote] = useState<{ templateId: string; text: string; before: TemplateElement[]; tone: 'ok' | 'error' } | null>(null);
  const [runFixBusy, setRunFixBusy] = useState(false);
  const applyRunFix = async (fix: BarcodeAutoFix, elementId: string) => {
    if (!template || runFixBusy) return;
    const changed = fix.elements.find((el) => el.id === elementId);
    const was = template.elements.find((el) => el.id === elementId);
    if (!changed || !was) return;
    // This changes the shared design, not just this run: say so plainly, once.
    const what = runFixWords(was, changed);
    // A QR code: say whether the number under the bars stays, and when the
    // QR code comes out small enough that phones may struggle to read it.
    const qrNotes = fix.kind === 'qr' ? [
      fix.keptText ? 'The number under the barcode prints next to the QR code.' : fix.droppedText ? 'There’s no room for the number under the barcode, so it won’t print. If the label needs it, choose Not now and fix the design or pick a bigger label.' : '',
      fix.qrInches !== undefined && fix.qrInches < QR_SCAN_INCHES ? `The QR code prints ${fix.qrInches}" wide; many phones need ${QR_SCAN_INCHES}" to read it. Test-scan one, or pick a bigger label.` : '',
    ].filter(Boolean).join(' ') : '';
    const ok = await confirmDialog({
      title: `Change the design “${template.name}”?`,
      body: `${runFixWords(was, changed, true)} in the design itself, so every run made from it from now on gets this change too. ${qrNotes ? `${qrNotes} ` : ''}You can undo it right after.`,
      confirmLabel: 'Change the design',
      cancelLabel: 'Not now',
    });
    if (!ok) return;
    const before = template.elements;
    setRunFixBusy(true);
    try {
      // The barcode swapped in place, plus anything the fix adds (a QR code's number).
      const added = fix.elements.filter((el) => !before.some((b) => b.id === el.id));
      await updateTemplate(template.id, { elements: [...before.map((el) => (el.id === elementId ? changed : el)), ...added] });
      setRunFixNote({ templateId: template.id, text: `${what} in the design “${template.name}”${fix.keptText ? ', with its number next to it' : ''}. Runs made from it from now on use this too.${fix.qrInches !== undefined && fix.qrInches < QR_SCAN_INCHES ? ` The QR code prints ${fix.qrInches}" wide, small for some phones: test-scan one.` : ''}`, before, tone: 'ok' });
    } catch {
      setRunFixNote({ templateId: template.id, text: 'The design couldn’t be saved, so nothing changed. Check your connection and try again.', before, tone: 'error' });
    } finally {
      setRunFixBusy(false);
    }
  };
  const undoRunFix = async () => {
    if (!runFixNote || runFixBusy) return;
    setRunFixBusy(true);
    try {
      await updateTemplate(runFixNote.templateId, { elements: runFixNote.before });
      setRunFixNote(null);
    } catch {
      setRunFixNote({ ...runFixNote, text: 'Undo couldn’t be saved. Check your connection and try again.', tone: 'error' });
    } finally {
      setRunFixBusy(false);
    }
  };

  // "Use a QR code instead" for this run only: a copy of the design with the
  // QR code swapped in, named plainly, so the saved design (and every other
  // run made from it) stays as it is. A copy made before (a reload) is reused.
  const [qrCopy, setQrCopy] = useState<{ from: string; to: string; name: string; tone: 'ok' | 'error'; qrInches?: number; keptText?: boolean; droppedText?: boolean } | null>(null);
  const [qrBusy, setQrBusy] = useState(false);
  const switchToQrCopy = async (fix: BarcodeAutoFix) => {
    if (!template || qrBusy) return;
    const from = template;
    const name = `${from.name} (QR code)`;
    setQrBusy(true);
    try {
      const existing = useTemplateStore.getState().templates.find((t) => !t.archivedAt && t.name === name && t.formatId === from.formatId && (t.thermalRenderMode ?? 'native-v1') === (from.thermalRenderMode ?? 'native-v1'));
      const copy = existing ?? await addTemplate({ name, description: from.description, formatId: from.formatId, thermalRenderMode: from.thermalRenderMode, elements: fix.elements });
      setImagesByTemplate((current) => ({ ...current, [copy.id]: current[from.id] ?? {} }));
      setTemplateId(copy.id);
      setQrCopy({ from: from.id, to: copy.id, name, tone: 'ok', qrInches: fix.qrInches, keptText: fix.keptText, droppedText: fix.droppedText });
    } catch {
      setQrCopy({ from: from.id, to: from.id, name, tone: 'error' });
    } finally {
      setQrBusy(false);
    }
  };
  const undoQrCopy = () => {
    if (!qrCopy) return;
    setTemplateId(qrCopy.from);
    setQrCopy(null);
  };
  // Arriving from the run page's "Use a QR code instead": switch once, as soon
  // as the copied run's design and data are here.
  const qrIntent = searchParams.get('barcode') === 'qr';
  const qrIntentDone = useRef(false);
  const [qrIntentNote, setQrIntentNote] = useState('');
  const switchToQrCopyRef = useRef(switchToQrCopy);
  useEffect(() => { switchToQrCopyRef.current = switchToQrCopy; });
  const duplicateApplied = !!duplicateFrom && didApplyDuplicateRef.current === duplicateFrom;
  useEffect(() => {
    if (!qrIntent || qrIntentDone.current || !duplicateApplied) return;
    if (!template || template.summaryOnly || !format || labelCount === 0) return;
    qrIntentDone.current = true;
    const qr = barcodeFixes?.qr ?? (barcodeFixes?.fix?.kind === 'qr' ? barcodeFixes.fix : null);
    if (qr) void switchToQrCopyRef.current(qr);
    else if (barcodeCheck.issues.length) setQrIntentNote('A QR code doesn’t fit every label of this design, so nothing was switched. The choices are under Review.');
  }, [qrIntent, duplicateApplied, template, format, labelCount, barcodeFixes, barcodeCheck.issues.length]);

  // Text the thermal printer can't print ("·", accents) would come out as
  // junk: name the label and field so it can be fixed before printing.
  const characterCheck = useMemo(() => (checkTemplate && hasData ? checkRunPrinterCharacters(checkTemplate, format, runDataForCheck) : { issues: [], badLabels: 0 }), [checkTemplate, hasData, runDataForCheck, format]);

  // The review picture opens on the first label with a problem (label 12,
  // say), not on label 1, so the person sees what the message is about. It
  // jumps once per problem, then the pager is theirs again.
  const firstProblemIndex = useMemo(() => {
    if (inputMode === 'manual' || labelCount <= 1) return null;
    const inRun: number[] = [];
    for (const issue of [...barcodeCheck.issues, ...characterCheck.issues]) if (issue.label > 0) inRun.push(issue.label - 1);
    // Blank rows are numbered over the whole file; left-out rows aren't shown.
    for (const issue of blankCheck.issues) {
      if (issue.kind !== 'empty-rows' || issue.count >= allDataRows.length) continue;
      for (const row of issue.rows) {
        const index = keptRows ? keptRows.indexOf(row - 1) : row - 1;
        if (index >= 0) inRun.push(index);
      }
    }
    if (!inRun.length) for (const warning of barcodeCheck.warnings) if (warning.label > 0) inRun.push(warning.label - 1);
    const first = inRun.filter((index) => index < labelCount).sort((a, b) => a - b)[0];
    return first === undefined ? null : first;
  }, [inputMode, labelCount, barcodeCheck, characterCheck, blankCheck, allDataRows.length, keptRows]);
  const jumpedTo = useRef<number | null>(null);
  useEffect(() => {
    if (firstProblemIndex === null) { jumpedTo.current = null; return; }
    if (jumpedTo.current === firstProblemIndex) return;
    jumpedTo.current = firstProblemIndex;
    setPreviewIndex(firstProblemIndex);
  }, [firstProblemIndex]);
  // Going ahead anyway takes an explicit tick (those characters print as
  // junk); the bytes sent to the printer don't change either way.
  const characterKey = characterCheck.issues.map((issue) => `${issue.field}|${issue.label}|${issue.chars.join('')}`).join('\n');
  const [characterGoAheadKey, setCharacterGoAheadKey] = useState('');
  const charactersOk = characterCheck.issues.length === 0 || characterGoAheadKey === characterKey;

  // Items that cover each other or run off the label, on any label (a
  // barcode that doesn't print whole is named once, in the barcode list).
  const layoutIssues = useMemo(() => (checkTemplate ? runLayoutIssues(runDataForCheck, checkTemplate, format, Math.min(labelCount || 1, 2000)) : []), [checkTemplate, format, labelCount, runDataForCheck]);
  const layoutKey = layoutIssues.join('|');
  const [layoutConfirmedKey, setLayoutConfirmedKey] = useState('');
  const layoutOk = !layoutIssues.length || layoutConfirmedKey === layoutKey;


  const canCreate =
    !imageBusy &&
    nabisOk &&
    name.trim().length > 0 &&
    !!template &&
    !!format &&
    blanksOk &&
    sameOk &&
    barcodesOk &&
    charactersOk &&
    layoutOk &&
    examplesOk &&
    (inputMode === 'manual'
      ? dynamicFields.every((f) => (staticValues[f] ?? '').trim().length > 0) && manualQty >= 1
      : labelCount > 0 && (inputMode === 'csv' || inputMode === 'manifest' ? variableFields.length > 0 : !!pasteField));

  // Why Start is disabled, in plain words: the first missing setup step, or
  // every check still waiting (all at once, so nothing is revealed one tick
  // at a time).
  const setupReason = !name.trim()
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
              ? inputMode === 'csv' ? 'Upload a spreadsheet to start.' : inputMode === 'paste' ? 'Paste at least one value to start.' : 'Search and pick a Nabis package to start.'
              : (inputMode === 'csv' || inputMode === 'manifest') && variableFields.length === 0
                ? 'Pick a spreadsheet column for at least one field.'
                : inputMode === 'paste' && !pasteField
                  ? 'Choose which field the pasted values fill.'
                  : null;
  // Spreadsheet rows and design problems counted apart, so the footer never
  // blames the design for a value in the file.
  const barcodeStopCounts = () => {
    const stopping = designIssues.filter((issue) => barcodeIssueStops(issue, format));
    const rows = new Set(stopping.filter((issue) => issue.kind === 'characters' && issue.label && fieldIsFromSheet(issue.field)).map((issue) => issue.label)).size;
    const design = new Set(stopping.filter((issue) => !(issue.kind === 'characters' && issue.label && fieldIsFromSheet(issue.field))).map((issue) => `${issue.elementId ?? issue.field}|${issue.kind}`)).size;
    return `${rows.toLocaleString()} spreadsheet row${rows === 1 ? '' : 's'} and ${design.toLocaleString()} design problem${design === 1 ? '' : 's'} need fixing before anything prints.`;
  };
  // The parts Nabis didn't send are said once, in the Nabis notice with its
  // own Search again and Leave off: not again as "pick another package".
  const nabisCoversBlanks = !nabisOk && blankCheck.issues.length > 0 && blankCheck.issues.every((issue) => nabisGapFields.includes(issue.field));
  const checkReasons = setupReason || !format ? [] : [
    !blanksOk && !nabisCoversBlanks && (blankCheck.issues.every((issue) => issue.kind === 'no-value')
      ? `Give ${andList(blankCheck.issues.map((issue) => friendlyFieldName(issue.field)))} a column or one value above.`
      : `${blankHeading(blankCheck)}: choose what to do in Review.`),
    !sameOk && 'Confirm the value that prints on every label, or choose From spreadsheet.',
    !examplesOk && (placeholderRisks.length
      ? (placeholderRisks[0].type === 'qr' ? 'Type the web address the QR code should open, or make it change per label.' : 'Type the number the barcode should hold, or make it change per label.')
      : `Make the ${confirmRisks.some((r) => r.type === 'barcode') ? 'barcode' : 'QR code'} change per label, or confirm it prints the same on every label.`),
    !longOk && longValueReason(longFields, longLeft.length, allDataRows.length, longStops),
    !designOk && (barcodeWords.fixIn === 'data' && barcodeWords.stops ? (barcodeCheck.badLabels === 1
      ? `A barcode can’t print. ${charSkippable ? 'Leave that label out, fix that row' : 'Fix that row'}${barcodeFixes?.qr ? ', or use a QR code' : ''}.`
      : `Some barcodes can’t print. ${charSkippable ? 'Leave those labels out, fix those rows' : 'Fix those rows'}${barcodeFixes?.qr ? ', or use a QR code' : ''}.`)
      : barcodeWords.fixIn === 'both' && barcodeWords.stops ? barcodeStopCounts()
        : barcodeWaitWords(barcodeWords.stops, barcodeItems.length, barcodeItems.length === 1 ? barcodeTickLabel(barcodeItems[0]) : undefined)),
    !charactersOk && `${characterCheck.badLabels.toLocaleString()} label${characterCheck.badLabels === 1 ? ' has' : 's have'} characters the printer can’t print. Fix them, leave those labels out, or tick “Print anyway” in Review.`,
    !layoutOk && 'Items overlap: tick “I checked the preview” in Review, or fix the design.',
    !nabisOk && `Nabis didn’t send the ${nabisGapWhat} for ${labelsWords(nabisGap.labels, manifestSelectedRows.length)}. Search again, or tick ${nabisGapFields.length ? `to leave ${andList(nabisGapFields.map((field) => friendlyFieldName(field)))} off` : 'to print without them'}.`,
  ].filter((reason): reason is string => !!reason);
  const previewReason = setupReason || !format || checkReasons.length ? null
    : format.type === 'thermal' && previewState.status === 'error'
      ? 'Fix the preview error in Review to start.'
      : format.type === 'thermal' && previewState.status === 'loading'
        ? 'Checking the label preview…'
        : format.type === 'thermal' && previewState.status === 'empty'
          ? 'Nothing would print. Check the design and data.'
          : null;
  const blockReasons = setupReason ? [setupReason] : previewReason ? [previewReason] : checkReasons;

  // The fixed footer never covers the last buttons: the page is padded by
  // its measured height (it grows on phones and with a long reason).
  const [footerHeight, setFooterHeight] = useState(176);
  const footerObserver = useRef<ResizeObserver | null>(null);
  const footerRef = useCallback((el: HTMLDivElement | null) => {
    footerObserver.current?.disconnect();
    footerObserver.current = null;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setFooterHeight(Math.ceil(el.getBoundingClientRect().height)));
    observer.observe(el);
    footerObserver.current = observer;
  }, []);

  // Leaving a half-filled run: ask first, and keep a draft in this tab so a
  // refresh or Back can pick it up again.
  const formDirty = !leavingAfterCreate && (name.trim().length > 0 || !!templateId || csvRows.length > 0 || pasteText.trim().length > 0 || manifestRows.length > 0);
  const confirmLeave = useCallback(async () => {
    if (!formDirty) return true;
    // "Stay here" has the focus: Enter or Space never throws the run away.
    return confirmDialog({ title: 'Leave this new run?', body: 'We keep it in this browser tab, so you can pick it up again from New run.', confirmLabel: 'Leave', cancelLabel: 'Stay here', focusCancel: true });
  }, [formDirty]);
  useEffect(() => {
    if (!formDirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [formDirty]);

  // The browser's Back button: a guard entry in history catches it, asks with
  // the same dialog, and goes back for real only after "Leave".
  const guardRef = useRef(false);
  // After Start run: the run page to open once the guard entry is gone.
  const afterGuardRef = useRef<string | null>(null);
  const routerRef = useRef(router);
  useEffect(() => { routerRef.current = router; }, [router]);
  const confirmLeaveRef = useRef(confirmLeave);
  useEffect(() => { confirmLeaveRef.current = confirmLeave; }, [confirmLeave]);
  // A same-page link ("Skip to content", #main) adds a history entry with a
  // new #hash and fires popstate too: that is not leaving.
  const guardHashRef = useRef('');
  useEffect(() => {
    if (!formDirty || guardRef.current) return;
    guardRef.current = true;
    guardHashRef.current = window.location.hash;
    window.history.pushState(null, '', window.location.href);
  }, [formDirty]);
  useEffect(() => {
    const onPopState = () => {
      if (afterGuardRef.current) {
        const target = afterGuardRef.current;
        afterGuardRef.current = null;
        routerRef.current.replace(target);
        return;
      }
      if (window.location.hash !== guardHashRef.current) {
        guardHashRef.current = window.location.hash;
        return;
      }
      if (!guardRef.current) return;
      guardRef.current = false;
      void confirmLeaveRef.current().then((leave) => {
        if (leave) {
          setLeavingAfterCreate(true);
          window.history.back();
        } else {
          guardRef.current = true;
          guardHashRef.current = window.location.hash;
          window.history.pushState(null, '', window.location.href);
        }
      });
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Offer the unfinished run kept in this tab, unless a link asked for
  // something specific (a preset, a re-run, a design or a Manifest package).
  const [draftOffer, setDraftOffer] = useState<RunDraft | null>(null);
  const draftDecided = useRef(false);
  useEffect(() => {
    if (presetId || duplicateFrom || deepLinkTemplateId || manifestDeepLinkQuery) { draftDecided.current = true; return; }
    const draft = readRunDraft();
    if (draft) setDraftOffer(draft); else draftDecided.current = true;
  }, [presetId, duplicateFrom, deepLinkTemplateId, manifestDeepLinkQuery]);
  const restoreDraft = (draft: RunDraft) => {
    setName(draft.name);
    setTemplateId(draft.templateId);
    setInputMode(draft.inputMode);
    setStaticValues(draft.staticValues || {});
    setFieldMappings(draft.fieldMappings || {});
    setHiddenRunFields(draft.hiddenRunFields || []);
    setPasteText(draft.pasteText || '');
    setPasteField(draft.pasteField ?? null);
    setCsvHeaders(draft.csvHeaders || []);
    setCsvRows(draft.csvRows || []);
    setCsvPlainRows(draft.csvPlainRows ?? null);
    setCsvFileName(draft.csvFileName || '');
    setManualQty(Math.max(1, draft.manualQty || 1));
    setDraftOffer(null);
    draftDecided.current = true;
  };
  // Starting a new run while the kept one is offered means "start fresh":
  // keep the new work, not the old draft, if the page reloads.
  useEffect(() => {
    if (formDirty && draftOffer && !draftDecided.current) {
      draftDecided.current = true;
      setDraftOffer(null);
    }
  }, [formDirty, draftOffer]);
  useEffect(() => {
    if (!formDirty || !draftDecided.current) return;
    const timer = setTimeout(() => saveRunDraft({
      name, templateId, inputMode, staticValues, fieldMappings, hiddenRunFields, pasteText, pasteField,
      csvHeaders, csvRows: csvRows.length <= 5000 ? csvRows : [], csvPlainRows: csvRows.length <= 5000 ? csvPlainRows : null, csvFileName, manualQty, savedAt: Date.now(),
    }), 400);
    return () => clearTimeout(timer);
  }, [formDirty, draftOffer, name, templateId, inputMode, staticValues, fieldMappings, hiddenRunFields, pasteText, pasteField, csvHeaders, csvRows, csvPlainRows, csvFileName, manualQty]);

  // A new run is named after its design and today's date until the person
  // types a name of their own.
  const lastAutoNameRef = useRef('');
  useEffect(() => {
    if (!template || inputMode === 'manifest') return;
    const autoName = `${template.name} — ${shortRunDate()}`;
    setName((current) => {
      const trimmed = current.trim();
      if (trimmed && trimmed !== lastAutoNameRef.current) return current;
      lastAutoNameRef.current = autoName;
      return autoName;
    });
  }, [template, inputMode]);

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
    let finalMappings = dataMappings;
    let legacyField: string | null = null;
    let finalSourceData: Record<string, string>[] = dataRows;
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
        // Typed values only for "Same on every label" fields: a per-label
        // field never carries one value that other labels could pick up.
        staticValues: staticValuesForRun(dynamicFields, finalMappings, visibleStaticValues),
        fieldMappings: finalMappings,
        // Left-off parts print nothing: the run's saved design leaves their items out.
        ...(leftOffFields.size ? { leaveOff: Array.from(leftOffFields) } : {}),
        dataSource: inputMode as RunDataSource,
        sourceData: finalSourceData,
        mappedField: legacyField,
        status: autoStart ? 'queued' : 'draft',
      });
      if (presetId) void updatePreset(presetId, { touch: true });
      clearRunDraft();
      rememberRunSource(inputMode);
      if (blankCheck.issues.length && leaveBlank) rememberBlankChoice(typeof window !== 'undefined' ? window.localStorage : null, run.id, blankCheck.signature);
      // The go-ahead given here carries to the run page, for the same problems.
      if ((barcodeGoAhead && barcodeWords.carriesOver) || (layoutIssues.length && layoutOk)) {
        const snapshot = run.designSnapshot;
        const saved = runPrintCheck({ ...run, sourceData: run.sourceData?.length ? run.sourceData : finalSourceData, fieldMappings: run.fieldMappings ?? finalMappings }, snapshot?.template ?? visibleTemplate ?? template, snapshot?.format ?? format);
        rememberPrintGoAhead(typeof window !== 'undefined' ? window.localStorage : null, run.id, {
          // "Neither label will scan" is asked again on the run page, never carried over ticked.
          ...(barcodeGoAhead && saved.blocking.length && !saved.verdict.stops && saved.verdict.carriesOver ? { barcode: saved.blockingKey } : {}),
          ...(layoutIssues.length && layoutOk && saved.layout.length ? { layout: saved.layoutKey } : {}),
        });
      }
      return run;
    } catch (error) {
      console.error('Error creating run:', error);
      setCreateRunError(isNetworkError(error)
        ? 'Couldn’t reach Label Wrangler. Check your internet and press Start run again. Nothing was printed and your data is still here.'
        : friendlyError(error, 'Could not start this run. Nothing was printed and your data is still here.'));
      return null;
    } finally {
      setIsCreatingRun(false);
    }
  };

  const handleSaveAndPrint = async () => {
    const run = await handleCreateRun(true);
    if (run) {
      // The run has its own address now, so a refresh keeps it. The wizard's
      // own history entry is replaced by the run, and the extra entry that
      // guards Back is taken off first, so Back from the run goes to where
      // the person was before New run, not to an empty wizard.
      setLeavingAfterCreate(true);
      const target = `/runs/${run.id}`;
      if (guardRef.current) {
        guardRef.current = false;
        afterGuardRef.current = target;
        window.history.back();
        window.setTimeout(() => {
          if (afterGuardRef.current !== target) return;
          afterGuardRef.current = null;
          router.replace(target);
        }, 600);
      } else {
        router.replace(`/runs/${run.id}`);
      }
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
      staticDefaults: staticValuesForRun(dynamicFields, fieldMappings, visibleStaticValues),
      fieldMappings: Object.fromEntries(Object.entries(fieldMappings).filter(([field]) => visibleFieldSet.has(field))),
    });
    setSaveAsPresetName('');
    toast(`Preset "${preset.name}" saved.`);
  };

  const setupComplete = name.trim().length > 0 && !!template && !!format;
  const fieldsComplete = !!template && allDynamicFields.length > 0 && dynamicFields.length > 0;
  // Data is only "done" once there is a design with fields and real values
  // for them (an empty field list used to read as done).
  const dataComplete = fieldsComplete && blanksOk && sameOk && examplesOk && (inputMode === 'manual'
    ? dynamicFields.every((f) => (staticValues[f] ?? '').trim().length > 0) && manualQty >= 1
    : inputMode === 'paste'
      ? pasteText.trim().length > 0 && !!pasteField
      : labelCount > 0 && variableFields.length > 0);
  const workflowSteps = [
    { label: 'Design', done: setupComplete },
    { label: 'Data', done: dataComplete },
    { label: 'Review', done: canCreate },
  ];
  const currentStep = workflowSteps.findIndex((s) => !s.done);
  const tightGroups = describeBarcodeGroups(barcodeCheck.warnings, barcodeCheck.checkedLabels, fieldIsFromSheet, 3, barcodeCheck.fitCounts);
  // One line per part and character, not one per label.
  const characterSummary = summarizePrinterCharacterIssues(characterCheck.issues, fieldIsFromSheet);
  // Type mode before anything is typed: one calm next step, not a list of
  // empty fields (they are only marked once someone leaves one empty).
  const manualUntyped = inputMode === 'manual' && dynamicFields.length > 0 && dynamicFields.every((f) => !(staticValues[f] ?? '').trim());
  // A label whose barcode value has characters a barcode can't hold can't be
  // drawn at all: say that in plain words (the problem and its fixes are
  // listed under the picture), not the renderer's own error.
  const shownBadBarcode = previewState.status === 'error' && barcodeCheck.issues.some((issue) => issue.kind !== 'too-long' && issue.kind !== 'tight' && issue.label > feedStart && issue.label <= feedStart + across);
  const previewMessage = shownBadBarcode
    ? `The preview can’t draw the barcode on ${across > 1 ? 'these labels' : 'this label'}: its value has characters a barcode can’t hold.`
    : previewState.status === 'error' && checkTemplate
      ? friendlyRenderError(previewState.message, checkTemplate.elements, format?.labelsAcross || 1, previewValues, format ?? undefined)
      : '';
  const sheetWord = inputMode === 'manifest' ? 'Nabis data' : 'spreadsheet';
  // A workbook with several sheets: pick the labels' sheet here (no reordering in Excel).
  const sheetNames = fileInfo?.sheetNames ?? [];
  const sheetPicker = sheetNames.length > 1 && lastFile.current ? (
    <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-300">
      <span id={`${formId}-sheet`}>Using sheet</span>
      <div className="w-64 max-w-full">
        <CustomSelect
          aria-labelledby={`${formId}-sheet`}
          value={String(fileInfo?.sheetIndex ?? 0)}
          onChange={(value) => { if (lastFile.current) void handleFile(lastFile.current, undefined, Number(value)); }}
          options={sheetNames.map((name, i) => ({ value: String(i), label: name }))}
        />
      </div>
    </div>
  ) : null;

  // Labels whose values can't print (a barcode that can't hold é, an emoji
  // in the printer's font) can be left out, like blank rows. Each list's
  // button leaves out only its own labels; with two lists, one line on top
  // leaves out all of them.
  const charLeft = (indexes: ReadonlyArray<number>) => indexes.filter((index) => !charSkipped.includes(index));
  const charKeepsSome = (indexes: ReadonlyArray<number>) => indexes.length > 0 && allDataRows.length - charSkipped.length - indexes.length >= 1;
  const charBarcodeLeft = charLeft(charBadBarcodeIndexes);
  const charTextLeft = charLeft(charBadTextIndexes);
  const charAllLeft = charLeft(charBadIndexes);
  const charBarcodeShown = charBarcodeLeft.length > 0 && barcodeCheck.issues.some((issue) => issue.kind === 'characters');
  const charTextShown = charTextLeft.length > 0 && characterCheck.issues.some((issue) => issue.label > 0);
  const charBarcodeCovers = charBarcodeLeft.length === charAllLeft.length;
  const charTextCovers = charTextLeft.length === charAllLeft.length;
  // Two lists with different labels: a short button under each, and one for all on top.
  const charTwoLists = charBarcodeShown && charTextShown && !charBarcodeCovers && !charTextCovers;
  // Two lists about the same labels: the button once, under the list that covers them all.
  const charBarcodeButton = charBarcodeShown && (!charTextShown || charTwoLists || charBarcodeCovers);
  const charTextButton = charTextShown && (!charBarcodeShown || charTwoLists || (charTextCovers && !charBarcodeCovers));
  const leaveOutButton = (indexes: ReadonlyArray<number>) => {
    if (!charSkippable || !charKeepsSome(indexes)) return null;
    const n = indexes.length;
    const words = charTwoLists
      ? `Leave ${n === 1 ? 'this label' : `these ${n.toLocaleString()} labels`} out`
      : `Leave ${n === 1 ? 'that label' : `those ${n.toLocaleString()} labels`} out and print the other ${(allDataRows.length - charSkipped.length - n).toLocaleString()}`;
    return <button type="button" className="btn btn-secondary btn-sm max-w-full whitespace-normal text-left max-sm:min-h-11 max-sm:py-2" onClick={() => leaveCharsOut(indexes)}>{words}</button>;
  };

  // The main AppShell nav has a 'Runs' tab, so no redundant 'Back to Runs'
  // action is needed here.
  return (
    <AppShell beforeLeave={confirmLeave}>
      <PageTitle title={name.trim() ? `New run · ${name.trim()}` : 'New run'} />
      <div className="flex-1 overflow-auto">
        <div className="page-container space-y-5" style={{ paddingBottom: footerHeight + 24 }}>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold text-zinc-100">New run</h1>
              <p className="mt-1 text-sm text-zinc-400">Pick a design, add your values, then check the labels and print.</p>
            </div>
            <ol className="flex flex-wrap items-center gap-x-5 gap-y-1" aria-label="Progress">
              {workflowSteps.map((step, index) => {
                const current = index === currentStep;
                return (
                  <li key={step.label} className={`flex min-w-0 items-center gap-1.5 text-sm ${current ? 'text-zinc-100' : step.done ? 'text-zinc-300' : 'text-zinc-400'}`} aria-current={current ? 'step' : undefined}>
                    <span aria-hidden="true" className={`size-2.5 shrink-0 rounded-full border-2 ${step.done ? 'border-amber-500 bg-amber-500' : current ? 'border-amber-500' : 'border-zinc-600'}`} />
                    <span className="truncate font-medium">{step.label}<span className="sr-only">{step.done ? ' (done)' : current ? ' (current step)' : ' (not done yet)'}</span></span>
                  </li>
                );
              })}
            </ol>
          </div>

          {libraryFailed && (
            <ErrorState
              title={templates.length === 0 && templatesLoadError ? 'We couldn’t load your designs' : 'We couldn’t load your label sizes'}
              body={friendlyError(templatesLoadError || formatsLoadError, 'Check your connection, then try again.')}
              actions={<StateActions
                retrying={templatesRetrying || formatsRetrying}
                onRetry={() => {
                  if (useTemplateStore.getState().error) void useTemplateStore.getState().fetchTemplates();
                  if (useFormatStore.getState().error) void useFormatStore.getState().fetchFormats();
                  if (useRunStore.getState().error) void useRunStore.getState().loadAll();
                }}
                back={{ href: '/runs', label: 'Back to runs' }}
              />}
            />
          )}

          {!libraryFailed && draftOffer && (
            <section role="status" className="card card-flat p-4 sm:p-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-zinc-100">We kept your unfinished run{draftOffer.name.trim() ? <> “{draftOffer.name.trim()}”</> : ''}.</p>
              <div className="flex gap-2">
                <button type="button" className="btn btn-primary btn-sm" onClick={() => restoreDraft(draftOffer)}>Continue</button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => { clearRunDraft(); setDraftOffer(null); draftDecided.current = true; }}>Start fresh</button>
              </div>
            </section>
          )}

          {/* Design */}
          {!libraryFailed && <section className="card card-flat p-4 sm:p-5 space-y-4" aria-labelledby={`${formId}-design-h`}>
            <h2 id={`${formId}-design-h`} className="text-base font-semibold text-zinc-100">Name and design</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <div className="mb-1 flex min-h-control-sm items-center"><label htmlFor={`${formId}-name`} className="field-label">Run name</label></div>
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
                <div className="mb-1 flex flex-wrap items-center justify-between gap-x-2">
                  <span id={`${formId}-template`} className="field-label whitespace-nowrap">Label design</span>
                  <div className="flex items-center max-sm:basis-full sm:-mr-[13px]">
                    {/* Edit the currently-selected design without losing
                        your spot in the wizard — round-trips via ?returnTo. */}
                    {template && (
                      <Link
                        href={`/designer?id=${template.id}&returnTo=${encodeURIComponent('/runs/new')}`}
                        className="btn btn-ghost btn-sm"
                        title="Open this design in the designer"
                      >
                        <Pencil className="size-4" aria-hidden="true" /> Edit design
                      </Link>
                    )}
                    {!(templates.length === 0 && templatesHydrated && !templatesLoadError) && <button
                      type="button"
                      onClick={() => setShowNewTemplateDialog(true)}
                      disabled={formats.length === 0}
                      title={formats.length === 0 ? 'Add a label size first' : 'Make a new label design'}
                      className="btn btn-ghost btn-sm"
                    >
                      <Plus className="size-4" aria-hidden="true" /> New design
                    </button>}
                  </div>
                </div>
                {templates.length === 0 && !templatesHydrated ? (
                  <p className="py-2 text-sm text-zinc-400">Loading your label designs…</p>
                ) : templates.length === 0 ? (
                  // The only way on is a real button, never a dim link.
                  <div className="space-y-3 py-1">
                    <p className="text-sm text-zinc-400">{formats.length === 0 ? 'No label designs yet. A design needs the size of your labels first.' : 'No label designs yet.'}</p>
                    {formats.length === 0
                      ? <Link href="/formats" className="btn btn-primary"><Plus className="size-4" aria-hidden="true" />Add a label size</Link>
                      : <button type="button" onClick={() => setShowNewTemplateDialog(true)} className="btn btn-primary"><Plus className="size-4" aria-hidden="true" />Make a design</button>}
                  </div>
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
                        // The size once: many label size names already say it.
                        sublabel: f ? (f.name.includes(`${f.width}" × ${f.height}"`) || f.name.includes(`${f.width}"×${f.height}"`) ? f.name : `${f.name} — ${f.width}" × ${f.height}"`) : '',
                      };
                    })}
                  />
                )}
                {qrCopy && template && (qrCopy.tone === 'error' || qrCopy.to === template.id) && (
                  <p role={qrCopy.tone === 'error' ? 'alert' : 'status'} className={`fold-reveal mt-2 flex items-start gap-1.5 text-sm ${qrCopy.tone === 'error' ? 'text-red-400' : 'text-zinc-300'}`}>
                    {qrCopy.tone === 'error' ? <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> : <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-400" aria-hidden="true" />}
                    <span>
                      {qrCopy.tone === 'error'
                        ? 'Couldn’t make the QR code copy of the design, so nothing changed. Check your connection, then press “Use a QR code instead” under Review.'
                        : `Switched to a QR code in a copy of the design, “${qrCopy.name}”. The original is unchanged.${barcodesClear && labelCount > 0 ? ` All ${labelCount.toLocaleString()} label${labelCount === 1 ? '' : 's'} can print.` : ''}${qrCopy.droppedText ? ' The number under the barcode won’t print.' : ''}${qrCopy.qrInches !== undefined && qrCopy.qrInches < QR_SCAN_INCHES ? ` The QR code prints ${qrCopy.qrInches}" wide, small for some phones: test-scan one.` : ''}`}
                      {qrCopy.tone === 'ok' && <>{' '}<button type="button" className="link" onClick={undoQrCopy}>Undo</button></>}
                    </span>
                  </p>
                )}
                {qrIntentNote && !qrCopy && <p role="status" className="mt-2 text-sm text-zinc-300">{qrIntentNote}</p>}
              </div>
            </div>
          </section>}

          {template && <RunImagePicker key={template.id} template={template} selections={imageSelections} onBusyChange={setImageBusy} onChange={value => setImagesByTemplate(current => ({ ...current, [template.id]: value }))} />}

          {template && unnamedDynamic.length > 0 && (
            <section className="card card-flat p-4 sm:p-5 space-y-3">
              <h2 className="text-base font-semibold text-zinc-100">Some parts have no name</h2>
              <p className="text-sm text-zinc-300">
                {unnamedDynamic.length === 1 ? '1 part of this design changes per label but has' : `${unnamedDynamic.length} parts of this design change per label but have`} no name, so {unnamedDynamic.length === 1 ? 'it' : 'they'} can’t be filled. Naming them saves the design.
              </p>
              <button
                onClick={() => void nameUnnamedFields()}
                disabled={namingFields}
                className="btn btn-primary btn-sm"
              >
                {namingFields ? 'Saving design…' : 'Name them and save'}
              </button>
              {namingError && <p role="alert" className="text-sm text-red-400">{namingError}</p>}
            </section>
          )}

          {template && flippable.length > 0 && (
            <section className="card card-flat p-4 sm:p-5 space-y-3" aria-labelledby={`${formId}-codes`}>
              <h2 id={`${formId}-codes`} className="text-base font-semibold text-zinc-100">{exampleRisks.length ? 'Check the codes on this label' : 'Codes that print the same on every label'}</h2>
              <ul className="space-y-4">
                {flippable.map((f) => {
                  const el = template.elements.find((e) => e.id === f.id);
                  const value = el && 'content' in el ? (el.content ?? '').trim() : '';
                  const risk = exampleRisks.find((r) => r.elementId === f.id);
                  const kind = f.type === 'qr' ? 'QR code' : 'barcode';
                  const columnName = risk?.column ? (inputMode === 'manifest' ? friendlyFieldName(risk.column) : risk.column) : null;
                  const columnWord = inputMode === 'manifest' ? 'detail' : 'column';
                  const placeholder = !!risk?.isExample;
                  const what = f.type === 'qr' ? 'address' : 'number';
                  const real = realValues[f.id] ?? '';
                  return (
                    <li key={f.id} className="space-y-2">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                        <p className={`min-w-0 break-words text-sm ${risk ? 'text-amber-300' : 'text-zinc-300'}`}>
                          {placeholder
                            ? `The ${kind} still has the design’s sample ${what}${value ? ` “${value}”` : ''}, so it isn’t ready to print.`
                            : `The ${kind} prints “${value || 'nothing'}” on every label.`}{columnName ? ` Your ${sheetWord} has a “${columnName}” ${columnWord}.` : ''}
                        </p>
                        <button
                          type="button"
                          disabled={flipping === f.id}
                          onClick={() => void flipToPerLabel(f.id, f.suggestedName)}
                          className="btn btn-secondary btn-sm max-w-full shrink-0 self-start sm:self-auto"
                        >
                          <span className="truncate">{flipping === f.id ? 'Saving the design…' : columnName ? `Use the ${columnName} ${columnWord}` : 'Change it per label'}</span>
                        </button>
                      </div>
                      {placeholder && (
                        // The real value, asked for here: the sample is never printed by a tick.
                        <form className="flex flex-col gap-2 sm:flex-row sm:items-end" onSubmit={(e) => { e.preventDefault(); void saveRealValue(f.id); }}>
                          <div className="min-w-0 flex-1">
                            <label htmlFor={`${formId}-real-${f.id}`} className="field-label">{f.type === 'qr' ? 'What web address should the QR code open?' : 'What number should the barcode hold?'}</label>
                            <input
                              id={`${formId}-real-${f.id}`}
                              type="text"
                              inputMode={f.type === 'qr' ? 'url' : 'text'}
                              autoComplete="off"
                              spellCheck={false}
                              value={real}
                              onChange={(e) => setRealValues((current) => ({ ...current, [f.id]: e.target.value }))}
                              placeholder={f.type === 'qr' ? 'https://your-shop.com' : ''}
                              className="field mt-1"
                            />
                          </div>
                          <button type="submit" className="btn btn-primary shrink-0 self-start sm:self-auto" disabled={!real.trim() || EXAMPLE_CODE_VALUES.includes(real.trim()) || realSaving === f.id}>
                            {realSaving === f.id ? 'Saving…' : `Use this ${what}`}
                          </button>
                        </form>
                      )}
                      {realNote?.elementId === f.id && (
                        <p role={realNote.tone === 'error' ? 'alert' : 'status'} className={`flex items-start gap-1.5 text-sm ${realNote.tone === 'error' ? 'text-red-400' : 'text-zinc-300'}`}>
                          {realNote.tone === 'error' ? <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> : <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-400" aria-hidden="true" />}
                          {realNote.text}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
              {confirmRisks.length > 0 && (
                <label className="flex min-h-11 items-center gap-3 text-sm text-zinc-100">
                  <input type="checkbox" className="check" checked={exampleConfirmedKey === exampleKey} onChange={(e) => setExampleConfirmedKey(e.target.checked ? exampleKey : '')} />
                  <span>Yes, print {confirmRisks.length === 1 ? `this ${confirmRisks[0].type === 'qr' ? 'QR code' : 'barcode'}` : 'these'} the same on every label</span>
                </label>
              )}
            </section>
          )}
          {template && allDynamicFields.length === 0 && flippable.length === 0 && (
            <p role="status" className="text-sm text-amber-300">
              Nothing on this design changes per label. Open it in the <Link href={`/designer?id=${template.id}`} className="link">designer</Link>{' '}and set the parts that should change to &ldquo;Changes per label&rdquo;.
            </p>
          )}

          {template && allDynamicFields.length > 0 && (
            <>
              {/* Data */}
              <section className="card card-flat p-4 sm:p-5 space-y-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <h2 className="text-base font-semibold text-zinc-100">Where the values come from</h2>
                  <SourceSwitch value={inputMode} onChange={setInputMode} />
                </div>
                {flipNote && (
                  <p role={flipNote.tone === 'error' ? 'alert' : 'status'} className={`flex items-start gap-1.5 text-sm ${flipNote.tone === 'error' ? 'text-red-400' : 'text-zinc-300'}`}>
                    {flipNote.tone === 'error' ? <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> : <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-400" aria-hidden="true" />}
                    {flipNote.text}
                  </p>
                )}

                {inputMode === 'manual' ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {dynamicFields.map((field) => (
                        <div key={field}>
                          <label htmlFor={`${formId}-manual-${field}`} className="field-label mb-1.5">{friendlyFieldName(field)}</label>
                          <input
                            id={`${formId}-manual-${field}`}
                            type="text"
                            value={staticValues[field] ?? ''}
                            onChange={(e) => setStaticValues((s) => ({ ...s, [field]: e.target.value }))}
                            onBlur={() => setTouchedManual((t) => (t.has(field) ? t : new Set(t).add(field)))}
                            aria-invalid={touchedManual.has(field) && !(staticValues[field] ?? '').trim() ? true : undefined}
                            className={`field ${touchedManual.has(field) && !(staticValues[field] ?? '').trim() ? 'border-amber-500/60' : ''}`}
                          />
                        </div>
                      ))}
                      <div>
                        <label htmlFor={`${formId}-qty`} className="field-label mb-1.5">How many labels</label>
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
                          className="field tabular-nums"
                        />
                      </div>
                    </div>
                  </div>
                ) : inputMode === 'paste' ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor={`${formId}-paste`} className="field-label mb-1.5">One value per line, one label each</label>
                      <textarea
                        id={`${formId}-paste`}
                        value={pasteText}
                        onChange={(e) => setPasteText(e.target.value)}
                        rows={7}
                        placeholder={'1A4FF0300000022000000101\n1A4FF0300000022000000102'}
                        className="field resize-y"
                      />
                      {pasteInfo.heading && <p className="mt-1.5 text-sm text-zinc-400">The first line, “{pasteInfo.heading}”, looks like a heading, so it isn’t a label.</p>}
                      {pasteInfo.table && <p className="mt-1.5 text-sm text-zinc-400">This looks like a table from a spreadsheet. <button type="button" onClick={usePasteAsSpreadsheet} className="link">Use it as a spreadsheet</button></p>}
                    </div>
                    <div>
                      <span id={`${formId}-paste-field`} className="field-label mb-1.5">These values fill</span>
                      <CustomSelect
                        aria-labelledby={`${formId}-paste-field`}
                        value={pasteField ?? ''}
                        onChange={(v) => setPasteField(v || null)}
                        options={dynamicFields.map((f) => ({ value: f, label: friendlyFieldName(f) }))}
                      />
                    </div>
                  </div>
                ) : inputMode === 'csv' ? (
                  <div className="space-y-3">
                    {csvHeaders.length === 0 && (
                      <div className="flex items-center gap-2 flex-wrap">
                        <button type="button" onClick={() => fileInputRef.current?.click()} className="btn btn-primary">
                          <Upload className="size-4" aria-hidden="true" /> Upload spreadsheet
                        </button>
                        <button
                          type="button"
                          onClick={downloadCsvTemplate}
                          disabled={dynamicFields.length === 0}
                          title="Download a spreadsheet with the right column headings"
                          className="btn btn-secondary"
                        >
                          <Download className="size-4" aria-hidden="true" /> Blank spreadsheet
                        </button>
                      </div>
                    )}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                      hidden
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        if (file) void handleFile(file);
                      }}
                    />
                    {fileError ? (
                      <div className="space-y-1">
                        <p role="alert" className="flex items-start gap-1.5 text-sm text-amber-300"><AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{fileError}</p>
                        {sheetPicker}
                      </div>
                    ) : csvHeaders.length > 0 ? (
                      <div className="space-y-1 text-sm text-zinc-400">
                        <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span className="min-w-0 break-words">
                            {csvFileName ? <span className="text-zinc-100">{csvFileName}</span> : 'Your file'}: {csvRows.length.toLocaleString()} row{csvRows.length === 1 ? '' : 's'}, so {csvRows.length.toLocaleString()} label{csvRows.length === 1 ? '' : 's'}
                          </span>
                          <button type="button" onClick={() => fileInputRef.current?.click()} className="inline-flex min-h-control-sm items-center gap-1.5 link">
                            <Upload className="size-4" aria-hidden="true" /> Choose another file
                          </button>
                        </p>
                        {sheetPicker}
                        {/* Where the column names are: only asked when they weren't
                            in row 1 or some parts found no column. */}
                        {fileInfo && lastFile.current && !fileInfo.titleSkipped && fileInfo.headerRow === 1 && unmatchedShown.length > 0 && !headerRowAsked && headingsLookLikeData(csvHeaders) && (
                          <button type="button" onClick={() => setHeaderRowAsked(true)} className="link inline-flex min-h-control-sm items-center">Column names aren’t in row 1?</button>
                        )}
                        {fileInfo && lastFile.current && (fileInfo.titleSkipped || fileInfo.headerRow !== 1 || (unmatchedShown.length > 0 && headerRowAsked)) && (
                          <label className="fold-reveal flex flex-wrap items-center gap-2">
                            {fileInfo.titleSkipped ? <span>The rows above row {fileInfo.headerRow} looked like a title, so they were skipped.</span> : null}
                            <span>The column names are in row</span>
                            <input
                              type="number"
                              min={1}
                              max={50}
                              value={fileInfo.headerRow}
                              onChange={(e) => {
                                const row = Math.max(1, Math.min(50, Math.floor(Number(e.target.value) || 1)));
                                setFileInfo((info) => (info ? { ...info, headerRow: row } : info));
                                if (lastFile.current) void handleFile(lastFile.current, row);
                              }}
                              className="field field-sm w-20 tabular-nums"
                            />
                          </label>
                        )}
                      </div>
                    ) : (
                      <p className="text-sm text-zinc-400">A CSV or Excel file with one row per label under a row of headings.</p>
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
                        placeholder="Package tag, item or batch"
                        aria-label="Search Nabis packages"
                        className="field min-w-0 flex-1"
                      />
                      <button
                        onClick={handleManifestSearch}
                        disabled={manifestSearch.trim().length < 2 || isSearchingManifest}
                        className="btn btn-secondary"
                      >
                        <Search className="size-4" aria-hidden="true" /> {isSearchingManifest ? 'Searching' : 'Search'}
                      </button>
                    </div>
                    {manifestError && <p className="text-sm text-amber-300">{manifestError}</p>}
                    {manifestRows.length > 0 && (
                      <div className="space-y-1">
                        <div className="flex items-center justify-between px-1">
                          <span className="field-label">Choose a package</span>
                          <span className="text-sm text-zinc-400">
                            {manifestPackageSummaries.length.toLocaleString()} found
                          </span>
                        </div>
                        <div className="max-h-64 overflow-auto rounded-lg bg-zinc-950">
                        {manifestPackageSummaries.map(({ row, labelRows, missing }) => {
                          const key = manifestPackageKey(row);
                          const isSelected = key === selectedManifestPackageKey;
                          return (
                            <button
                              key={key}
                              type="button"
                              aria-pressed={isSelected}
                              onClick={() => {
                                setSelectedManifestPackageKey(key);
                                setPreviewIndex(0);
                              }}
                              className={`grid w-full grid-cols-[auto_minmax(0,1.6fr)_minmax(0,1fr)_auto] gap-3 px-3 py-2.5 text-left text-sm transition-colors ${
                                isSelected ? 'bg-amber-500/10' : 'hover:bg-zinc-900'
                              }`}
                            >
                              <span className={`mt-0.5 ${isSelected ? 'text-amber-300' : 'text-zinc-400'}`}>
                                {isSelected ? <CheckCircle2 className="size-4" aria-hidden="true" /> : <Circle className="size-4" aria-hidden="true" />}
                              </span>
                              <span className="min-w-0">
                                <span className="block truncate text-zinc-100" title={row.itemName}>{row.itemName || 'No item name'}</span>
                                <span className="block truncate tabular-nums text-zinc-400" title={row.tag}>{row.tag || 'No tag'}</span>
                                {missing && <span className="block text-amber-300">Some details didn’t arrive</span>}
                              </span>
                              <span className="min-w-0 truncate text-zinc-400" title={row.lotNumber || row.batch}>
                                {row.lotNumber || row.batch ? `Lot ${row.lotNumber || row.batch}` : 'No lot'}
                              </span>
                              <span className={`whitespace-nowrap text-right ${isSelected ? 'text-amber-300' : 'text-zinc-400'}`}>
                                {labelRows.toLocaleString()} label{labelRows === 1 ? '' : 's'}
                              </span>
                            </button>
                          );
                        })}
                        </div>
                      </div>
                    )}
                    {!isSearchingManifest && hasSearchedManifest && manifestRows.length === 0 && !manifestError && (
                      <p className="text-sm text-zinc-400">No Nabis packages found.</p>
                    )}
                  </div>
                )}

                {/* Matching fields to columns, for row-backed sources. */}
                {(inputMode === 'csv' || inputMode === 'manifest') && rowHeaders.length > 0 && labelCount > 0 && (
                  <div className="space-y-3 pt-2">
                    <h3 className="text-sm font-semibold text-zinc-100">Match each part of the label to a {inputMode === 'manifest' ? 'Nabis detail' : 'column'}</h3>
                    {inputMode === 'csv' && justLeftOff.filter((f) => leftOffFields.has(f)).map((field) => {
                      const code = codeKind(field);
                      return (
                        <p key={field} role="status" className="reveal flex flex-wrap items-center gap-x-2 text-sm text-zinc-300">
                          <span className="inline-flex items-start gap-1.5">
                            <EyeOff className="mt-0.5 size-4 shrink-0 text-zinc-400" aria-hidden="true" />
                            <span>{friendlyFieldName(field)} is left off this run{code ? `, so its ${code} won’t print. Some labels must have it by law` : ''}.</span>
                          </span>
                          <button type="button" className="link inline-flex min-h-control-sm items-center pl-5.5 sm:pl-0" onClick={() => putBack([field])}>Put it back</button>
                        </p>
                      );
                    })}
                    {inputMode === 'csv' && unmatchedShown.length > 0 && (
                      <div role="status" className="space-y-1 text-sm">
                        <p className="flex items-start gap-1.5 font-medium text-amber-300">
                          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                          No column for {unmatchedShown.map((f) => friendlyFieldName(f)).join(unmatchedShown.length === 2 ? ' and ' : ', ')}
                        </p>
                        <p className="pl-5.5 text-zinc-400">Your file has: {csvHeaders.join(', ') || 'no headings'}. Pick a column for each below, choose &ldquo;Same on every label&rdquo; and type one value, or leave {unmatchedShown.length === 1 ? 'it' : 'them'} off this run.</p>
                        <div className="flex flex-wrap gap-2 pl-5.5 pt-1">
                          {unmatchedShown.map((field) => (
                            <button key={field} type="button" className="btn btn-secondary btn-sm max-sm:min-h-11" onClick={() => leaveOffFromNotice(field)}>
                              <EyeOff className="size-4" aria-hidden="true" /> Leave {friendlyFieldName(field)} off
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="space-y-4">
                      {dynamicFields.map((field) => {
                        const mapping = fieldMappings[field] ?? { mode: 'static' };
                        const risk = sameRisks.find((r) => r.field === field);
                        return (
                          <div key={field} className={risk ? 'pl-3 shadow-[inset_2px_0_0_var(--color-amber-500)]' : undefined}>
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                              <div id={`${formId}-map-${field}`} className="w-40 shrink-0 text-sm font-medium text-zinc-100 break-words">{friendlyFieldName(field)}</div>
                              <div role="radiogroup" aria-labelledby={`${formId}-map-${field}`} className="segmented map-mode w-full sm:w-auto sm:shrink-0">
                                <SegmentedIndicator index={mapping.mode === 'column' ? 1 : 0} count={2} />
                                <button
                                  type="button"
                                  role="radio"
                                  aria-checked={mapping.mode === 'static'}
                                  onClick={() => {
                                    if (mapping.mode === 'column' && mapping.csvColumn) setLastColumns((c) => ({ ...c, [field]: mapping.csvColumn as string }));
                                    setFieldMappings((m) => ({ ...m, [field]: { mode: 'static' } }));
                                  }}
                                  data-active={mapping.mode === 'static'}
                                >
                                  Same on every label
                                </button>
                                <button
                                  type="button"
                                  role="radio"
                                  aria-checked={mapping.mode === 'column'}
                                  onClick={() => setFieldMappings((m) => ({ ...m, [field]: { mode: 'column', csvColumn: mapping.csvColumn || lastColumns[field] || findBestHeaderForField(field, rowHeaders, sourceData, codeTypes[field]) || '' } }))}
                                  data-active={mapping.mode === 'column'}
                                >
                                  {inputMode === 'manifest' ? 'From Nabis' : 'From spreadsheet'}
                                </button>
                              </div>
                              {mapping.mode === 'column' ? (
                                <div className="flex-1 min-w-0">
                                  <CustomSelect
                                    aria-label={`Column for ${friendlyFieldName(field)}`}
                                    placeholder="Choose a column…"
                                    value={mapping.csvColumn ?? ''}
                                    onChange={(v) => setFieldMappings((m) => ({ ...m, [field]: { mode: 'column', csvColumn: v } }))}
                                    options={inputMode === 'manifest' ? MANIFEST_FIELD_OPTIONS : rowHeaders.map((h) => ({ value: h, label: h }))}
                                  />
                                </div>
                              ) : (
                                <input
                                  type="text"
                                  aria-label={`${friendlyFieldName(field)} on every label`}
                                  value={staticValues[field] ?? ''}
                                  onChange={(e) => setStaticValues((s) => ({ ...s, [field]: e.target.value }))}
                                  placeholder="Type the one value every label gets"
                                  className="field flex-1 min-w-0"
                                />
                              )}
                            </div>
                            {risk && (
                              <div className="mt-2 space-y-1 text-sm sm:pl-43">
                                <p className="text-amber-300">
                                  Every label gets the same {friendlyFieldName(field)}{risk.value ? ` (${risk.value})` : ''}, but your {sheetWord} has {risk.everyRowDiffers ? `a different one on each row` : `${risk.distinct.toLocaleString()} different values`} in “{risk.column}”.{risk.scannable ? ' Each product usually needs its own barcode.' : ''}
                                </p>
                                {risk.field === sameRisks[sameRisks.length - 1].field && (
                                  <label className="flex min-h-11 items-center gap-3 text-zinc-100">
                                    <input type="checkbox" className="check" checked={sameConfirmedKey === sameRiskKey} onChange={(e) => setSameConfirmedKey(e.target.checked ? sameRiskKey : '')} />
                                    <span>Yes, print the same {sameRisks.map((r) => friendlyFieldName(r.field)).join(' and ')} on every label</span>
                                  </label>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Paste mode: the other fields print one typed value. */}
                {inputMode === 'paste' && staticFieldNames.filter((f) => f !== pasteField).length > 0 && (
                  <div className="space-y-3 pt-2">
                    <h3 className="text-sm font-semibold text-zinc-100">Same on every label</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {staticFieldNames.filter((f) => f !== pasteField).map((f) => (
                        <div key={f}>
                          <label htmlFor={`${formId}-static-${f}`} className="field-label mb-1.5">{friendlyFieldName(f)}</label>
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
                  </div>
                )}

                {/* Leaving a part off this run: nothing prints there (the run's
                    design leaves its items out; the shared design doesn't change). */}
                <details className="group text-sm" open={leftOffFields.size > 0 || undefined}>
                  <summary className="flex min-h-control-sm cursor-pointer list-none items-center gap-1.5 text-zinc-400 hover:text-zinc-100 [&::-webkit-details-marker]:hidden">
                    <ChevronRight className="size-4 shrink-0 transition-transform duration-200 ease-out group-open:rotate-90" aria-hidden="true" />
                    Leave a part off this run{leftOffFields.size > 0 ? ` (${leftOffFields.size} left off)` : ''}
                  </summary>
                  <div className="flex flex-wrap gap-2 pt-2">
                    {allDynamicFields.map((field) => {
                      const byNabis = !hiddenRunFieldSet.has(field) && leftOffFields.has(field);
                      const hidden = leftOffFields.has(field);
                      return (
                        <button
                          key={field}
                          type="button"
                          onClick={() => (byNabis ? setNabisGapOkKey('') : toggleRunFieldVisibility(field))}
                          title={byNabis ? `Left off because Nabis didn’t send it. Select to fill ${friendlyFieldName(field)} again` : hidden ? `Fill ${friendlyFieldName(field)} in this run` : `Leave ${friendlyFieldName(field)} off this run`}
                          aria-pressed={!hidden}
                          className={`btn btn-sm ${hidden ? 'btn-ghost text-zinc-400 line-through' : 'btn-secondary'}`}
                        >
                          <IconSwap on={!hidden} onIcon={<Eye className="size-4" />} offIcon={<EyeOff className="size-4" />} />
                          <span>{friendlyFieldName(field)}</span>
                        </button>
                      );
                    })}
                  </div>
                  <p className="pt-2 text-zinc-400">{leftOffFields.size > 0 ? `Nothing prints where ${andList(Array.from(leftOffFields).map((field) => friendlyFieldName(field)))} would go. The design itself doesn’t change.` : 'A part you leave off prints nothing on this run. The design itself doesn’t change.'}</p>
                </details>
              </section>

              {/* Review — always shown once a label size is known; with no
                  data yet it shows the design's sample text. */}
              {format && (
                <section id={REVIEW_ID} className="card card-flat scroll-mt-20 p-4 sm:p-5 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 id={`${REVIEW_ID}-title`} tabIndex={-1} className="text-base font-semibold text-zinc-100 outline-none">Review</h2>
                    {labelCount > 0 ? (
                      <div className="flex items-center gap-2 text-sm">
                        <button
                          onClick={() => setPreviewIndex(Math.max(0, feedStart - across))}
                          disabled={feedStart === 0}
                          className="btn btn-secondary btn-sm"
                        >
                          Previous
                        </button>
                        <span className="text-zinc-400 tabular-nums" aria-live="polite">
                          {across > 1 && labelCount > 1
                            ? <>Labels {feedStart + 1}–{Math.min(feedStart + across, labelCount)} of {labelCount.toLocaleString()}{inputMode === 'csv' && <span className="max-sm:hidden"> · rows {sheetRowOf(feedStart)}–{sheetRowOf(Math.min(feedStart + across, labelCount) - 1)}</span>}</>
                            : <>Label {previewIndex + 1} of {labelCount.toLocaleString()}{inputMode === 'csv' && <span className="max-sm:hidden"> · row {sheetRowOf(previewIndex)}</span>}</>}
                        </span>
                        <button
                          onClick={() => setPreviewIndex(Math.min(labelCount - 1, feedStart + across))}
                          disabled={feedStart + across > labelCount - 1}
                          className="btn btn-secondary btn-sm"
                        >
                          Next
                        </button>
                      </div>
                    ) : (
                      <span className="text-sm text-zinc-400">Showing the design’s sample text</span>
                    )}
                  </div>
                  <div className="flex justify-center">
                    {format.type === 'sheet' ? (
                      // Sheets don't go through the printer language: show
                      // the sheet grid the way it will print.
                      <LayoutPreview
                        thermalRenderMode={template.thermalRenderMode}
                        format={format}
                        elements={(previewBlanks.template ?? template).elements}
                        testData={previewValues}
                        testDataByLabel={sheetPreviewValues}
                        selectedLabelOffset={selectedSheetLabelOffset}
                      />
                    ) : (
                      <LocalZplPreview state={previewState} message={previewMessage} hint={shownBadBarcode ? '' : undefined} format={format} blanks={previewUndrawn ? [...previewBlanks.boxes, ...previewUndrawn.boxes] : previewBlanks.boxes} />
                    )}
                  </div>
                  {previewUndrawn && format.type === 'thermal' && (
                    // What the striped box means, for the eye only: the problem itself is
                    // read out once, from the list under the picture.
                    <p aria-hidden="true" className="text-center text-sm text-zinc-400">
                      {previewUndrawn.boxes.length ? 'The striped box is the barcode that can’t be drawn (see below).' : 'A barcode on this label can’t be drawn (see below).'}
                    </p>
                  )}
                  {manualUntyped ? (
                    <p className="text-center text-sm text-zinc-400">Type the values above to see them on the label.</p>
                  ) : previewBlanks.emptyFields.length > 0 && (
                    <p className="text-center text-sm text-zinc-400">
                      {andList(previewBlanks.emptyFields.map((field) => friendlyFieldName(field)))} {previewBlanks.emptyFields.length === 1 ? 'has' : 'have'} no value on {across > 1 || format.type === 'sheet' ? 'these labels' : 'this label'}, so {previewBlanks.emptyFields.length === 1 ? 'it’s' : 'they’re'} shown empty{previewBlanks.boxes.length ? ' (striped)' : ''}.
                    </p>
                  )}
                  <div className="space-y-4">
                    {nabisGap.labels.length > 0 && (
                      <div role="alert" className="space-y-1 text-sm">
                        <p className="flex items-start gap-1.5 text-zinc-100">
                          <AlertCircle className="mt-0.5 size-4 shrink-0 text-red-400" aria-hidden="true" />
                          <span>Nabis didn’t send the {nabisGapWhat} for {labelsWords(nabisGap.labels, manifestSelectedRows.length)}.{nabisGap.missing.includes('retailIds') ? ' Without retail IDs the package prints as one label, not one per unit.' : ''} Search again in a moment, or {nabisGapFields.length ? `leave ${andList(nabisGapFields.map((field) => friendlyFieldName(field)))} off this run` : 'print without them'}.</span>
                        </p>
                        <div className="flex flex-wrap items-center gap-x-4 pl-5.5">
                          <button type="button" className="btn btn-secondary btn-sm max-sm:min-h-11" disabled={isSearchingManifest || manifestSearch.trim().length < 2} onClick={() => void handleManifestSearch()}>
                            <RotateCcw className="size-4" aria-hidden="true" /> {isSearchingManifest ? 'Searching' : 'Search again'}
                          </button>
                          <label className="press flex min-h-11 w-fit cursor-pointer items-center gap-3 text-zinc-100">
                            <input type="checkbox" className="check" checked={nabisGapOkKey === nabisGap.signature} onChange={(e) => setNabisGapOkKey(e.target.checked ? nabisGap.signature : '')} />
                            <span>{nabisGapFields.length ? `Leave ${andList(nabisGapFields.map((field) => friendlyFieldName(field)))} off and print` : `Print ${nabisGap.labels.length === 1 ? 'it' : 'them'} without the ${nabisGapWhat}`}</span>
                          </label>
                        </div>
                      </div>
                    )}
                    {hasData && template && !nabisCoversBlanks && !manualUntyped && (
                      <BlankSummary
                        check={blankCheck}
                        mode={inputMode}
                        leaveBlank={leaveBlank}
                        onLeaveBlankChange={(value) => setBlankChoice(value ? 'blank' : '')}
                        skipCount={skippable?.length ?? 0}
                        choice={blankChoiceNow}
                        onChoiceChange={setBlankChoice}
                        sheetRow={(label) => label + (fileInfo?.headerRow ?? 1)}
                        showWhenOk={!keptRows && barcodesClear && charactersOk && examplesOk && sameOk && !barcodeCheck.warnings.length && !currencyRisks.length && !layoutIssues.length}
                      />
                    )}
                    {skipRows && skippable && (
                      <p className="text-sm text-zinc-400">
                        {inputMode === 'csv' ? (skippable.length === 1 ? 'Row' : 'Rows') : (skippable.length === 1 ? 'Label' : 'Labels')} {(() => { const shown = skippable.slice(0, 5).map((i) => String(inputMode === 'csv' ? i + 1 + (fileInfo?.headerRow ?? 1) : i + 1)); return skippable.length > 5 ? `${shown.join(', ')} and ${(skippable.length - 5).toLocaleString()} more` : andList(shown); })()} {skippable.length === 1 ? 'is' : 'are'} left out, so this run has {labelCount.toLocaleString()} label{labelCount === 1 ? '' : 's'}, numbered from 1 again.{inputMode === 'csv' ? ' Each label shows its spreadsheet row.' : ''}
                      </p>
                    )}
                    {hiddenClean.fixes.length > 0 && (
                      <p role="status" className="flex items-start gap-1.5 text-sm text-zinc-400">
                        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-400" aria-hidden="true" />
                        <span>{hiddenClean.fixes.length === 1
                          ? `Removed a hidden ${hiddenClean.fixes[0].tab ? 'tab' : 'character'} from label ${hiddenClean.fixes[0].label}’s ${friendlyFieldName(hiddenClean.fixes[0].field)}.`
                          : `Removed hidden tabs or characters from ${hiddenClean.fixes.length.toLocaleString()} values (${labelsWords(Array.from(new Set(hiddenClean.fixes.map((fix) => fix.label))), allDataRows.length)}).`}</span>
                      </p>
                    )}
                    {skipChars && (
                      <p className="text-sm text-zinc-400">
                        {labelsWords(charSkipped.map((index) => index + 1), allDataRows.length).replace(/^l/, 'L')} {charSkipped.length === 1 ? 'is' : 'are'} left out because of characters that can’t print, so this run has {labelCount.toLocaleString()} label{labelCount === 1 ? '' : 's'}.{' '}
                        <button type="button" className="link" onClick={() => setCharSkip({ key: '', indexes: [] })}>Undo</button>
                      </p>
                    )}
                    {charTwoLists && charKeepsSome(charAllLeft) && (
                      <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-zinc-300">
                        <span>{charAllLeft.length.toLocaleString()} labels have characters that can’t print.</span>
                        <button type="button" className="btn btn-secondary btn-sm max-w-full whitespace-normal text-left max-sm:min-h-11 max-sm:py-2" onClick={() => leaveCharsOut(charAllLeft)}>Leave all {charAllLeft.length.toLocaleString()} out and print the other {(allDataRows.length - charSkipped.length - charAllLeft.length).toLocaleString()}</button>
                      </div>
                    )}
                    <LongValueWarning
                      fields={longFields}
                      labels={longLeft}
                      total={allDataRows.length}
                      rest={labelCount - longLeft.length}
                      mode={inputMode}
                      stops={longStops}
                      onLeaveOut={leaveLongOut}
                      sheetRow={inputMode === 'csv' ? (index) => index + 1 + (fileInfo?.headerRow ?? 1) : undefined}
                      designHref={template ? designerFixHref(template.id, barcodeCheck.issues.find((issue) => isLongValueIssue(issue, longRows))?.elementId) : undefined}
                      ticked={longTickKey === longLeftKey}
                      onTick={(value) => setLongTickKey(value ? longLeftKey : '')}
                    />
                    {longSkipped.length > 0 && (
                      <p className="text-sm text-zinc-400">
                        {longLabelWords(longSkipped.map((index) => index + 1), allDataRows.length).replace(/^l/, 'L')} {longSkipped.length === 1 ? 'is' : 'are'} left out because {longRows.fields.length === 1 ? `${longSkipped.length === 1 ? 'its' : 'their'} ${friendlyFieldName(longRows.fields[0].field)} ${longSkipped.length === 1 ? 'is' : 'values are'}` : longSkipped.length === 1 ? 'its value is' : 'their values are'} too long for the barcode, so this run has {labelCount.toLocaleString()} label{labelCount === 1 ? '' : 's'}.{' '}
                        <button type="button" className="link" onClick={() => setLongSkip({ key: '', indexes: [] })}>Undo</button>
                      </p>
                    )}
                    <BarcodeWarning
                      items={barcodeItems}
                      stops={barcodeWords.stops}
                      stopWords={barcodeWords.fixIn === 'data' ? (barcodeCheck.badLabels === 1 ? 'The printer can’t draw that barcode, so that label can’t print.' : 'The printer can’t draw those barcodes, so those labels can’t print.') : stopFixWords(barcodeWords.fixIn)}
                      isTicked={barcodeItemTicked}
                      onTick={tickBarcodeItem}
                      fix={<>
                        {barcodeFixes?.fix && (
                          <button type="button" className="btn btn-primary btn-sm max-sm:min-h-11" disabled={runFixBusy || qrBusy} onClick={() => void (barcodeFixes.fix!.kind === 'qr' ? switchToQrCopy(barcodeFixes.fix!) : applyRunFix(barcodeFixes.fix!, barcodeFixes.elementId))}>{barcodeFixes.fix.label}</button>
                        )}
                        {!barcodeFixes?.fix && barcodeFixes?.qr && (
                          // A QR code changes what the label is: made in a copy for this run, never the saved design.
                          <button type="button" className="btn btn-secondary btn-sm max-sm:min-h-11" disabled={runFixBusy || qrBusy} onClick={() => void switchToQrCopy(barcodeFixes.qr!)}>{qrBusy ? 'Making a copy…' : barcodeFixes.qr.label}</button>
                        )}
                        {barcodeWords.fixIn !== 'data' && template && (
                          <FixInDesignerLink href={designerFixHref(template.id, designIssues.find((issue) => issue.elementId)?.elementId)} />
                        )}
                        {barcodeWords.fixIn !== 'design' && charBarcodeButton && leaveOutButton(charBarcodeLeft)}

                      </>}
                    />
                    {runFixNote && template && runFixNote.templateId === template.id && (
                      <p role="status" className={`fold-reveal flex flex-wrap items-center gap-x-3 text-sm ${runFixNote.tone === 'ok' ? 'text-emerald-400' : 'text-red-300'}`}>
                        <span>{runFixNote.text}</span>
                        {runFixNote.tone === 'ok' && <button type="button" className="link inline-flex min-h-11 items-center" disabled={runFixBusy} onClick={() => void undoRunFix()}>Undo</button>}
                      </p>
                    )}
                    <ProblemList
                      heading="Barcodes close to the edge"
                      items={tightGroups.items}
                      more={tightGroups.more}
                    />
                    {currencyRisks.length > 0 && (
                      <div role="status" className="space-y-2 text-sm">
                        <p className="flex items-start gap-1.5 font-medium text-amber-300"><AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />The price sign would print twice</p>
                        <ul className="space-y-2 pl-5.5">
                          {currencyRisks.map((risk) => (
                            <li key={risk.field} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                              <span className="text-zinc-300">{friendlyFieldName(risk.field)} prints “{risk.printed}”: the design adds “{risk.symbol}” and your “{risk.column}” column already has one.</span>
                              <button type="button" className="btn btn-secondary btn-sm shrink-0 self-start sm:self-auto" onClick={() => setPlainNumberFields((list) => [...list, risk.field])}>Print “{risk.plain}”</button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {plainNumberFields.filter((f) => visibleFieldSet.has(f)).map((field) => (
                      <p key={field} className="text-sm text-zinc-400">
                        {friendlyFieldName(field)} prints the number without its “$” from your spreadsheet.{' '}
                        <button type="button" className="link" onClick={() => setPlainNumberFields((list) => list.filter((f) => f !== field))}>Undo</button>
                      </p>
                    ))}
                    <ProblemList
                      tone="error"
                      heading={`${characterCheck.badLabels.toLocaleString()} label${characterCheck.badLabels === 1 ? ' has' : 's have'} characters the printer can’t print`}
                      items={characterSummary.items}
                      more={characterSummary.more}
                      actions={<>
                        {charTextButton && leaveOutButton(charTextLeft)}
                        {characterCheck.issues.some((issue) => !issue.label) && template && <FixInDesignerLink href={designerFixHref(template.id)} />}
                        {lastFile.current && characterCheck.issues.some((issue) => fieldIsFromSheet(issue.field)) && <span className="text-zinc-400">Or fix them in your spreadsheet, then use “Choose another file” at the top.</span>}
                      </>}
                      confirmLabel="Print anyway: those characters come out as junk"
                      confirmed={characterGoAheadKey === characterKey}
                      onConfirmedChange={(value) => setCharacterGoAheadKey(value ? characterKey : '')}
                    />
                    <ProblemList
                      heading="Some items overlap or run off the label"
                      items={layoutIssues.slice(0, 5)}
                      more={layoutIssues.length - Math.min(5, layoutIssues.length)}
                      confirmLabel={LAYOUT_GO_AHEAD}
                      confirmed={layoutConfirmedKey === layoutKey}
                      onConfirmedChange={(value) => setLayoutConfirmedKey(value ? layoutKey : '')}
                    />
                  </div>
                </section>
              )}

              <details className="group text-sm">
                <summary className="flex min-h-control-sm cursor-pointer list-none items-center gap-1.5 font-medium text-zinc-300 hover:text-zinc-100 [&::-webkit-details-marker]:hidden"><ChevronRight className="size-4 shrink-0 transition-transform duration-200 ease-out group-open:rotate-90" aria-hidden="true" />Save these settings for next time</summary>
                <div className="flex items-center gap-2 pt-3">
                  <input
                    type="text"
                    value={saveAsPresetName}
                    onChange={(e) => setSaveAsPresetName(e.target.value)}
                    aria-label="Preset name"
                    placeholder="Name, e.g. Weekly flower bags"
                    className="field flex-1"
                  />
                  <button
                    onClick={handleSaveAsPreset}
                    disabled={!saveAsPresetName.trim() || !template}
                    className="btn btn-secondary"
                  >
                    Save
                  </button>
                </div>
              </details>
              <div ref={footerRef} className="fixed inset-x-0 bottom-0 z-30 bg-zinc-950 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                <div className="page-container flex flex-col gap-3 py-0 sm:flex-row sm:items-center sm:justify-between sm:py-0 lg:py-0">
                  <div className="min-w-0 max-sm:hidden">
                    <p className="truncate text-sm text-zinc-400">
                      <span className="font-semibold text-zinc-100">{name.trim() || 'Untitled run'}</span> · {template?.name || 'No design chosen'}
                    </p>
                  </div>
                  <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                    {createRunError ? (
                      <p role="alert" className="flex items-start gap-1.5 text-sm text-red-400 sm:max-w-md">
                        <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> {createRunError}
                      </p>
                    ) : blockReasons.length && !isCreatingRun ? (
                      <WaitReasons reasons={blockReasons} />
                    ) : null}
                    <button
                      onClick={handleSaveAndPrint}
                      disabled={!canCreate || !previewReady || isCreatingRun}
                      className="btn btn-primary w-full shrink-0 sm:w-auto"
                    >
                      <Play className="size-4" aria-hidden="true" /> {isCreatingRun ? 'Starting…' : `Start run (${labelCount.toLocaleString()} label${labelCount === 1 ? '' : 's'})`}
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
      {/* Inline 'New design' dialog. On submit we create the design,
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
            router.push(`/designer?id=${t.id}&returnTo=${encodeURIComponent('/runs/new')}`);
          }
        }}
      />
    </AppShell>
  );
}

// Inline ZPL preview via zpl-renderer-js WASM: exactly what the printer
// makes, so label edges are off unless asked for (rolls with 2+ across).
function LocalZplPreview({ state, message, hint = 'Fix the value or the design, then check again.', format, blanks = [] }: { state: RunPreviewState; message?: string; hint?: string; format: { width: number; height: number; dpi?: number; type: string; labelsAcross?: number; horizontalGapThermal?: number; sideMarginThermal?: number; linerWidth?: number }; blanks?: ReadonlyArray<PreviewBlankBox> }) {
  const [showEdges, setShowEdges] = useState(false);
  // Big labels (4" × 6") shrink to fit the page; "Zoom in" shows them at
  // print size so small text can be checked, scrolling inside the frame.
  const [zoomed, setZoomed] = useState(false);
  if (state.status === 'error') return <p role="alert" className="text-sm text-red-400">{message || state.message}{hint ? ` ${hint}` : ''}</p>;
  if (state.status === 'loading') return <p role="status" className="text-sm text-zinc-400">Drawing the label…</p>;
  if (state.status === 'empty') return <p className="text-sm text-zinc-400">Nothing would print. Check the design and data.</p>;
  const across = (format.labelsAcross ?? 1) > 1;
  const canZoom = format.height > 1.5 || format.width * (format.labelsAcross ?? 1) > 3;
  // LabelOutlineOverlay needs the full LabelFormat shape; it only reads the
  // thermal fields this prop guarantees.
  return (
    <div className="flex w-full flex-col items-center gap-2">
      <div className={zoomed ? 'max-h-[70vh] w-full overflow-auto rounded-md' : 'contents'}>
        <div className={`relative ${zoomed ? 'mx-auto w-fit' : 'inline-block'}`}>
          <img
            src={state.url}
            alt="Label preview"
            className="rounded-md bg-white"
            style={{ imageRendering: 'pixelated', display: 'block', ...(zoomed ? { width: `${Math.round((format.linerWidth || format.width * (format.labelsAcross ?? 1)) * 96)}px`, maxWidth: 'none' } : { maxWidth: '100%', maxHeight: '420px' }) }}
          />
          {blanks.length > 0 && <EmptyPartsOverlay format={format} blanks={blanks} />}
          {showEdges && across && (
            <LabelOutlineOverlay format={format as unknown as import('@/lib/types').LabelFormat} />
          )}
        </div>
      </div>
      {(across || canZoom) && (
        <div className="flex flex-wrap justify-center gap-1">
          {canZoom && <button type="button" aria-pressed={zoomed} onClick={() => setZoomed((v) => !v)} className="btn btn-ghost btn-sm">{zoomed ? 'Fit to page' : 'Zoom in'}</button>}
          {across && <button type="button" aria-pressed={showEdges} onClick={() => setShowEdges((v) => !v)} className="btn btn-ghost btn-sm">{showEdges ? 'Hide label edges' : 'Show label edges'}</button>}
        </div>
      )}
    </div>
  );
}

/**
 * Striped boxes over the picture where a part has no value: that spot prints
 * nothing yet (the picture leaves out the design's sample). Positions use the
 * same lane math as the printer code, in printer dots.
 */
function EmptyPartsOverlay({ format, blanks }: { format: Parameters<typeof thermalRenderGeometry>[0]; blanks: ReadonlyArray<PreviewBlankBox> }) {
  const id = useId().replace(/:/g, '');
  const { labelWDots, heightDots, linerDots, effectiveSideMDots } = thermalRenderGeometry(format);
  const gapDots = Math.round((format.horizontalGapThermal || 0) * (format.dpi || 203));
  const stripe = Math.max(4, Math.round(Math.min(labelWDots, heightDots) / 40));
  return (
    <svg aria-hidden="true" className="pointer-events-none absolute inset-0 size-full" viewBox={`0 0 ${linerDots} ${heightDots}`} preserveAspectRatio="none">
      <defs>
        <pattern id={`${id}-hatch`} width={stripe * 2} height={stripe * 2} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width={stripe} height={stripe * 2} fill="#d97706" fillOpacity={0.35} />
        </pattern>
      </defs>
      {blanks.map((box, index) => (
        <rect key={index} x={effectiveSideMDots + box.lane * (labelWDots + gapDots) + box.x} y={box.y} width={box.width} height={box.height} fill={`url(#${id}-hatch)`} stroke="#d97706" strokeOpacity={0.7} strokeWidth={Math.max(1, stripe / 3)} strokeDasharray={`${stripe} ${stripe / 2}`} />
      ))}
    </svg>
  );
}

export default function NewRunPage() {
  return (
    <Suspense fallback={null}>
      <NewRunContent />
    </Suspense>
  );
}

/** The Review section, so a footer reason can take you to it. */
const REVIEW_ID = 'run-review';

/** “… in Review.” with “in Review” as a link that scrolls to it (the choices may be off screen). */
function ReasonText({ reason }: { reason: string }) {
  const at = reason.indexOf('in Review');
  if (at < 0) return <>{reason}</>;
  const goToReview = () => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.getElementById(REVIEW_ID)?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    document.getElementById(`${REVIEW_ID}-title`)?.focus({ preventScroll: true });
  };
  return <>{reason.slice(0, at)}<button type="button" className="link" onClick={goToReview}>in Review</button>{reason.slice(at + 'in Review'.length)}</>;
}

/**
 * Why Start is waiting, on one line: the reason itself when there is one,
 * else “3 things left” that opens the list above the footer.
 */
function WaitReasons({ reasons }: { reasons: string[] }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  useDismiss(open, () => setOpen(false), [listRef, toggleRef]);
  if (reasons.length === 1) {
    return (
      <p role="status" className="flex items-start gap-1.5 text-sm text-amber-300 sm:max-w-md">
        <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" /><span><ReasonText reason={reasons[0]} /></span>
      </p>
    );
  }
  return (
    <div role="status" className="relative text-sm">
      <button ref={toggleRef} type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)} className="press inline-flex min-h-11 items-center gap-1.5 text-amber-300 hover:text-amber-200">
        <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
        {reasons.length} things left before you can start
        <ChevronRight className={`size-4 shrink-0 transition-transform duration-200 ease-in-out motion-reduce:transition-none ${open ? '-rotate-90' : ''}`} aria-hidden="true" />
      </button>
      <PopLayer as="ul" ref={listRef} open={open} id={id} className="absolute bottom-full left-0 z-40 mb-2 w-[min(28rem,calc(100vw-2rem))] sm:left-auto sm:right-0 [--origin:bottom_right] space-y-2 rounded-lg bg-zinc-800 p-4 text-zinc-100 shadow-xl">
        {reasons.map((reason) => (
          <li key={reason} className="flex items-start gap-1.5"><Circle className="mt-1.5 size-2 shrink-0 fill-current text-amber-300" aria-hidden="true" /><span><ReasonText reason={reason} /></span></li>
        ))}
      </PopLayer>
    </div>
  );
}
