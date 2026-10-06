'use client';

import { readDrafts, type TemplateDraft } from '@/lib/templateDrafts';
import { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Undo2, Redo2, Pencil } from 'lucide-react';
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
import { LabelPreview } from '@/components/designer/LabelPreview';
import { PropertyPanel } from '@/components/designer/PropertyPanel';
import { ElementList } from '@/components/designer/ElementList';
import { TemplateList, NewTemplateDialog, DuplicateTemplateDialog, RenameTemplateDialog } from '@/components/designer/TemplateList';
import { AddElementMenu } from '@/components/designer/AddElementMenu';
import { LayoutPreview } from '@/components/designer/LayoutPreview';
import { ZPLPreview } from '@/components/designer/ZPLPreview';
import { TestDataPanel } from '@/components/designer/TestDataPanel';
import { GlobalSaveDialog } from '@/components/designer/GlobalSaveDialog';
import { GlobalElementPicker } from '@/components/designer/GlobalElementPicker';
import { CustomSelect } from '@/components/ui/CustomSelect';

type NewTemplateElement = TemplateElement extends infer T
  ? T extends TemplateElement
    ? Omit<T, 'id' | 'zIndex'>
    : never
  : never;

type ThermalEditorOrientation = 'printer' | 'upright';

function DesignerContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const templateId = searchParams.get('id');
  // Optional ?returnTo=/runs/<id> used by round-trip flows (e.g. "Tweak
  // template" from a run detail page). When present we swap the breadcrumb
  // for a 'Done' back button that sends the user home to where they started.
  // Only allow same-origin paths to avoid open-redirect mischief.
  const rawReturnTo = searchParams.get('returnTo');
  const returnTo = rawReturnTo && rawReturnTo.startsWith('/') && !rawReturnTo.startsWith('//')
    ? rawReturnTo
    : null;

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
  const saveBeforeLeaving = async () => {
    if (!currentTemplate || (!unsavedChanges.current && !gesture.current)) return true;
    const revision = ++saveRevision.current;
    try {
      setSaving(true);
      unsavedChanges.current = true;
      await saveTemplate(currentTemplate.id);
      if (revision !== saveRevision.current) return false;
      setSaving(false);
      setSaveError('');
      unsavedChanges.current = false;
      return true;
    } catch (error) {
      if (revision !== saveRevision.current) return false;
      setSaving(false);
      setSaveError((error as Error).message);
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
  const showThermalOrientationPicker = currentFormat?.type === 'thermal' && currentFormat.width > currentFormat.height;
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
      if (arrow && currentTemplate && selectedIds.size > 0) {
        e.preventDefault();
        // Step: 1 dot (thermal) / 0.01" (sheet). Shift → 10×.
        const isThermal = currentFormat?.type === 'thermal';
        const baseStep = isThermal ? 1 : 0.01;
        const step = (e.shiftKey ? 10 : 1) * baseStep;
        beginGesture();
        const direction = isThermal && thermalEditorOrientation === 'upright' && currentFormat.width > currentFormat.height ? { dx: -arrow.dy, dy: arrow.dx } : arrow;
        for (const id of selectedIds) {
          const el = useTemplateStore.getState().getTemplateById(currentTemplate.id)?.elements.find((x) => x.id === id);
          if (!el || el.locked) continue;
          updateElementLocal(currentTemplate.id, id, {
            x: el.x + direction.dx * step,
            y: el.y + direction.dy * step,
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
  }, [handleUndo, handleRedo, currentTemplate, currentFormat, selectedIds, updateElementLocal, saveTemplate, beginGesture, finishGesture, thermalEditorOrientation]);

  // Clear undo history + selection when switching templates
  useEffect(() => {
    clearUndo();
    setSelectedIds(new Set());
    saveRevision.current++;
    unsavedChanges.current = false;
    setSaveError('');
    setSaving(false);
  }, [selectedTemplateId, clearUndo]);

  const [recovery, setRecovery] = useState<Array<TemplateDraft & {key:string}>>([]);
  useEffect(() => {
    if (templateId) void useTemplateStore.getState().fetchTemplate(templateId);
    try { setRecovery(templateId ? readDrafts(templateId) : []); } catch { setSaveError('Draft recovery storage is unavailable. Keep this tab open until changes save.'); }
  }, [templateId]);
  const recoverCopy = async (draft: LabelTemplate) => {
    try {
      const created = await addTemplate({ name:draft.name+' (recovered)', description:draft.description, formatId:draft.formatId, elements:draft.elements, thermalRenderMode:draft.thermalRenderMode });
      unsavedChanges.current = false;
      router.push(`/designer?id=${created.id}`);
    } catch(error) { setSaveError((error as Error).message); }
  };

  // If no template is selected, show template list view
  if (!currentTemplate || currentTemplate.summaryOnly || !currentFormat) {
    return (
      <AppShell>
        {/* Template List */}
        <div className="flex-1 overflow-auto">
          <BitmapTemplateActions onCreated={(id) => { selectTemplate(id); router.push(`/designer?id=${id}`); }} />
          <TemplateList
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

    commitEdit({ elements: [...currentTemplate.elements, { ...elementData, id: crypto.randomUUID(), zIndex: Math.max(0, ...currentTemplate.elements.map(e => e.zIndex)) + 1 } as TemplateElement] });
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

  return (
    <AppShell beforeLeave={saveBeforeLeaving}>
      <PageTitle title="Designer" />
      <div className="px-4 py-2 flex flex-wrap items-center gap-3 text-xs text-zinc-400 border-b border-zinc-800/50">
        <span role="status" aria-live="polite" className={saveError ? 'text-red-400' : saving ? 'text-amber-400' : 'text-emerald-400'}>{saveError ? 'Not saved' : saving ? 'Saving…' : 'All changes saved'}</span>
        {currentFormat.type === 'thermal' && <>
        <span>{currentTemplate.thermalRenderMode === 'bitmap-v1' ? 'Bitmap label' : 'Native label'}</span>
        <BitmapTemplateActions source={currentTemplate} format={currentFormat} values={testData} onCreated={(id) => { selectTemplate(id); router.push(`/designer?id=${id}`); }} />
        </>}
      </div>
      {saveError && <p role="alert" className="text-red-400 px-6">{saveError} <button className="underline" onClick={() => persistEdits(currentTemplate.id)}>Retry save</button></p>}
      {recovery.length > 0 && <div role="alert" className="px-6 py-2 text-amber-300 text-sm">Recovered unsaved drafts are available. Recovering makes a separate template, so the saved design is not overwritten.
        {recovery.map(draft=><div key={draft.key}>{new Date(draft.savedAt).toLocaleString()} <button className="underline" onClick={()=>void recoverCopy(draft.template)}>Recover as copy</button> <button className="underline ml-3" onClick={()=>{window.localStorage.removeItem(draft.key);setRecovery(items=>items.filter(item=>item.key!==draft.key));}}>Discard this draft</button></div>)}
      </div>}
      {saveError && <button className="text-amber-300 underline px-6 text-left" onClick={()=>void recoverCopy(currentTemplate)}>Save my edits as a separate template</button>}
      {/* Editor layout fills the content area */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-auto lg:overflow-hidden mx-auto w-full">
        {/* Left Panel - Element List + Test Data */}
        <div className="w-full lg:w-[248px] 2xl:w-[280px] lg:shrink-0 min-h-0 flex flex-col border-b lg:border-b-0 lg:border-r border-zinc-800/50 max-h-[420px] lg:max-h-none">
          <div className="grid grid-cols-2 gap-1 p-2 border-b border-zinc-800/50" aria-label="Designer panels">
            <button aria-pressed={leftPanel === 'layers'} onClick={() => setLeftPanel('layers')} className={`rounded-lg px-3 py-2 text-sm font-medium ${leftPanel === 'layers' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:bg-zinc-900'}`}>Layers <span className="text-zinc-400">{currentTemplate.elements.length}</span></button>
            <button aria-pressed={leftPanel === 'data'} onClick={() => setLeftPanel('data')} className={`rounded-lg px-3 py-2 text-sm font-medium ${leftPanel === 'data' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:bg-zinc-900'}`}>Test data</button>
          </div>
          <div className={leftPanel === 'layers' ? 'flex flex-col flex-1 min-h-0' : 'hidden'}>
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
          <div className={leftPanel === 'data' ? 'flex flex-col flex-1 min-h-0' : 'hidden'}>
          <TestDataPanel
            key={currentTemplate.id}
            elements={currentTemplate.elements}
            testData={testData}
            onTestDataChange={(field, value) => setTestData((prev) => { const next = { ...prev, [field]: value }; localStorage.setItem(`lw:test-data:${currentTemplate.id}`, JSON.stringify(next)); return next; })}
          />
          </div>
        </div>

        {/* Center Panel - Preview */}
        <div className="flex-1 flex flex-col min-w-0 min-h-[440px] lg:min-h-0 overflow-y-auto">
          {/* Breadcrumb bar. When a returnTo is set we show a 'Done' CTA
              so the round-trip feels like 'I edited this and came back'
              rather than 'I'm lost in the designer'. */}
          <div className="px-4 py-3 border-b border-zinc-800/50 flex flex-wrap items-center gap-2 text-sm shrink-0">
            {returnTo ? (
              <a
                href={returnTo}
                onClick={e => { e.preventDefault(); void leaveEditor(); }}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 transition-colors"
              >
                ← Done editing
              </a>
            ) : (
              <a
                href="/designer"
                onClick={e => { e.preventDefault(); void leaveEditor(); }}
                className="text-zinc-500 hover:text-amber-400 transition-colors"
              >
                Templates
              </a>
            )}
            <span className="text-zinc-700">/</span>
            <button
              onClick={() => setRenameSource(currentTemplate)}
              className="flex min-w-0 max-w-[min(100%,24rem)] items-center gap-1.5 text-zinc-100 font-semibold hover:text-amber-400 transition-colors"
              title="Rename template"
            >
              <span className="truncate">{currentTemplate.name}</span>
              <Pencil className="w-3.5 h-3.5 shrink-0 text-zinc-600" />
            </button>
            {compatibleFormats.length > 1 && (
              <div className="w-44 shrink-0">
                <CustomSelect
                  value={currentFormat.id}
                  onChange={(value) => void handleChangeFormat(value)}
                  options={compatibleFormats.map((format) => ({
                    value: format.id,
                    label: format.name,
                    sublabel: `${format.width}" × ${format.height}"`,
                  }))}
                />
              </div>
            )}

            {/* Undo/Redo */}
            <div className="ml-auto flex shrink-0 items-center gap-1">
              {showThermalOrientationPicker && (
                <>
                  <div className="flex gap-0.5 p-0.5 bg-zinc-900/80 rounded-md border border-zinc-800/50 mr-1">
                    <button
                      onClick={() => updateThermalEditorOrientation('printer')}
                      title="Edit in printer orientation"
                      className={`px-2 py-1 rounded text-[10px] font-medium transition-all ${
                        thermalEditorOrientation === 'printer'
                          ? 'bg-zinc-700 text-zinc-100'
                          : 'text-zinc-500 hover:text-zinc-200'
                      }`}
                    >
                      Printer
                    </button>
                    <button
                      onClick={() => updateThermalEditorOrientation('upright')}
                      title="Edit upright"
                      className={`px-2 py-1 rounded text-[10px] font-medium transition-all ${
                        thermalEditorOrientation === 'upright'
                          ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                          : 'text-zinc-500 hover:text-zinc-200'
                      }`}
                    >
                      Upright
                    </button>
                  </div>
                  <div className="w-px h-4 bg-zinc-800 mx-1" />
                </>
              )}
              <button
                onClick={handleUndo}
                disabled={!canUndo()}
                title="Undo (Ctrl+Z)"
                aria-label="Undo"
                className={`p-1.5 rounded-lg transition-colors ${canUndo() ? 'text-zinc-400 hover:text-amber-400 hover:bg-amber-500/5' : 'text-zinc-700 cursor-not-allowed'}`}
              >
                <Undo2 className="w-4 h-4" />
              </button>
              <button
                onClick={handleRedo}
                disabled={!canRedo()}
                title="Redo (Ctrl+Shift+Z)"
                aria-label="Redo"
                className={`p-1.5 rounded-lg transition-colors ${canRedo() ? 'text-zinc-400 hover:text-amber-400 hover:bg-amber-500/5' : 'text-zinc-700 cursor-not-allowed'}`}
              >
                <Redo2 className="w-4 h-4" />
              </button>
            </div>
          </div>

          <LabelPreview
            format={currentFormat}
            elements={currentTemplate.elements}
            selectedElementIds={selectedIds}
            editorOrientation={thermalEditorOrientation}
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
            testData={testData}
          />
          {currentFormat.type === 'thermal' ? (
            <ZPLPreview format={currentFormat} template={currentTemplate} testData={testData} />
          ) : (
            <LayoutPreview format={currentFormat} elements={currentTemplate.elements} testData={testData} />
          )}
        </div>

        {/* Right Panel - Properties */}
        <div className="contents" onFocusCapture={beginGesture} onBlurCapture={finishGesture} onKeyDownCapture={e => { if (e.key === 'Escape') { cancelGesture(); (e.target as HTMLElement).blur(); } }}>
        <PropertyPanel
          element={selectedElement}
          selectedElements={currentTemplate.elements.filter((e) => selectedIds.has(e.id))}
          format={currentFormat}
          onUpdate={handleUpdateElement}
          onUpdateSelected={handleUpdateSelectedElements}
          bitmap={currentTemplate.thermalRenderMode === 'bitmap-v1'}
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
    </AppShell>
  );
}

export default function DesignerPage() {
  return (
    <Suspense fallback={
      <div className="h-screen flex items-center justify-center bg-[#0c0c0e]">
        <div className="text-zinc-400">Loading...</div>
      </div>
    }>
      <DesignerContent />
    </Suspense>
  );
}
