'use client';

import { readDrafts, type TemplateDraft } from '@/lib/templateDrafts';
import { useState, useEffect, useCallback, useRef, useMemo, Suspense, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useRubberBand } from '@/components/motion/rubberBand';
import { Undo2, Redo2, Pencil, ChevronLeft, Plus, CheckCircle2, Eye } from 'lucide-react';
import { SegmentedIndicator } from '@/components/ui/Segmented';
import { useTemplateStore } from '@/lib/templateStore';
import { useFormatStore } from '@/lib/store';
import { useGlobalElementStore } from '@/lib/globalStore';
import { arrangeElements, type AlignAction } from '@/lib/thermal/editorGeometry';
import { BitmapTemplateActions } from '@/components/designer/BitmapTemplateActions';
import { moveLayers, type LayerDirection } from '@/lib/designerLayers';
import { duplicateElementsForFormat } from '@/lib/templateScale';
import { useUndoStore } from '@/lib/undoStore';
import { ElementType, LabelTemplate, TemplateElement } from '@/lib/types';
import { AppShell } from '@/components/AppShell';
import { PageTitle } from '@/components/PageTitle';
import { LabelPreview, type InkOffset } from '@/components/designer/LabelPreview';
import { PropertyPanel } from '@/components/designer/PropertyPanel';
import { ElementList } from '@/components/designer/ElementList';
import { TemplateList, NewTemplateDialog, DuplicateTemplateDialog, RenameTemplateDialog } from '@/components/designer/TemplateList';
import { AddElementMenu } from '@/components/designer/AddElementMenu';
import { LayoutPreview } from '@/components/designer/LayoutPreview';
import { ZPLPreview } from '@/components/designer/ZPLPreview';
import { DesignNotice, problemText } from '@/components/designer/DesignNotice';
import { barcodePlainSentence } from '@/lib/runBarcodeTicks';
import { arcMove } from '@/components/motion/arc';
import { PrinterCodeDialog } from '@/components/designer/PrinterCodeDialog';
import { barcodeAutoFix, barcodeToQr, textAutoFix, type BarcodeAutoFix } from '@/lib/barcodeAutoFix';
import { TestDataPanel } from '@/components/designer/TestDataPanel';
import { GlobalSaveDialog } from '@/components/designer/GlobalSaveDialog';
import { GlobalElementPicker } from '@/components/designer/GlobalElementPicker';
import { CustomSelect } from '@/components/ui/CustomSelect';
import { safeNextPath } from '@/lib/safeRedirect';
import { freeSpot, itemName, layoutProblems, printedBounds, withAllEdges, type Box, type LayoutProblem } from '@/lib/designerLayout';
import { bitmapLayoutProblems, bitmapTextOverlaps } from '@/lib/bitmapLayout';
import { describeUnprintable, elementUnprintable, plainPrinterText, plainReplacement, usesPrinterFont } from '@/lib/printerCharacters';
import { designSampleValues } from '@/lib/sampleValues';
import { barcodeFitFix } from '@/lib/barcodeFit';
import { elementTypeName } from '@/lib/fieldLabels';
import { designSaveProblem } from '@/lib/userMessages';
import { choiceDialog } from '@/components/ui/feedback';

type NewTemplateElement = TemplateElement extends infer T
  ? T extends TemplateElement
    ? Omit<T, 'id' | 'zIndex'>
    : never
  : never;

type ThermalEditorOrientation = 'printer' | 'upright';

function designLabel(name?: string) {
  return name ? `‘${name}’` : 'this design';
}

function DesignerContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const templateId = searchParams.get('id');
  // Optional ?returnTo=/runs/<id> used by round-trip flows (e.g. "Tweak
  // template" from a run detail page). When present we swap the breadcrumb
  // for a 'Done' back button that sends the user home to where they started.
  // Only allow same-origin paths to avoid open-redirect mischief.
  // Resolved the way the browser would ("/\\evil.com" becomes another site),
  // against a stand-in origin: only a path on this site is kept.
  const returnTo = safeNextPath(searchParams.get('returnTo'), 'https://label-wrangler.invalid', '') || null;

  const {
    templates,
    selectedTemplateId,
    addTemplate,
    deleteTemplate,
    selectTemplate,
    getTemplateById,
    updateElementLocal,
    saveTemplate,
    updateTemplate,
  } = useTemplateStore();

  const { formats, getFormatById } = useFormatStore();
  const { globals, createGlobal, deleteGlobal } = useGlobalElementStore();
  const { push: pushUndo, rememberPast, undo, redo, setCurrent: setUndoCurrent, canUndo, canRedo, clear: clearUndo } = useUndoStore();

  const [showNewTemplateDialog, setShowNewTemplateDialog] = useState(false);
  const [duplicateSource, setDuplicateSource] = useState<LabelTemplate | null>(null);
  const [renameSource, setRenameSource] = useState<LabelTemplate | null>(null);
  const [showAddElementMenu, setShowAddElementMenu] = useState(false);
  const [showGlobalSave, setShowGlobalSave] = useState(false);
  const [showGlobalPicker, setShowGlobalPicker] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [thermalEditorOrientation, setThermalEditorOrientation] = useState<ThermalEditorOrientation>('printer');
  // Convenience: single selected element for property panel
  const selectedElementId = selectedIds.size === 1 ? Array.from(selectedIds)[0] : null;
  const [testData, setTestData] = useState<Record<string, string>>({});
  // Debounced save timer for arrow-key nudges so holding an arrow doesn't
  // hit the DB on every frame.
  const nudgeSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The design list scrolls with a little stretch at its ends (wheel/trackpad).
  const listScrollRef = useRef<HTMLDivElement>(null);
  useRubberBand(listScrollRef);

  // Sync template selection FROM the URL only (one-way). When users click the
  // Templates breadcrumb we update the URL first; this effect then clears the
  // store in sync. Using templateId ¦| null as the source of truth prevents
  // the old ping-pong where both directions were writing during the same
  // render and the store got re-set to the previously-selected id.
  useEffect(() => {
    const next = templateId || null;
    if (next !== selectedTemplateId) {
      selectTemplate(next);
    }
  }, [templateId, selectedTemplateId, selectTemplate]);

  const currentTemplate = selectedTemplateId ? getTemplateById(selectedTemplateId) : null;
  const currentFormat = currentTemplate ? getFormatById(currentTemplate.formatId) : null;
  const gesture = useRef<{ id: string; elements: TemplateElement[]; formatId: string } | null>(null);
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const [leftPanel, setLeftPanel] = useState<'layers' | 'data'>('layers');
  // Phones show one pane at a time (one row of tabs); large screens show all three.
  const [phonePane, setPhonePane] = useState<'label' | 'layers' | 'data' | 'edit'>('label');
  // One label at a time: the editing canvas, or exactly what the printer makes.
  const [view, setView] = useState<'edit' | 'exact'>('edit');
  // One zoom for both views (1 = fit), so switching views keeps the label still.
  const [zoomFor, setZoomFor] = useState<{ id: string | null; zoom: number }>({ id: null, zoom: 1 });
  const zoom = zoomFor.id === selectedTemplateId ? zoomFor.zoom : 1;
  const setZoom = useCallback((next: number) => setZoomFor({ id: selectedTemplateId, zoom: next }), [selectedTemplateId]);
  const [showCode, setShowCode] = useState(false);
  // "Fix it for me": what it changed, with Undo, until the next edit.
  const [fixNote, setFixNote] = useState<{ templateId: string; text: string; elements: TemplateElement[] } | null>(null);
  // Said once when a new item had to go on top of others (no clear space left).
  const [placeNotice, setPlaceNotice] = useState<{ id: string; x: number; y: number; text: string } | null>(null);
  const saveRevision = useRef(0);
  const unsavedChanges = useRef(false);
  const persistEdits = useCallback((id: string) => {
    const revision = ++saveRevision.current;
    setSaveError('');
    setSaving(true);
    unsavedChanges.current = true;
    void saveTemplate(id).then(() => {
      if (revision === saveRevision.current) unsavedChanges.current = false;
    }).catch(error => {
      if (revision === saveRevision.current) setSaveError(error.message);
    }).finally(() => { if (revision === saveRevision.current) setSaving(false); });
  }, [saveTemplate]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (unsavedChanges.current) event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);
  const trySave = async (): Promise<true | string | null> => {
    if (!currentTemplate) return true;
    const revision = ++saveRevision.current;
    try {
      setSaving(true);
      unsavedChanges.current = true;
      await saveTemplate(currentTemplate.id);
      if (revision !== saveRevision.current) return null;
      setSaving(false);
      setSaveError('');
      unsavedChanges.current = false;
      return true;
    } catch (error) {
      if (revision !== saveRevision.current) return null;
      setSaving(false);
      setSaveError((error as Error).message);
      return (error as Error).message || 'Failed';
    }
  };
  // Leaving with a change that won't save: ask, never just stay put.
  const saveBeforeLeaving = async (): Promise<boolean> => {
    if (!currentTemplate || (!unsavedChanges.current && !gesture.current)) return true;
    for (;;) {
      const saved = await trySave();
      if (saved === null) return false;
      if (saved === true) return true;
      const template = useTemplateStore.getState().getTemplateById(currentTemplate.id) ?? currentTemplate;
      const choice = await choiceDialog({
        title: 'Your last change isn’t saved',
        body: designSaveProblem(saved, template.elements),
        confirmLabel: 'Try saving again',
        altLabel: 'Save as a copy',
        extraLabel: 'Leave without it',
      });
      if (choice === 'confirm') continue;
      if (choice === 'alt') {
        try {
          await addTemplate({ name: `${template.name} (copy)`, description: template.description, formatId: template.formatId, elements: template.elements, thermalRenderMode: template.thermalRenderMode });
          unsavedChanges.current = false;
          return true;
        } catch (error) { setSaveError((error as Error).message); continue; }
      }
      if (choice === 'extra') { unsavedChanges.current = false; return true; }
      return false;
    }
  };
  const leaveEditor = async () => { if (await saveBeforeLeaving()) router.push(returnTo ?? '/designer'); };
  const commitEdit = useCallback((updates: Pick<LabelTemplate, 'elements'> & Partial<Pick<LabelTemplate, 'formatId'>>) => {
    const before = currentTemplate && useTemplateStore.getState().getTemplateById(currentTemplate.id);
    if (!before || (updates.elements === before.elements && (!updates.formatId || updates.formatId === before.formatId))) return;
    pushUndo(before.id, before.elements, before.formatId);
    useTemplateStore.setState(state => ({ templates: state.templates.map(t => t.id === before.id ? { ...t, ...updates } : t) }));
    persistEdits(before.id);
  }, [currentTemplate, pushUndo, persistEdits]);
  const beginGesture = useCallback(() => {
    const t = currentTemplate && useTemplateStore.getState().getTemplateById(currentTemplate.id);
    if (t && !gesture.current) gesture.current = { id: t.id, elements: structuredClone(t.elements), formatId: t.formatId };
  }, [currentTemplate]);
  const finishGesture = useCallback(() => {
    const before = gesture.current; gesture.current = null;
    if (!before) return;
    const after = useTemplateStore.getState().getTemplateById(before.id);
    if (!after || JSON.stringify(before.elements) === JSON.stringify(after.elements)) return;
    pushUndo(before.id, before.elements, before.formatId);
    persistEdits(before.id);
  }, [pushUndo, persistEdits]);
  const cancelGesture = useCallback(() => {
    const before = gesture.current; gesture.current = null;
    if (before) useTemplateStore.setState(state => ({ templates: state.templates.map(t => t.id === before.id ? { ...t, elements: before.elements } : t) }));
  }, []);
  useEffect(() => {
    if (!currentTemplate?.id) return;
    try { setTestData(JSON.parse(localStorage.getItem(`lw:test-data:${currentTemplate.id}`) || '{}')); } catch { setTestData({}); }
  }, [currentTemplate?.id]);
  // "Readable" only means something when text is printed sideways: it turns
  // the view so that text reads left to right.
  const sidewaysText = useMemo(() => {
    const texts = currentTemplate?.summaryOnly ? [] : (currentTemplate?.elements ?? []).filter((e) => e.type === 'text');
    const turn = (e: TemplateElement) => (((Math.round(e.rotation || 0) % 360) + 360) % 360);
    return { ccw: texts.filter((e) => turn(e) === 90).length, cw: texts.filter((e) => turn(e) === 270).length };
  }, [currentTemplate]);
  const showThermalOrientationPicker = currentFormat?.type === 'thermal' && (sidewaysText.ccw + sidewaysText.cw) > 0;
  const uprightTurn: 'ccw' | 'cw' = sidewaysText.cw > sidewaysText.ccw ? 'cw' : 'ccw';
  const thermalEditorOrientationKey = currentTemplate
    ? `label-wrangler:thermal-editor-orientation:${currentTemplate.id}`
    : null;

  useEffect(() => {
    if (!thermalEditorOrientationKey) {
      setThermalEditorOrientation('printer');
      return;
    }
    const saved = window.localStorage.getItem(thermalEditorOrientationKey);
    if (saved === 'printer' || saved === 'upright') {
      setThermalEditorOrientation(saved);
    } else {
      setThermalEditorOrientation('printer');
    }
  }, [thermalEditorOrientationKey]);

  const updateThermalEditorOrientation = useCallback((orientation: ThermalEditorOrientation) => {
    setThermalEditorOrientation(orientation);
    if (thermalEditorOrientationKey) {
      window.localStorage.setItem(thermalEditorOrientationKey, orientation);
    }
  }, [thermalEditorOrientationKey]);

  // Undo handler
  const handleUndo = useCallback(() => {
    if (!currentTemplate || !canUndo()) return;
    const prev = undo();
    if (prev) {
      // Save current state for redo
      setUndoCurrent(currentTemplate.id, currentTemplate.elements, currentTemplate.formatId);
      // Apply previous state
      const updatedElements = prev.elements;

      // Update local store
      useTemplateStore.setState((state) => ({
        templates: state.templates.map((t) =>
          t.id === currentTemplate.id ? { ...t, elements: updatedElements, formatId: prev.formatId ?? t.formatId } : t
        ),
      }));
      persistEdits(currentTemplate.id);
    }
  }, [persistEdits, currentTemplate, undo, setUndoCurrent, canUndo]);

  // Redo handler
  const handleRedo = useCallback(() => {
    if (!currentTemplate || !canRedo()) return;
    const next = redo();
    if (next) {
      rememberPast(currentTemplate.id, currentTemplate.elements, currentTemplate.formatId);
      const updatedElements = next.elements;

      useTemplateStore.setState((state) => ({
        templates: state.templates.map((t) =>
          t.id === currentTemplate.id ? { ...t, elements: updatedElements, formatId: next.formatId ?? t.formatId } : t
        ),
      }));
      persistEdits(currentTemplate.id);
    }
  }, [persistEdits, currentTemplate, redo, rememberPast, canRedo]);

  // Keyboard shortcuts: Ctrl+Z / Ctrl+Shift+Z (or Cmd on Mac), + arrow key nudging.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Skip if typing in an input/textarea/contentEditable so property panel,
      // text area edits, etc. aren't hijacked.
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || t?.isContentEditable) {
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault();
        handleRedo();
        return;
      }

      // Focused menus and controls own their arrow keys; layer selections
      // retain arrow-key nudging for keyboard-only editing.
      if (t?.closest('button,a,summary,[role="combobox"],[role="listbox"]') && !t.closest('[data-layer-id]')) return;
      // Arrow key nudge for selected element(s).
      const arrowMap: Record<string, { dx: number; dy: number }> = {
        ArrowLeft: { dx: -1, dy: 0 },
        ArrowRight: { dx: 1, dy: 0 },
        ArrowUp: { dx: 0, dy: -1 },
        ArrowDown: { dx: 0, dy: 1 },
      };
      const arrow = arrowMap[e.key];
      // Print preview shows the printout, not the items: nothing moves there.
      const previewing = view === 'exact' && currentFormat?.type === 'thermal';
      if (arrow && currentTemplate && selectedIds.size > 0 && !previewing) {
        e.preventDefault();
        // Step: 0.01" (the smallest change the panel shows). Shift → 0.1".
        const isThermal = currentFormat?.type === 'thermal';
        const baseStep = isThermal ? (currentFormat.dpi || 203) / 100 : 0.01;
        const step = (e.shiftKey ? 10 : 1) * baseStep;
        beginGesture();
        const upright = isThermal && thermalEditorOrientation === 'upright' && showThermalOrientationPicker;
        const direction = upright ? (uprightTurn === 'cw' ? { dx: arrow.dy, dy: -arrow.dx } : { dx: -arrow.dy, dy: arrow.dx }) : arrow;
        for (const id of selectedIds) {
          const el = useTemplateStore.getState().getTemplateById(currentTemplate.id)?.elements.find((x) => x.id === id);
          if (!el || el.locked) continue;
          const round = (v: number) => (isThermal ? Math.round(v * 100) / 100 : Math.round(v * 1000) / 1000);
          updateElementLocal(currentTemplate.id, id, {
            x: round(el.x + direction.dx * step),
            y: round(el.y + direction.dy * step),
          });
        }
        // Debounce save to avoid hammering the DB on held arrow keys.
        if (nudgeSaveRef.current) clearTimeout(nudgeSaveRef.current);
        nudgeSaveRef.current = setTimeout(() => {
          finishGesture();
        }, 400);
      }
    };
    const finishNudge = (e: KeyboardEvent) => { if (e.key.startsWith('Arrow')) { if (nudgeSaveRef.current) clearTimeout(nudgeSaveRef.current); finishGesture(); } };
    window.addEventListener('keydown', handler); window.addEventListener('keyup', finishNudge);
    return () => { window.removeEventListener('keydown', handler); window.removeEventListener('keyup', finishNudge); };
  }, [handleUndo, handleRedo, currentTemplate, currentFormat, selectedIds, updateElementLocal, saveTemplate, beginGesture, finishGesture, thermalEditorOrientation, showThermalOrientationPicker, uprightTurn, view]);

  // Clear undo history + selection when switching templates
  useEffect(() => {
    clearUndo();
    setSelectedIds(new Set());
    saveRevision.current++;
    unsavedChanges.current = false;
    setSaveError('');
    setSaving(false);
  }, [selectedTemplateId, clearUndo]);
  // "Fix in the designer" links name the item to fix (?select=<id>): select it once it has loaded.
  const selectParam = searchParams.get('select');
  const selectedFromLink = useRef('');
  const linkTemplateReady = !!currentTemplate && !currentTemplate.summaryOnly && currentTemplate.id === templateId;
  useEffect(() => {
    if (!selectParam || !linkTemplateReady || !templateId) return;
    const key = `${templateId}:${selectParam}`;
    if (selectedFromLink.current === key) return;
    selectedFromLink.current = key;
    if (useTemplateStore.getState().getTemplateById(templateId)?.elements.some((e) => e.id === selectParam)) {
      setSelectedIds(new Set([selectParam]));
      setPhonePane('edit');
    }
  }, [selectParam, linkTemplateReady, templateId]);

  const [recovery, setRecovery] = useState<Array<TemplateDraft & {key:string}>>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    let active = true;
    fetch('/api/office/session').then((r) => (r.ok ? r.json() : null)).then((d) => { if (active) setIsAdmin(!!d?.user?.is_admin); }).catch(() => {});
    return () => { active = false; };
  }, []);
  // A design link that can't open says so, instead of quietly showing the list.
  const [openState, setOpenState] = useState<{ id: string; status: 'opening' | 'failed' | 'missing' } | null>(null);
  const openDesign = useCallback(async (id: string) => {
    setOpenState({ id, status: 'opening' });
    const result = await useTemplateStore.getState().fetchTemplate(id, { quiet: true });
    const opened = useTemplateStore.getState().getTemplateById(id);
    setOpenState(opened && !opened.summaryOnly ? null : { id, status: result === 'missing' ? 'missing' : 'failed' });
  }, []);
  useEffect(() => {
    if (templateId) void openDesign(templateId);
    try { setRecovery(templateId ? readDrafts(templateId) : []); } catch { setSaveError('Draft recovery storage is unavailable. Keep this tab open until changes save.'); }
  }, [templateId, openDesign]);
  const recoverCopy = async (draft: LabelTemplate) => {
    try {
      const created = await addTemplate({ name:draft.name+' (recovered)', description:draft.description, formatId:draft.formatId, elements:draft.elements, thermalRenderMode:draft.thermalRenderMode });
      unsavedChanges.current = false;
      router.push(`/designer?id=${created.id}`);
    } catch(error) { setSaveError((error as Error).message); }
  };

  // Items that cover each other or run off the label, as the printer draws
  // them (native thermal only; bitmap labels have their own exact proof).
  // Every preview shows the same sample for each per-label field.
  const previewValues = useMemo(() => designSampleValues(currentTemplate && !currentTemplate.summaryOnly ? currentTemplate.elements : [], testData), [currentTemplate, testData]);
  const [inks, setInks] = useState<Record<string, InkOffset>>({});
  const measured = useMemo(() => {
    const boxes: Record<string, Box> = {};
    for (const el of currentTemplate && !currentTemplate.summaryOnly ? currentTemplate.elements : []) {
      const ink = inks[el.id];
      if (ink) boxes[el.id] = { x: el.x + ink.dx, y: el.y + ink.dy, width: ink.width, height: ink.height };
    }
    return boxes;
  }, [currentTemplate, inks]);
  const designProblems = useMemo(() => {
    if (!currentTemplate || !currentFormat || currentTemplate.summaryOnly) return [];
    // Exact picture designs: what the exact renderer refuses, and codes that land on something.
    // Text over text is a warning here only: the run checks don't stop for it.
    if (currentTemplate.thermalRenderMode === 'bitmap-v1') return [...bitmapLayoutProblems(currentTemplate.elements, currentFormat, previewValues), ...bitmapTextOverlaps(currentTemplate.elements, currentFormat, previewValues)];
    // Inside the designer the fix is a button here, not "go to the designer".
    return layoutProblems(currentTemplate.elements, currentFormat, previewValues, measured).map((p) => (
      p.barcodeFit ? { ...p, fix: barcodeFitFix(p.barcodeFit, 'designer') || p.fix } : p
    ));
  }, [currentTemplate, currentFormat, previewValues, measured]);
  // A barcode that only fits as a picture copy gets that action right in the notice.
  const canExactCopy = currentFormat?.type === 'thermal' && designProblems.some((p) => p.barcodeFit?.fixes.includes('exact-copy'));
  const [exactCopyRequest, setExactCopyRequest] = useState(0);
  // A barcode that won't print whole: a safe change to this design only
  // (move or turn it, or a QR code in its place), checked before it is offered.
  // A barcode that lands on another item (or has one over it) gets the same offer.
  const isBarcode = (id: string | undefined) => !!id && currentTemplate?.elements.some((e) => e.id === id && e.type === 'barcode');
  const brokenBarcodeId = designProblems.find((p) => p.blocking && p.barcodeFit && p.barcodeFit.reason !== 'characters' && isBarcode(p.ids[0]))?.ids[0]
    ?? designProblems.find((p) => p.kinds.includes('overlap') && isBarcode(p.ids[0]))?.ids[0]
    ?? designProblems.find((p) => p.kinds.includes('overlap') && p.ids.slice(1).some(isBarcode))?.ids.slice(1).find(isBarcode)
    // Bars hanging off an edge get the same "Fix it for me" in either kind of design.
    ?? designProblems.find((p) => p.kinds.includes('off-label') && isBarcode(p.ids[0]))?.ids[0];
  const autoFixes = useMemo(() => {
    if (!brokenBarcodeId || !currentTemplate || currentTemplate.summaryOnly) return { fix: null, qr: null };
    const bitmap = currentTemplate.thermalRenderMode === 'bitmap-v1';
    const opts = bitmap ? {} : { measured };
    const fix = barcodeAutoFix(currentTemplate.elements, brokenBarcodeId, currentFormat, previewValues, bitmap, opts);
    // A QR code only where moving or widening can't do it.
    return { fix, qr: fix ? null : barcodeToQr(currentTemplate.elements, brokenBarcodeId, currentFormat, previewValues, bitmap, opts) };
  }, [brokenBarcodeId, currentTemplate, currentFormat, previewValues, measured]);
  // Text that covers other text: "Fix it for me" moves it to a free spot.
  const isText = (id: string | undefined) => !!id && currentTemplate?.elements.some((e) => e.id === id && e.type === 'text');
  const textProblem = designProblems.find((p) => p.kind === 'overlap' && isText(p.ids[0]) && p.ids.slice(1).every(isText));
  const textFix = useMemo(() => {
    if (!textProblem || !currentTemplate || currentTemplate.summaryOnly) return null;
    const bitmap = currentTemplate.thermalRenderMode === 'bitmap-v1';
    return textAutoFix(currentTemplate.elements, textProblem.ids[0], currentFormat, previewValues, bitmap, bitmap ? {} : { measured });
  }, [textProblem, currentTemplate, currentFormat, previewValues, measured]);
  // Characters the printer's own font can't print, outlined on the canvas too.
  const canvasProblems = useMemo<LayoutProblem[]>(() => {
    if (!currentTemplate || currentTemplate.summaryOnly || !usesPrinterFont(currentFormat, currentTemplate)) return designProblems;
    const characters = currentTemplate.elements.flatMap((el): LayoutProblem[] => {
      const chars = elementUnprintable(el, previewValues);
      if (!chars.length) return [];
      const name = itemName(el);
      return [{ kind: 'characters', kinds: ['characters'], ids: [el.id], message: `${name.charAt(0).toUpperCase()}${name.slice(1)}: ${describeUnprintable(chars).replace(/^The printer/, 'the printer')}` }];
    });
    return [...designProblems, ...characters];
  }, [currentTemplate, currentFormat, designProblems, previewValues]);

  // If no template is selected, show template list view
  if (!currentTemplate || currentTemplate.summaryOnly || !currentFormat) {
    return (
      <AppShell>
        {/* Template List */}
        <div ref={listScrollRef} className="flex-1 overflow-auto">
          <TemplateList
            openingName={templateId && openState?.id === templateId && openState.status === 'failed' ? designLabel(templates.find((t) => t.id === templateId)?.name) : undefined}
            onRetryOpen={templateId ? () => void openDesign(templateId) : undefined}
            missingLink={!!templateId && openState?.id === templateId && openState.status === 'missing'}
            notice={templateId && openState?.id === templateId ? (
              openState.status === 'opening'
                ? <p role="status" className="mb-4 text-sm text-zinc-400">Opening {designLabel(templates.find((t) => t.id === templateId)?.name)}…</p>
                : openState.status === 'missing'
                  ? null
                  : <p role="alert" className="mb-4 text-sm text-red-400">Couldn’t open {designLabel(templates.find((t) => t.id === templateId)?.name)}. <button type="button" onClick={() => void openDesign(templateId)} className="link -my-3 inline-block py-3">Try again</button></p>
            ) : null}
            templates={templates}
            onSelectTemplate={(id) => {
              selectTemplate(id);
              router.push(`/designer?id=${id}`);
            }}
            onDeleteTemplate={deleteTemplate}
            onRestoreTemplate={(id) => updateTemplate(id, { archivedAt: null })}
            onDuplicateTemplate={async (t) => { await useTemplateStore.getState().fetchTemplate(t.id); const full=useTemplateStore.getState().getTemplateById(t.id); if(full && !full.summaryOnly) setDuplicateSource(full); }}
            onRenameTemplate={(t) => setRenameSource(t)}
            onNewTemplate={() => setShowNewTemplateDialog(true)}
            // With no designs, everyone can start from the sample; importing a
            // file is an admin tool, and only admins see these under a list.
            extra={templates.length === 0 || isAdmin ? <BitmapTemplateActions admin={isAdmin} quiet={templates.length > 0} onCreated={(id) => { selectTemplate(id); router.push(`/designer?id=${id}`); }} /> : undefined}
          />

        </div>

        {/* New Template Dialog */}
        <NewTemplateDialog
          isOpen={showNewTemplateDialog}
          onClose={() => setShowNewTemplateDialog(false)}
          onCreate={async (name, description, formatId, thermalRenderMode) => {
            const newTemplate = await addTemplate({
              name,
              description,
              formatId,
              thermalRenderMode,
              elements: [],
            });
            selectTemplate(newTemplate.id);
            router.push(`/designer?id=${newTemplate.id}`);
            setShowNewTemplateDialog(false);
          }}
        />

        {/* Duplicate Template Dialog */}
        <DuplicateTemplateDialog
          isOpen={!!duplicateSource}
          source={duplicateSource}
          onClose={() => setDuplicateSource(null)}
          onCreate={async (newName, newFormatId, scale) => {
            if (!duplicateSource) return;
                    const sourceFormat = getFormatById(duplicateSource.formatId);
            const targetFormat = getFormatById(newFormatId);
            if (!sourceFormat || !targetFormat) return;
            const elements = duplicateElementsForFormat(
              duplicateSource,
              sourceFormat,
              targetFormat,
              { scale: scale && sourceFormat.id !== targetFormat.id },
            );
            const newTemplate = await addTemplate({
              name: newName,
              description: duplicateSource.description,
              formatId: newFormatId,
              thermalRenderMode: targetFormat.type === 'thermal' ? duplicateSource.thermalRenderMode : 'native-v1',
              elements: elements as TemplateElement[],
            });
            setDuplicateSource(null);
            router.push(`/designer?id=${newTemplate.id}`);
          }}
        />

        <RenameTemplateDialog
          isOpen={!!renameSource}
          source={renameSource}
          onClose={() => setRenameSource(null)}
          onSave={async (name, description) => {
            if (!renameSource) return;
            await updateTemplate(renameSource.id, { name, description });
            setRenameSource(null);
          }}
        />
      </AppShell>
    );
  }

  // Template editor view
  const selectedElement = selectedElementId
    ? currentTemplate.elements.find((e) => e.id === selectedElementId) || null
    : null;

  const handleAddElement = (type: ElementType) => {
    // Calculate dimensions in the label's native units
    const isThermal = currentFormat.type === 'thermal';
    const dpi = currentFormat.dpi || 203;

    // Label dimensions in working units (dots for thermal, inches for sheet)
    const labelW = isThermal ? currentFormat.width * dpi : currentFormat.width;
    const labelH = isThermal ? currentFormat.height * dpi : currentFormat.height;

    // Default element size: ~30% of the smaller label dimension
    const unit = Math.min(labelW, labelH);
    const defaultW = Math.round((unit * 0.4) * 100) / 100;
    const defaultH = Math.round((unit * 0.2) * 100) / 100;

    // Position: 5% from top-left
    const defaultX = Math.round((labelW * 0.05) * 100) / 100;
    const defaultY = Math.round((labelH * 0.05) * 100) / 100;

    // Font size proportional to label
    // Sheet: ~10-14pt for readability. Thermal: proportional to dots.
    const defaultFontSize = isThermal
      ? Math.max(8, Math.round(unit * 0.06))
      : Math.max(6, Math.min(14, Math.round(unit * 12))); // cap at 14pt for sheet labels

    // Stroke width proportional
    const defaultStroke = isThermal ? Math.max(1, Math.round(unit * 0.005)) : Math.round(unit * 0.01 * 100) / 100;

    const baseElement = {
      x: defaultX,
      y: defaultY,
      width: defaultW,
      height: defaultH,
      rotation: 0,
      isStatic: true,
    };

    let elementData: NewTemplateElement;

    switch (type) {
      case 'text':
        elementData = {
          ...baseElement,
          type: 'text',
          content: 'Text',
          fontSize: defaultFontSize,
          fontFamily: currentTemplate.thermalRenderMode === 'bitmap-v1' ? 'Liberation Sans' : 'Arial',
          fontWeight: 'normal',
          textAlign: 'left',
          color: '#000000',
          lineHeight: 1.2,
          autoFit: true,
          minFontSize: 4,
          // Height: enough for 2 lines of text
          height: isThermal ? defaultFontSize * 3 : (defaultFontSize / 72) * 2.5,
          // Width: at least 60% of label width for text
          width: Math.round((labelW * 0.6) * 100) / 100,
        };
        break;
      case 'qr': {
        // QR should be square, ~40% of the smaller label dimension
        const qrSize = Math.round((unit * 0.4) * 100) / 100;
        elementData = {
          ...baseElement,
          type: 'qr',
          content: 'https://example.com',
          errorCorrection: 'M',
          width: qrSize,
          height: qrSize,
        };
        break;
      }
      case 'barcode':
        elementData = {
          ...baseElement,
          type: 'barcode',
          content: '123456789',
          barcodeFormat: 'CODE128',
          showText: true,
          width: Math.round((labelW * 0.6) * 100) / 100,
          height: Math.round((labelH * 0.25) * 100) / 100,
        };
        break;
      case 'line':
        elementData = {
          ...baseElement,
          type: 'line',
          strokeWidth: defaultStroke,
          color: '#000000',
          width: Math.round((labelW * 0.8) * 100) / 100,
          height: 0,
        };
        break;
      case 'rectangle':
        elementData = {
          ...baseElement,
          type: 'rectangle',
          strokeWidth: defaultStroke,
          strokeColor: '#000000',
          fillColor: '',
          borderRadius: 0,
        };
        break;
      case 'image':
        elementData = {
          ...baseElement,
          type: 'image',
          src: '',
          objectFit: 'contain',
        };
        break;
      default:
        return;
    }

    // Put the new item in clear space: the first gap, top to bottom, that
    // fits it, shrinking it (down to half size) if the label is crowded.
    const margin = isThermal ? Math.max(6, Math.round(unit * 0.03)) : Math.round(unit * 0.03 * 100) / 100 || 0.03;
    const taken: Box[] = currentTemplate.elements.map((el) => {
      const box = { x: el.x, y: el.y, width: el.width, height: Math.max(el.height, el.type === 'line' ? (el as { strokeWidth?: number }).strokeWidth ?? 1 : 0) };
      const printed = isThermal && currentTemplate.thermalRenderMode !== 'bitmap-v1' ? measured[el.id] ?? printedBounds(el, currentFormat, previewValues) : null;
      if (!printed) return box;
      const x = Math.min(box.x, printed.x), y = Math.min(box.y, printed.y);
      return { x, y, width: Math.max(box.x + box.width, printed.x + printed.width) - x, height: Math.max(box.y + box.height, printed.y + printed.height) - y };
    });
    let placed: { x: number; y: number; width: number; height: number; fits: boolean } | null = null;
    for (const scale of [1, 0.75, 0.5]) {
      const round = (v: number) => isThermal ? Math.round(v) : Math.round(v * 100) / 100;
      const size = { width: round(Math.min(elementData.width, labelW - margin * 2) * scale), height: round(elementData.height * scale) };
      const spot = freeSpot(taken, size, { width: labelW, height: labelH }, margin);
      if (spot.fits) { placed = { ...size, x: spot.x, y: spot.y, fits: true }; break; }
    }
    if (!placed) placed = { width: elementData.width, height: elementData.height, x: margin, y: margin, fits: currentTemplate.elements.length === 0 };
    const sizeChanged = placed.width !== elementData.width || placed.height !== elementData.height;
    const scaled: Partial<TemplateElement> = sizeChanged ? { width: placed.width, height: placed.height } : {};
    if (sizeChanged && elementData.type === 'text') Object.assign(scaled, { fontSize: Math.max(isThermal ? 6 : 5, Math.round(elementData.fontSize * placed.height / elementData.height)) });
    if (sizeChanged && elementData.type === 'qr') { const side = Math.min(placed.width, placed.height); Object.assign(scaled, { width: side, height: side }); }
    const id = crypto.randomUUID();
    setPlaceNotice(placed.fits ? null : { id, x: placed.x, y: placed.y, text: `No free space left, so the new ${elementTypeName(type).toLowerCase()} is on top of other items. Drag it or make the label bigger.` });
    commitEdit({ elements: [...currentTemplate.elements, { ...elementData, ...scaled, x: placed.x, y: placed.y, id, zIndex: Math.max(0, ...currentTemplate.elements.map(e => e.zIndex)) + 1 } as TemplateElement] });
    // Select it so the properties panel shows what was just added.
    setSelectedIds(new Set([id]));
  };

  const handleUpdateElement = (updates: Partial<TemplateElement>) => {
    if (!selectedElementId || selectedElement?.locked) return;
    beginGesture();
    updateElementLocal(currentTemplate.id, selectedElementId, updates);
    if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName || '')) finishGesture();
  };

  const handleUpdateSelectedElements = (updates: Partial<TemplateElement>) => {
    if (selectedIds.size === 0) return;
    const selectedTextIds = currentTemplate.elements
      .filter((el) => selectedIds.has(el.id) && !el.locked && el.type === 'text')
      .map((el) => el.id);

    if (selectedTextIds.length === 0) return;

    beginGesture();
    for (const id of selectedTextIds) {
      updateElementLocal(currentTemplate.id, id, updates);
    }
    if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName || '')) finishGesture();
  };

  const actionIds = (id: string) => selectedIds.has(id) ? selectedIds : new Set([id]);
  const handleMoveElement = (id: string, direction: LayerDirection) => {
    commitEdit({ elements: moveLayers(currentTemplate.elements, actionIds(id), direction) });
  };
  const handleDeleteElements = (id: string) => {
    const ids = actionIds(id);
    commitEdit({ elements: currentTemplate.elements.filter(e => !ids.has(e.id) || e.locked) });
    setSelectedIds(new Set(currentTemplate.elements.filter(e => ids.has(e.id) && e.locked).map(e => e.id)));
  };
  const handleDuplicateElements = (id: string) => {
    const originals = currentTemplate.elements.filter(e => actionIds(id).has(e.id)).sort((a, b) => a.zIndex - b.zIndex);
    const top = Math.max(0, ...currentTemplate.elements.map(e => e.zIndex));
    const offsetX = (originals[0]?.width ?? 0) * .12, offsetY = (originals[0]?.height ?? 0) * .12;
    const copies = originals.map((e, i) => ({ ...e, id: crypto.randomUUID(), locked: false, x: e.x + offsetX, y: e.y + offsetY, zIndex: top + i + 1 }));
    commitEdit({ elements: [...currentTemplate.elements, ...copies] });
    setSelectedIds(new Set(copies.map(e => e.id)));
  };
  const handleLockElements = (ids: Set<string>, locked: boolean) => {
    commitEdit({ elements: currentTemplate.elements.map(e => ids.has(e.id) ? { ...e, locked } : e) });
  };

  const handleChangeFormat = (formatId: string) => {
    const targetFormat = getFormatById(formatId);
    if (!targetFormat || targetFormat.id === currentTemplate.formatId) return;

    const elements = duplicateElementsForFormat(
      currentTemplate,
      currentFormat,
      targetFormat,
      { scale: true },
    ) as TemplateElement[];

    // Resizing the same design must retain layer identities and stacking order.
    commitEdit({ formatId: targetFormat.id, elements: elements.map((e, i) => ({ ...e, id: currentTemplate.elements[i].id, zIndex: currentTemplate.elements[i].zIndex })) });
  };

  const compatibleFormats = formats.filter((format) => format.type === currentFormat.type);
  const exactView = currentFormat.type === 'thermal' && view === 'exact';

  // One edit to this design, so Undo takes it back; other designs and their runs are untouched.
  const applyFix = (fix: BarcodeAutoFix, movedId = brokenBarcodeId) => {
    const before = currentTemplate.elements.find((e) => e.id === movedId);
    const after = fix.elements.find((e) => e.id === movedId);
    commitEdit({ elements: fix.elements });
    // The item travels to its new spot along an arc, so the change is seen.
    if (before && after) {
      const dx = (before.x + before.width / 2) - (after.x + after.width / 2);
      const dy = (before.y + before.height / 2) - (after.y + after.height / 2);
      requestAnimationFrame(() => arcMove(document.querySelector(`[data-designer-canvas] [data-element-id="${CSS.escape(after.id)}"]`), dx, dy));
    }
    setFixNote({ templateId: currentTemplate.id, text: fix.done, elements: fix.elements });
    setSelectedIds(new Set(fix.elements.filter((e) => e.id === movedId).map((e) => e.id)));
  };
  const fixStillShown = fixNote && fixNote.templateId === currentTemplate.id && fixNote.elements === currentTemplate.elements;
  // Each fix button sits under the problem it fixes. The barcode's own fix
  // is "Fix it for me" (the same words as on the new run page).
  const barcodeProblem = brokenBarcodeId ? canvasProblems.find((p) => p.ids.includes(brokenBarcodeId) && (p.barcodeFit || p.kinds.includes('overlap') || (p.ids[0] === brokenBarcodeId && p.kinds.includes('off-label')))) : undefined;
  const copyProblem = canExactCopy ? canvasProblems.find((p) => p.barcodeFit?.fixes.includes('exact-copy')) : undefined;
  // Characters the printer font can't print, typed into the design itself
  // (not only a sample value): one click swaps them for plain ones.
  const plainText = (el: TemplateElement): Partial<TemplateElement> | null => {
    if (el.type !== 'text') return null;
    const fields = (el.isStatic ? ['content'] : ['defaultValue', 'prefix', 'suffix']) as Array<'content' | 'defaultValue' | 'prefix' | 'suffix'>;
    const updates: Record<string, string> = {};
    for (const key of fields) {
      const value = (el as unknown as Record<string, string | undefined>)[key] || '';
      const plain = plainPrinterText(value);
      if (plain !== value) updates[key] = plain;
    }
    return Object.keys(updates).length ? (updates as Partial<TemplateElement>) : null;
  };
  const characterFixIds = canvasProblems.filter((p) => p.kind === 'characters').map((p) => p.ids[0]).filter((id) => {
    const el = currentTemplate.elements.find((e) => e.id === id);
    return !!el && !!plainText(el);
  });
  const characterWords = (ids: string[]) => {
    const chars = new Set(ids.flatMap((id) => { const el = currentTemplate.elements.find((e) => e.id === id); return el ? elementUnprintable(el, {}) : []; }));
    return chars.size > 0 && [...chars].every((ch) => plainReplacement(ch) === '-') ? 'Replace with -' : 'Use plain characters';
  };
  const replaceCharacters = (ids: string[]) => {
    const elements = currentTemplate.elements.map((el) => {
      if (!ids.includes(el.id)) return el;
      const updates = plainText(el);
      return updates ? ({ ...el, ...updates } as TemplateElement) : el;
    });
    commitEdit({ elements });
    setFixNote({ templateId: currentTemplate.id, text: ids.length === 1 ? 'Swapped those characters for plain ones the printer can print.' : `Swapped the characters the printer can’t print for plain ones in ${ids.length} items.`, elements });
  };
  const noticeAction = (problem: LayoutProblem) => {
    const buttons: ReactNode[] = [];
    const moveFix = problem === barcodeProblem ? autoFixes.fix : null;
    // Printer font bars can't get thinner, so when nothing on this design can
    // move, the fix is a picture copy: a new design. Its dialog says what the
    // copy is (and that the original stays) before anything is made, so the
    // notice doesn't say it again.
    const copyIsTheFix = problem === copyProblem && !moveFix;
    if (moveFix) buttons.push(<button key="fix" type="button" className="btn btn-primary btn-sm max-sm:min-h-11" onClick={() => applyFix(moveFix)}>{moveFix.label}</button>);
    if (copyIsTheFix) buttons.push(
      <button key="copy" type="button" className="btn btn-primary btn-sm max-sm:min-h-11" onClick={() => setExactCopyRequest((n) => n + 1)}>Make a picture copy…</button>,
    );
    if (problem === barcodeProblem && !autoFixes.fix && autoFixes.qr) buttons.push(<button key="qr" type="button" className="btn btn-secondary btn-sm max-sm:min-h-11" onClick={() => applyFix(autoFixes.qr!)}>{autoFixes.qr.label}</button>);
    if (problem === copyProblem && !copyIsTheFix) buttons.push(<button key="copy" type="button" className="btn btn-ghost btn-sm max-sm:min-h-11" onClick={() => setExactCopyRequest((n) => n + 1)}>Make a picture copy</button>);
    if (textProblem && textFix && problem.kind === 'overlap' && problem.ids.join() === textProblem.ids.join()) {
      buttons.push(<button key="text" type="button" className="btn btn-primary btn-sm max-sm:min-h-11" onClick={() => applyFix(textFix, textProblem.ids[0])}>{textFix.label}</button>);
    }
    if (problem.kind === 'characters' && characterFixIds.includes(problem.ids[0])) {
      buttons.push(<button key="chars" type="button" className="btn btn-secondary btn-sm max-sm:min-h-11" onClick={() => replaceCharacters([problem.ids[0]])}>{characterWords([problem.ids[0]])}</button>);
      if (characterFixIds.length > 1 && characterFixIds[0] === problem.ids[0]) {
        buttons.push(<button key="chars-all" type="button" className="btn btn-ghost btn-sm max-sm:min-h-11" onClick={() => replaceCharacters(characterFixIds)}>Do it in all {characterFixIds.length} items</button>);
      }
    }
    return buttons.length ? <>{buttons}</> : null;
  };
  const fixDone = fixStillShown ? (
    <p role="status" className="fold-reveal flex flex-wrap items-center gap-x-3 px-3 pb-1 text-sm text-emerald-400 sm:px-6">
      <span className="inline-flex items-center gap-1.5"><CheckCircle2 key={fixNote.text} className="size-4 shrink-0 rounded-full animate-success" aria-hidden="true" />{fixNote.text}</span>
      <button type="button" className="link inline-flex min-h-control-sm items-center" onClick={() => { handleUndo(); setFixNote(null); }}>Undo</button>
    </p>
  ) : null;

  // Phone: "Change item" only shows once an item is chosen, so it is never an empty pane.
  // ("Change item", not a second "Edit" next to the Edit | Print preview toggle.)
  // Print preview is for looking and test printing: the item tools step
  // aside (Items and Change item), the sample values stay.
  const phoneTabs = ([['label', 'Label'], ['layers', 'Items'], ['data', 'Sample values'], ['edit', 'Change item']] as const)
    .filter(([pane]) => (pane !== 'edit' || selectedIds.size > 0) && (!exactView || pane === 'label' || pane === 'data'));
  const shownPane = (phonePane === 'edit' && selectedIds.size === 0) || (exactView && (phonePane === 'layers' || phonePane === 'edit')) ? 'label' : phonePane;
  const shownPanel = exactView ? 'data' : leftPanel;

  return (
    <AppShell beforeLeave={saveBeforeLeaving}>
      <PageTitle title={`${currentTemplate.name} · Designer`} />
      {saveError && <p role="alert" className="px-4 py-2 text-sm text-red-400">Your last change isn’t saved. {designSaveProblem(saveError, currentTemplate.elements)} <button type="button" className="link" onClick={() => persistEdits(currentTemplate.id)}>Try saving again</button></p>}
      {recovery.length > 0 && <div role="alert" className="px-4 py-2 text-amber-300 text-sm">We found unsaved changes from an earlier visit. Recovering them makes a separate copy, so the saved design is not overwritten.
        {recovery.map(draft=><div key={draft.key}>{new Date(draft.savedAt).toLocaleString()} <button type="button" className="link" onClick={()=>void recoverCopy(draft.template)}>Recover as copy</button> <button type="button" className="link ml-3" onClick={()=>{window.localStorage.removeItem(draft.key);setRecovery(items=>items.filter(item=>item.key!==draft.key));}}>Discard this draft</button></div>)}
      </div>}
      {saveError && <button type="button" className="link px-4 pb-2 text-left text-sm" onClick={()=>void recoverCopy(currentTemplate)}>Save my changes as a separate copy</button>}
      <div className="lg:hidden px-4 py-2">
      <div role="tablist" aria-label="Designer panes" className="segmented segmented-fit [&>button]:px-1.5">
        <SegmentedIndicator fit index={phoneTabs.findIndex(([pane]) => pane === shownPane)} count={phoneTabs.length} />
        {phoneTabs.map(([pane, text]) => (
          <button key={pane} type="button" role="tab" aria-selected={shownPane === pane} onClick={() => { setPhonePane(pane); if (pane === 'layers' || pane === 'data') setLeftPanel(pane); }} >{text}</button>
        ))}
      </div>
      </div>
      {/* Editor layout fills the content area */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-auto lg:overflow-hidden mx-auto w-full">
        {/* Left Panel - Element List + Test Data */}
        <div className={`${shownPane === 'layers' || shownPane === 'data' ? 'flex' : 'hidden'} lg:flex w-full lg:w-[248px] 2xl:w-[280px] lg:shrink-0 min-h-0 flex-col lg:bg-zinc-900 lg:max-h-none`} role="region" aria-label={shownPanel === 'layers' ? 'Items on the label' : 'Sample values for the preview'}>
          <div className="p-2 max-lg:hidden">
          {exactView ? (
            <h2 className="flex min-h-control-sm items-center px-2 text-sm font-medium text-zinc-100">Sample values</h2>
          ) : (
          <div className="segmented" role="group" aria-label="Designer panels">
            <SegmentedIndicator index={leftPanel === 'data' ? 1 : 0} count={2} />
            <button aria-pressed={leftPanel === 'layers'} onClick={() => setLeftPanel('layers')}>Items <span className="tabular-nums text-zinc-400">{currentTemplate.elements.length}</span></button>
            <button aria-pressed={leftPanel === 'data'} onClick={() => setLeftPanel('data')}>Sample values</button>
          </div>
          )}
          </div>
          <div className={shownPanel === 'layers' ? 'flex flex-col flex-1 min-h-0' : 'hidden'}>
          <ElementList
            elements={currentTemplate.elements}
            selectedElementIds={selectedIds}
            onSelectElement={(id, additive) => setSelectedIds(prev => {
              if (!additive) return new Set([id]);
              const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next;
            })}
            onDeleteElement={handleDeleteElements}
            onDuplicateElement={handleDuplicateElements}
            onLockElements={handleLockElements}
            onMoveElement={handleMoveElement}
            onAddElement={() => setShowAddElementMenu(true)}
            onInsertGlobal={() => setShowGlobalPicker(true)}
            onSaveAsGlobal={() => setShowGlobalSave(true)}
          />
          </div>
          <div className={shownPanel === 'data' ? 'flex flex-col flex-1 min-h-0' : 'hidden'}>
          <TestDataPanel
            key={currentTemplate.id}
            elements={currentTemplate.elements}
            testData={testData}
            onTestDataChange={(field, value) => setTestData((prev) => { const next = { ...prev, [field]: value }; localStorage.setItem(`lw:test-data:${currentTemplate.id}`, JSON.stringify(next)); return next; })}
          />
          </div>
        </div>

        {/* Center Panel - Preview */}
        <div className={`${shownPane === 'label' ? 'flex' : 'hidden'} lg:flex flex-1 flex-col min-w-0 min-h-[440px] lg:min-h-0 overflow-y-auto`}>
          {/* Breadcrumb bar. When a returnTo is set we show a 'Done' CTA
              so the round-trip feels like 'I edited this and came back'
              rather than 'I'm lost in the designer'. */}
          <div className="px-4 py-2 flex flex-wrap items-center gap-2 text-sm shrink-0">
            {returnTo ? (
              <a
                href={returnTo}
                onClick={e => { e.preventDefault(); void leaveEditor(); }}
                className="btn btn-primary btn-sm pl-2"
              >
                <ChevronLeft className="size-4" aria-hidden="true" /> Done editing
              </a>
            ) : (
              <a
                href="/designer"
                onClick={e => { e.preventDefault(); void leaveEditor(); }}
                className="inline-flex min-h-control-sm items-center text-zinc-400 hover:text-zinc-100 transition-colors max-sm:hidden"
              >
                Designs
              </a>
            )}
            <span className={`text-zinc-400 ${returnTo ? '' : 'max-sm:hidden'}`} aria-hidden="true">/</span>
            <h1 className="min-w-0 max-w-[min(100%,24rem)] text-sm font-semibold text-zinc-100">
              <button
                onClick={() => setRenameSource(currentTemplate)}
                className="group flex min-h-control-sm min-w-0 max-w-full items-center gap-1.5 rounded-md transition-colors"
                title="Rename design"
              >
                <span className="truncate">{currentTemplate.name}</span>
                <Pencil className="w-3.5 h-3.5 shrink-0 text-zinc-400 group-hover:text-zinc-100" aria-hidden="true" />
              </button>
            </h1>
            {compatibleFormats.length > 1 && (
              <div className="w-44 shrink-0 max-sm:hidden">
                <CustomSelect
                  value={currentFormat.id}
                  onChange={(value) => void handleChangeFormat(value)}
                  options={compatibleFormats.map((format) => ({
                    value: format.id,
                    label: format.name,
                    sublabel: format.name.includes(`${format.width}"`) ? undefined : `${format.width}" × ${format.height}"`,
                  }))}
                />
              </div>
            )}

            {/* Saving is automatic: just say where it stands. */}
            <span role="status" aria-live="polite" className={`inline-flex min-h-control-sm items-center gap-1.5 ${saveError ? 'text-red-400' : 'text-zinc-400'}`}><span key={saveError ? 'error' : saving ? 'saving' : 'saved'} aria-hidden="true" className={`size-1.5 rounded-full ${saveError ? 'bg-red-400' : saving ? 'bg-zinc-500' : 'bg-emerald-400 animate-success'}`} />{saveError ? 'Not saved' : saving ? 'Saving…' : 'Saved'}</span>

            {/* Phone: one button in the title row goes to the other view (no
                second row of tabs under the pane tabs). */}
            {currentFormat.type === 'thermal' && (
              <button type="button" onClick={() => setView(exactView ? 'edit' : 'exact')} className="btn btn-ghost btn-sm ml-auto -mr-[13px] sm:hidden">
                {exactView ? <><Pencil className="size-4" aria-hidden="true" />Edit</> : <><Eye className="size-4" aria-hidden="true" />Print preview</>}
              </button>
            )}

            {/* View, undo/redo and More. On a narrow phone this wraps (More
                never hides in a sideways scroller): the view switch on one
                line, undo, redo and More on the next. */}
            <div className="ml-auto flex min-w-0 max-w-full flex-wrap items-center justify-end gap-1 max-sm:w-full max-sm:justify-start">
              {showThermalOrientationPicker && !exactView && (
                <>
                  <div className="segmented mr-2" role="group" aria-label="View">
                    <SegmentedIndicator index={thermalEditorOrientation === 'upright' ? 1 : 0} count={2} />
                    <button
                      onClick={() => updateThermalEditorOrientation('printer')}
                      title="Show the label the way it comes out of the printer"
                      aria-pressed={thermalEditorOrientation === 'printer'}
                    >
                      As printed
                    </button>
                    <button
                      onClick={() => updateThermalEditorOrientation('upright')}
                      title="Turn the label so the text reads the right way up"
                      aria-pressed={thermalEditorOrientation === 'upright'}
                    >
                      Readable
                    </button>
                  </div>
                </>
              )}
              {currentFormat.type === 'thermal' && (
                <div className="segmented mr-1 max-sm:hidden" role="group" aria-label="What the label shows">
                  <SegmentedIndicator index={exactView ? 1 : 0} count={2} />
                  <button type="button" aria-pressed={!exactView} onClick={() => setView('edit')} title="Move and change items">Edit</button>
                  <button type="button" aria-pressed={exactView} onClick={() => setView('exact')} title="Exactly what the printer makes, with test print">Print preview</button>
                </div>
              )}
              {/* Phone: the Label tab gets its own way to add, named and styled as on Items. */}
              {!exactView && <button type="button" onClick={() => setShowAddElementMenu(true)} className="btn btn-primary btn-sm lg:hidden"><Plus className="size-4" aria-hidden="true" /> Add an item</button>}
              <div className="ml-auto flex shrink-0 items-center gap-1">
              <button
                onClick={handleUndo}
                disabled={!canUndo()}
                title="Undo (Ctrl+Z)"
                aria-label="Undo"
                className="btn btn-ghost btn-icon btn-sm"
              >
                <Undo2 className="w-4 h-4" />
              </button>
              <button
                onClick={handleRedo}
                disabled={!canRedo()}
                title="Redo (Ctrl+Shift+Z)"
                aria-label="Redo"
                className="btn btn-ghost btn-icon btn-sm"
              >
                <Redo2 className="w-4 h-4" />
              </button>
              {currentFormat.type === 'thermal' && <BitmapTemplateActions source={currentTemplate} format={currentFormat} values={previewValues} requestCopy={exactCopyRequest} closeKey={canvasProblems.map((p) => `${p.kind}:${p.ids.join(',')}`).join('|')} onShowCode={isAdmin ? () => setShowCode(true) : undefined} onCreated={(id) => { selectTemplate(id); router.push(`/designer?id=${id}`); }} />}
              </div>
            </div>
          </div>

          {fixDone}
          <div className={exactView ? 'hidden' : 'contents'}>
          <LabelPreview
            format={currentFormat}
            elements={currentTemplate.elements}
            selectedElementIds={selectedIds}
            editorOrientation={showThermalOrientationPicker ? thermalEditorOrientation : 'printer'}
            uprightTurn={uprightTurn}
            onInkChange={setInks}
            onSelectElement={(id, addToSelection) => {
              if (id === null) {
                setSelectedIds(new Set());
              } else if (addToSelection) {
                setSelectedIds((prev) => {
                  const next = new Set(prev);
                  if (next.has(id)) next.delete(id); else next.add(id);
                  return next;
                });
              } else {
                setSelectedIds(new Set([id]));
              }
            }}
            onUpdateElement={(id, updates) => { if (!currentTemplate.elements.find(e => e.id === id)?.locked) updateElementLocal(currentTemplate.id, id, updates); }}
            thermalRenderMode={currentTemplate.thermalRenderMode}
            onSelectElements={(ids) => setSelectedIds(new Set(ids))}
            onDuplicateSelection={(ids) => {
              const originals = currentTemplate.elements.filter(e => ids.has(e.id) && !e.locked).sort((a, b) => a.zIndex - b.zIndex);
              const copies = originals.map((e, i) => ({ ...e, id: crypto.randomUUID(), zIndex: Math.max(0, ...currentTemplate.elements.map(e => e.zIndex)) + i + 1 }));
              useTemplateStore.setState(state => ({ templates: state.templates.map(t => t.id === currentTemplate.id ? { ...t, elements: [...t.elements, ...copies] } : t) }));
              setSelectedIds(new Set(copies.map(e => e.id))); return copies;
            }}
            onDragStart={beginGesture}
            onDragEnd={finishGesture}
            onGestureCancel={cancelGesture}
            testData={previewValues}
            layoutProblems={canvasProblems}
            noticeAction={noticeAction}
            zoom={zoom}
            onZoomChange={setZoom}
          />
          </div>
          {placeNotice && currentTemplate.elements.some((e) => e.id === placeNotice.id && e.x === placeNotice.x && e.y === placeNotice.y) && <p role="status" className="px-4 pb-2 text-sm text-amber-300">{placeNotice.text}</p>}
          {currentFormat.type === 'thermal' ? (exactView && (
            <ZPLPreview format={currentFormat} template={currentTemplate} testData={previewValues} active={exactView} zoom={zoom} onZoomChange={setZoom} problemsShown={canvasProblems.length > 0} notice={canvasProblems.length > 0 ? <DesignNotice problems={canvasProblems} action={noticeAction} /> : null} />
          )) : (
            <LayoutPreview format={currentFormat} elements={currentTemplate.elements} testData={previewValues} />
          )}
        </div>

        {/* Print preview keeps the right column, so the label and the view
            switch stay exactly where they are in Edit. */}
        {exactView && <div className="hidden lg:block w-[264px] 2xl:w-[280px] shrink-0 bg-zinc-900 p-4 text-sm text-zinc-400">
          <p className="text-zinc-100 font-medium">Print preview</p>
          <p className="mt-1">Exactly what the printer makes, dot for dot. Try a test print from here, or press Edit to change the label.</p>
          <p className="mt-4">{currentFormat.name}</p>
          <p>{currentFormat.name.includes(`${currentFormat.width}"`) ? '' : `${currentFormat.width}" × ${currentFormat.height}" · `}{currentFormat.dpi || 203} dots per inch{(currentFormat.labelsAcross || 1) > 1 ? ` · ${currentFormat.labelsAcross} across` : ''}</p>
        </div>}
        {/* Right Panel - Properties */}
        <div className={exactView ? 'hidden' : shownPane === 'edit' ? 'contents' : 'hidden lg:contents'} onFocusCapture={beginGesture} onBlurCapture={finishGesture} onKeyDownCapture={e => { if (e.key === 'Escape') { cancelGesture(); (e.target as HTMLElement).blur(); } }}>
        <PropertyPanel
          element={selectedElement}
          selectedElements={currentTemplate.elements.filter((e) => selectedIds.has(e.id))}
          format={currentFormat}
          onUpdate={handleUpdateElement}
          onUpdateSelected={handleUpdateSelectedElements}
          bitmap={currentTemplate.thermalRenderMode === 'bitmap-v1'}
          allElements={currentTemplate.elements}
          problems={selectedElement ? designProblems.filter((p) => p.ids.includes(selectedElement.id)).map((p) => ({ text: withAllEdges(p.barcodeFit ? barcodePlainSentence(problemText(p)) : problemText(p), p.edges), blocking: !!p.blocking })) : []}
          onArrange={(action: AlignAction) => {
            beginGesture();
            const arranged = arrangeElements(currentTemplate.elements.filter(e => selectedIds.has(e.id) && !e.locked), action);
            for (const e of arranged) updateElementLocal(currentTemplate.id, e.id, { x: e.x, y: e.y });
            finishGesture();
          }}
        />
        </div>
      </div>

      {/* Add Element Menu */}
      <AddElementMenu
        isOpen={showAddElementMenu}
        onClose={() => setShowAddElementMenu(false)}
        onAddElement={handleAddElement}
        onInsertGlobal={() => setShowGlobalPicker(true)}
      />

      {/* Global Save Dialog */}
      <GlobalSaveDialog
        isOpen={showGlobalSave}
        elements={selectedIds.size > 0
          ? currentTemplate.elements.filter((e) => selectedIds.has(e.id))
          : []}
        onClose={() => setShowGlobalSave(false)}
        onSave={async (name, description) => {
          const toSave = selectedIds.size > 0
            ? currentTemplate.elements.filter((e) => selectedIds.has(e.id))
            : currentTemplate.elements;
          await createGlobal(name, toSave, description);
          setShowGlobalSave(false);
          setShowGlobalPicker(true);
        }}
      />

      {/* Global Element Picker */}
      <GlobalElementPicker
        isOpen={showGlobalPicker}
        onClose={() => setShowGlobalPicker(false)}
        globals={globals}
        onInsert={(elements) => {
          const top = Math.max(0, ...currentTemplate.elements.map(e => e.zIndex));
          const offset = currentFormat.type === 'thermal' ? 10 : .05;
          const copies = [...elements].sort((a, b) => a.zIndex - b.zIndex).map((el, i) => ({ ...el, id: crypto.randomUUID(), zIndex: top + i + 1, x: el.x + offset, y: el.y + offset }));
          commitEdit({ elements: [...currentTemplate.elements, ...copies] });
        }}
        onDelete={deleteGlobal}
      />
      <NewTemplateDialog
        isOpen={showNewTemplateDialog}
        onClose={() => setShowNewTemplateDialog(false)}
        onCreate={async (name, description, formatId, thermalRenderMode) => {
          const newTemplate = await addTemplate({
            name,
            description,
            formatId,
            thermalRenderMode,
            elements: [],
          });
          selectTemplate(newTemplate.id);
          router.push(`/designer?id=${newTemplate.id}`);
          setShowNewTemplateDialog(false);
        }}
      />

      <RenameTemplateDialog
        isOpen={!!renameSource}
        source={renameSource}
        onClose={() => setRenameSource(null)}
        onSave={async (name, description) => {
          if (!renameSource) return;
          await updateTemplate(renameSource.id, { name, description });
          setRenameSource(null);
        }}
      />
      {isAdmin && currentFormat.type === 'thermal' && <PrinterCodeDialog open={showCode} onClose={() => setShowCode(false)} template={currentTemplate} format={currentFormat} values={previewValues} />}
    </AppShell>
  );
}

export default function DesignerPage() {
  return (
    <Suspense fallback={
      <div className="h-screen flex items-center justify-center bg-zinc-950">
        <div className="text-sm text-zinc-400">Loading…</div>
      </div>
    }>
      <DesignerContent />
    </Suspense>
  );
}
