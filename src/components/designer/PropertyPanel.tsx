'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Maximize2, Type, QrCode, Barcode, Square, Image, AlertCircle } from 'lucide-react';
import { BarcodeFormat, LabelFormat, TemplateElement, TextElement, QRElement, BarcodeElement, LineElement, RectangleElement, ImageElement } from '@/lib/types';
import { SegmentedIndicator } from '@/components/ui/Segmented';
import { CustomSelect } from '@/components/ui/CustomSelect';
import { MANIFEST_FIELD_OPTIONS } from '@/lib/manifestFields';
import { prepareDesignerImage } from '@/lib/imageUpload';
import { BITMAP_FONTS } from '@/lib/thermal/import';
import type { AlignAction } from '@/lib/thermal/editorGeometry';
import { snapZplQrSize } from '@/lib/zplGenerator';
import { contentModeUpdates } from '@/lib/elementBinding';
import { elementTypeName, friendlyFieldName, nextFieldName } from '@/lib/fieldLabels';
import { Menu } from '@/components/ui/Menu';
import { useRubberBand } from '@/components/motion/rubberBand';
import { describeUnprintable, elementUnprintable, plainPrinterText, plainReplacement } from '@/lib/printerCharacters';
import { parseSizeInput, sizeProblem } from '@/lib/sizeInput';
import { columnChoices, isMadeUpFieldName, readLastColumns } from '@/lib/lastColumns';

interface PropertyPanelProps {
  element: TemplateElement | null;
  selectedElements?: TemplateElement[];
  format: LabelFormat;
  onUpdate: (updates: Partial<TemplateElement>) => void;
  onUpdateSelected?: (updates: Partial<TemplateElement>) => void;
  bitmap?: boolean;
  onArrange?: (action: AlignAction) => void;
  /** Every item on the design: for unique default names and the Manifest picker. */
  allElements?: TemplateElement[];
  /** Layout problems that involve the selected item, in plain words (red when printing must wait, as on the label's notice). */
  problems?: Array<{ text: string; blocking?: boolean }>;
}

/** Each kind of item's icon, the same as in the items list. */
const ITEM_ICONS: Record<string, React.ReactNode> = {
  text: <Type className="size-4" />,
  qr: <QrCode className="size-4" />,
  barcode: <Barcode className="size-4" />,
  line: <span className="w-3 h-0.5 bg-current rounded" />,
  rectangle: <Square className="size-4" />,
  image: <Image className="size-4" />,
};

/** The right-hand panel: a plain surface, no rules or borders. */
const PANEL = 'w-full lg:w-[264px] 2xl:w-[280px] lg:shrink-0 lg:bg-zinc-900 overflow-y-auto';

export function PropertyPanel({ element, selectedElements = [], format, onUpdate, onUpdateSelected, bitmap = false, onArrange, allElements = [], problems = [] }: PropertyPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  useRubberBand(panelRef);
  const [showManifest, setShowManifest] = useState(false);
  // Text before/after stays out of the way until someone asks for it (or it holds something).
  const [affixFor, setAffixFor] = useState<string | null>(null);
  // Columns to pick from: the last spreadsheet loaded on New run, then the ones other items use.
  const [lastColumns] = useState(() => readLastColumns(typeof window === 'undefined' ? null : window.localStorage));
  // Another item's column is offered only to an item of the same kind (a
  // barcode is never offered "Product Name").
  const designNames = allElements.filter((e) => e.id !== element?.id && e.type === element?.type && !e.isStatic && e.fieldName && !isMadeUpFieldName(e.fieldName)).map((e) => e.fieldName!);
  const columnList = rankColumns(columnChoices(lastColumns.headers, designNames), element?.type);
  const multiSelected = selectedElements.length > 1;
  const selectedTextElements = selectedElements.filter((el): el is TextElement => el.type === 'text');

  if (element?.locked || selectedElements.some(e => e.locked)) {
    return <div className={`${PANEL} p-4 text-sm text-zinc-400`}>Some of these items are locked. Unlock them in the items list to change them.</div>;
  }

  if (multiSelected) {
    const canEditTextGroup = selectedTextElements.length === selectedElements.length && !!onUpdateSelected;

    return (
      <div ref={panelRef} className={PANEL}>
        <h2 className="px-4 pt-3 text-sm font-semibold text-zinc-100">
          {canEditTextGroup ? `${selectedTextElements.length} text items` : `${selectedElements.length} items selected`}
        </h2>

        {format.type === 'thermal' && onArrange && <div className="px-3 pt-2">
          <h3 className="px-1 pb-1 text-sm font-medium text-zinc-300">Line up</h3>
          <div className="grid grid-cols-3 gap-1">
          {([['left', 'Left edges'], ['center', 'Centers'], ['right', 'Right edges'], ['top', 'Tops'], ['middle', 'Middles'], ['bottom', 'Bottoms'], ['distribute-x', 'Space across'], ['distribute-y', 'Space down']] as Array<[AlignAction, string]>).map(([action, text]) => <button key={action} disabled={action.startsWith('distribute') && selectedElements.length < 3} title={action.startsWith('distribute') && selectedElements.length < 3 ? 'Select 3 or more items to space them out' : undefined} onClick={() => onArrange(action)} className="btn btn-secondary btn-sm px-1 text-xs">{text}</button>)}
          </div>
        </div>}
        {canEditTextGroup ? (
          <div className="p-3 space-y-1">
            <MultiTextProps
              elements={selectedTextElements}
              onUpdate={onUpdateSelected}
              format={format}
              bitmap={bitmap}
            />
          </div>
        ) : (
          <div className="min-h-20 flex items-center justify-center px-4">
            <p className="text-zinc-400 text-sm">These are different kinds of items. Select one kind to change its settings.</p>
          </div>
        )}
      </div>
    );
  }

  if (!element) {
    // One line, not a second copy of the Items list.
    return (
      <div className={`${PANEL} min-h-20 lg:min-h-0`}>
        <p className="px-4 pt-3 pb-4 text-sm text-zinc-400">{allElements.length ? 'Select an item on the label, or in Items, to change it.' : 'Add an item to the label first.'}</p>
      </div>
    );
  }

  const isThermal = format.type === 'thermal';
  const dpi = format.dpi || 203;
  // Sizes are shown in inches everywhere; thermal designs store dots, so
  // convert at the edge and keep whole dots in the design.
  const toInches = (v: number) => (isThermal ? Math.round((v / dpi) * 100) / 100 : v);
  const fromInches = (v: number) => (isThermal ? Math.round(v * dpi) : v);
  const step = 0.01;
  const labelW = isThermal ? format.width * dpi : format.width;
  const labelH = isThermal ? format.height * dpi : format.height;
  // Sizes that can be used: at least a dot, at most the label. A position may
  // put part of an item off the label, but not the whole item.
  const smallest = isThermal ? Math.ceil((1 / dpi) * 100) / 100 : 0.01;
  const owner = !element.isStatic && element.fieldName ? friendlyFieldName(element.fieldName) : elementTypeName(element.type);
  const whose = (box: string) => `${owner}’s ${box}`;

  // The thermal printer's built-in font only has plain keyboard characters.
  const printerFont = isThermal && !bitmap;
  const unprintable = printerFont ? elementUnprintable(element, {}) : [];
  const replaceUnprintable = () => {
    if (element.type !== 'text') return;
    onUpdate(element.isStatic
      ? { content: plainPrinterText(element.content || '') }
      : { defaultValue: plainPrinterText(element.defaultValue || ''), prefix: plainPrinterText(element.prefix || ''), suffix: plainPrinterText(element.suffix || '') });
  };

  const typeIcons = ITEM_ICONS;

  return (
    <div ref={panelRef} className={PANEL}>
      {/* Item header */}
      <div className="px-4 pt-3 flex items-center gap-2">
        <span className="flex size-4 items-center justify-center text-zinc-400" aria-hidden="true">
          {typeIcons[element.type]}
        </span>
        <h2 className="min-w-0 truncate text-sm font-semibold text-zinc-100">{elementTypeName(element.type)}{!element.isStatic && element.fieldName && !isMadeUpFieldName(element.fieldName) ? `: ${friendlyFieldName(element.fieldName)}` : ''}</h2>
      </div>
      {problems.length > 0 && (
        <ul role="alert" className="mx-4 mt-2 space-y-1 text-sm text-zinc-100">
          {problems.slice(0, 3).map((problem) => <li key={problem.text} className="flex items-start gap-1.5"><AlertCircle className={`mt-0.5 size-4 shrink-0 ${problem.blocking ? 'text-red-400' : 'text-amber-300'}`} aria-hidden="true" />{problem.text}</li>)}
        </ul>
      )}
      {unprintable.length > 0 && (
        <div role="alert" className="mx-4 mt-2 space-y-1 text-sm text-zinc-100">
          <p className="flex items-start gap-1.5"><AlertCircle className="mt-0.5 size-4 shrink-0 text-amber-300" aria-hidden="true" />{describeUnprintable(unprintable)}</p>
          <button type="button" className="btn btn-secondary btn-sm ml-5.5 max-sm:min-h-11" onClick={replaceUnprintable}>{unprintable.every((ch) => plainReplacement(ch) === '-') ? 'Replace with -' : 'Use plain characters'}</button>
        </div>
      )}

      <div className="p-3 space-y-1.5">
        {/* ── Size ── */}
        <SectionLabel icon={<Maximize2 className="w-3 h-3" />} label="Size and place (inches)" />
        {element.type === 'qr' ? (
          <div className="grid grid-cols-1">
            <CompactInput
              label="S"
              min={smallest}
              max={Math.min(format.width, format.height)}
              unit={'"'}
              what={whose('size')}
              value={toInches(element.width)}
              onChange={(v) => {
                const qr = element as QRElement;
                const content = qr.defaultValue || qr.content || 'QR';
                const size = isThermal ? snapZplQrSize(content, qr.errorCorrection || 'M', fromInches(v)) : v;
                onUpdate({ width: size, height: size });
              }}
              step={step}
            />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-1.5">
            <CompactInput label="W" min={smallest} max={Math.max(format.width, format.height)} unit={'"'} what={whose('width')} value={toInches(element.width)} onChange={(v) => onUpdate({ width: fromInches(v) })} step={step} />
            <CompactInput label="H" min={element.type === 'line' ? 0 : smallest} max={Math.max(format.width, format.height)} unit={'"'} what={whose('height')} value={toInches(element.height)} onChange={(v) => onUpdate({ height: fromInches(v) })} step={step} />
          </div>
        )}

        {/* ── Position ── */}
        <div className="grid grid-cols-2 gap-1.5">
          <CompactInput label="X" min={-format.width} max={format.width} unit={'"'} what={whose('distance from the left')} value={toInches(element.x)} onChange={(v) => onUpdate({ x: fromInches(v) })} step={step} />
          <CompactInput label="Y" min={-format.height} max={format.height} unit={'"'} what={whose('distance from the top')} value={toInches(element.y)} onChange={(v) => onUpdate({ y: fromInches(v) })} step={step} />
        </div>

        {/* ── Rotation and alignment ── */}
        <div className="flex items-end gap-2 pt-1">
          <div className="min-w-0 flex-1">
            <span id="rotate-label" className="block pb-1 text-sm text-zinc-400">Turn</span>
            <div className="segmented segmented-xs" role="group" aria-labelledby="rotate-label">
              <SegmentedIndicator index={[0, 90, 180, 270].indexOf(element.rotation)} count={4} />
              {[0, 90, 180, 270].map((deg) => (
                <button
                  key={deg}
                  onClick={() => onUpdate({ rotation: deg })}
                  aria-label={`Turn ${deg} degrees`}
                  aria-pressed={element.rotation === deg}
                >
                  {deg}°
                </button>
              ))}
            </div>
          </div>
          <Menu
            label="Align"
            className="shrink-0"
            items={[
              { label: 'Left edge', onSelect: () => onUpdate({ x: 0 }) },
              { label: 'Center across', onSelect: () => onUpdate({ x: Math.round((labelW - element.width) / 2 * (isThermal ? 1 : 1000)) / (isThermal ? 1 : 1000) }) },
              { label: 'Right edge', onSelect: () => onUpdate({ x: labelW - element.width }) },
              { label: 'Top', onSelect: () => onUpdate({ y: 0 }) },
              { label: 'Center up and down', onSelect: () => onUpdate({ y: Math.round((labelH - element.height) / 2 * (isThermal ? 1 : 1000)) / (isThermal ? 1 : 1000) }) },
              { label: 'Bottom', onSelect: () => onUpdate({ y: labelH - element.height }) },
            ]}
          />
        </div>

        <Divider />

        {/* Images are selected once per run, never bound to source rows. */}
        {element.type !== 'image' && <div className="space-y-1 pt-1">
          <h3 id="content-mode-label" className="text-sm font-medium text-zinc-300">Content</h3>
          <div role="radiogroup" aria-labelledby="content-mode-label">
            {([[true, 'Same on every label'], [false, 'Changes per label']] as const).map(([same, text]) => (
              <label key={text} className="press flex min-h-control-sm cursor-pointer items-center gap-2.5 text-sm text-zinc-100">
                <input
                  type="radio"
                  name={`content-mode-${element.id}`}
                  className="size-4 shrink-0 accent-amber-500"
                  checked={element.isStatic === same}
                  // Per label keeps what was typed as the preview sample and
                  // takes a column name (picked or typed below).
                  onChange={() => onUpdate(same ? contentModeUpdates(element, true) : contentModeUpdates(element, false, () => nextFieldName(element.type, allElements)))}
                />
                {text}
              </label>
            ))}
          </div>
        </div>}

        {element.type !== 'image' && !element.isStatic && (
          <div className="space-y-1.5">
            <ColumnPicker element={element} columns={columnList} fileName={lastColumns.fileName} onUpdate={onUpdate} placeholderName={() => nextFieldName(element.type, allElements.filter((e) => e.id !== element.id))} />
            {(showManifest || readsNabis(element)) ? (
              <StackedField label="Or a Nabis detail">
                {(id) => <CustomSelect
                  compact
                  id={id}
                  value={MANIFEST_FIELD_OPTIONS.some((option) => option.value === element.fieldName) ? element.fieldName || '' : ''}
                  onChange={(v) => { if (v) onUpdate({ fieldName: v }); }}
                  placeholder="Pick a Nabis detail"
                  options={MANIFEST_FIELD_OPTIONS}
                />}
              </StackedField>
            ) : (
              <button type="button" className="min-h-control-sm text-left text-sm text-zinc-400 hover:text-zinc-100" onClick={() => setShowManifest(true)}>Use a Nabis detail instead</button>
            )}
            <StackedField label="Sample for the preview">
              {(id) => <input id={id} type="text" className="field field-sm w-full" value={element.defaultValue || ''} onChange={(e) => onUpdate({ defaultValue: e.target.value })} placeholder={element.type === 'barcode' ? 'e.g. 850010001234' : element.type === 'qr' ? 'e.g. https://lab.example/123' : 'Only shown here, never printed'} />}
            </StackedField>
            {element.type === 'text' && !element.prefix && !element.suffix && affixFor !== element.id && (
              <button type="button" className="min-h-control-sm text-left text-sm text-zinc-400 hover:text-zinc-100" onClick={() => setAffixFor(element.id)}>Add text before or after</button>
            )}
            {element.type === 'text' && (element.prefix || element.suffix || affixFor === element.id) && (
              <div className="grid grid-cols-2 gap-1.5">
                <StackedField label="Text before">
                  {(id) => <input id={id} type="text" className="field field-sm w-full" value={element.prefix || ''} onChange={(e) => onUpdate({ prefix: e.target.value })} placeholder="e.g. SKU:" />}
                </StackedField>
                <StackedField label="Text after">
                  {(id) => <input id={id} type="text" className="field field-sm w-full" value={element.suffix || ''} onChange={(e) => onUpdate({ suffix: e.target.value })} placeholder="e.g. oz" />}
                </StackedField>
              </div>
            )}
          </div>
        )}

        <Divider />

        {/* ── Type-specific ── */}
        {element.type === 'text' && <TextProps element={element as TextElement} onUpdate={onUpdate} format={format} bitmap={bitmap} />}
        {element.type === 'qr' && <QRProps element={element as QRElement} onUpdate={onUpdate} />}
        {element.type === 'barcode' && <BarcodeProps element={element as BarcodeElement} onUpdate={onUpdate} />}
        {element.type === 'line' && <LineProps element={element as LineElement} onUpdate={onUpdate} />}
        {element.type === 'rectangle' && <RectProps element={element as RectangleElement} onUpdate={onUpdate} />}
        {element.type === 'image' && <ImageProps element={element as ImageElement} onUpdate={onUpdate} />}
      </div>
    </div>
  );
}

// ── Type-specific property sections ──

function TextProps({ element, onUpdate, format, bitmap }: { element: TextElement; onUpdate: (u: Partial<TemplateElement>) => void; format: LabelFormat; bitmap: boolean }) {
  return (
    <>
      <SectionLabel icon={<Type className="w-3 h-3" />} label="Text" />
      {element.isStatic && <textarea
        value={element.content}
        aria-label="Text on every label"
        onChange={(e) => onUpdate({ content: e.target.value })}
        placeholder="Type the text"
        rows={3}
        className="field field-sm w-full resize-y py-1.5"
      />}
      <TextStyleControls first={element} onUpdate={onUpdate} format={format} bitmap={bitmap} />
    </>
  );
}

function MultiTextProps({ elements, onUpdate, format, bitmap }: { elements: TextElement[]; onUpdate: (u: Partial<TemplateElement>) => void; format: LabelFormat; bitmap: boolean }) {
  const first = elements[0];
  if (!first) return null;
  return (
    <>
      <SectionLabel icon={<Type className="w-3 h-3" />} label="Text" />
      <TextStyleControls first={first} onUpdate={onUpdate} format={format} bitmap={bitmap} />
    </>
  );
}

/** Size, weight, spacing, letter width, auto-fit, font and alignment. */
function TextStyleControls({ first, onUpdate, format, bitmap }: { first: TextElement; onUpdate: (u: Partial<TemplateElement>) => void; format: LabelFormat; bitmap: boolean }) {
  const isThermal = format.type === 'thermal';
  const widths = [bitmap ? 0.8 : 0.5, bitmap ? 1 : 0.6, bitmap ? 1.2 : 0.8];
  const currentWidth = first.charWidth ?? (bitmap ? 1 : 0.5);
  const autoFit = first.autoFit ?? bitmap;
  return (
    <>
      <div className="grid grid-cols-2 gap-1.5">
        <CompactInput label="Pt" min={1} max={500} what="Text size" value={first.fontSize} onChange={(v) => onUpdate({ fontSize: v })} step={1} labelRight />
        <div className="min-w-0"><span className="block pb-1 text-sm text-zinc-400" aria-hidden="true">Weight</span><CompactSelect ariaLabel="Weight" value={first.fontWeight} options={['normal', 'bold']} labels={['Regular', 'Bold']} onChange={(v) => onUpdate({ fontWeight: v as 'normal' | 'bold' })} /></div>
      </div>
      <CompactInput label="LH" min={0.5} max={5} what="Line spacing" value={first.lineHeight || 1.2} onChange={(v) => onUpdate({ lineHeight: v })} step={0.1} labelRight />
      {isThermal && (
        <>
          <Row label="Letter width" id="letter-width-label" stacked>
            <div className="segmented segmented-xs" role="group" aria-labelledby="letter-width-label">
              <SegmentedIndicator index={widths.indexOf(currentWidth)} count={3} />
              {(['Narrow', 'Normal', 'Wide'] as const).map((text, i) => (
                <button key={text} onClick={() => onUpdate({ charWidth: widths[i] })} aria-pressed={currentWidth === widths[i]}>{text}</button>
              ))}
            </div>
          </Row>
          <div className="flex min-h-control-sm items-center gap-2">
            <button type="button" role="switch" aria-checked={autoFit} onClick={() => onUpdate({ autoFit: !autoFit })} aria-labelledby="autofit-label" className="switch" />
            <span id="autofit-label" className="text-sm text-zinc-300">Shrink long text to fit</span>
          </div>
          {autoFit && <CompactInput label="Min" min={1} max={500} what="Smallest size" value={first.minFontSize ?? 4} onChange={(v) => onUpdate({ minFontSize: Math.max(1, v) })} step={1} labelRight />}
        </>
      )}
      {bitmap && <>
        <Row label="Style"><CompactSelect ariaLabel="Style" value={first.fontStyle ?? 'normal'} options={['normal', 'italic']} labels={['Regular', 'Italic']} onChange={v => onUpdate({ fontStyle: v as 'normal' | 'italic' })} /></Row>
        <CompactInput label="Track" min={-50} max={200} what="Letter spacing" value={first.letterSpacing ?? 0} onChange={v => onUpdate({ letterSpacing: v })} step={0.25} labelRight />
        <Row label="Sits at"><CompactSelect ariaLabel="Where the text sits in its box" value={first.verticalAlign ?? 'top'} options={['top', 'middle', 'bottom']} labels={['Top', 'Middle', 'Bottom']} onChange={v => onUpdate({ verticalAlign: v as 'top' | 'middle' | 'bottom' })} /></Row>
      </>}
      {isThermal && !bitmap ? (
        <p className="text-sm text-zinc-400">Prints in the printer&rsquo;s built-in font.</p>
      ) : (
        <Row label="Font"><CompactSelect ariaLabel="Font" value={first.fontFamily} options={bitmap ? BITMAP_FONTS : ['Arial', 'Helvetica', 'IBM Plex Mono', 'Times New Roman', 'Courier', 'monospace']} onChange={(v) => onUpdate({ fontFamily: v })} /></Row>
      )}
      <Row label="Align" id="text-align-label" stacked>
        <div className="segmented segmented-xs" role="group" aria-labelledby="text-align-label">
          <SegmentedIndicator index={['left', 'center', 'right'].indexOf(first.textAlign)} count={3} />
          {(['left', 'center', 'right'] as const).map((a) => (
            <button key={a} onClick={() => onUpdate({ textAlign: a })} aria-pressed={first.textAlign === a}>{a.charAt(0).toUpperCase() + a.slice(1)}</button>
          ))}
        </div>
      </Row>
      {format.type === 'sheet' && <ColorRow label="Color" value={first.color} onChange={(v) => onUpdate({ color: v })} />}
    </>
  );
}

function QRProps({ element, onUpdate }: { element: QRElement; onUpdate: (u: Partial<TemplateElement>) => void }) {
  return (
    <>
      <SectionLabel icon={<QrCode className="w-3 h-3" />} label="QR code" />
      {element.isStatic
        ? <CompactTextInput label="" value={element.content} onChange={(v) => onUpdate({ content: v })} placeholder="Web address or text" full />
        : null}
      <Row label="Still scans if scuffed">
        <CompactSelect
          ariaLabel="How much damage the QR code survives"
          value={element.errorCorrection}
          options={['L', 'M', 'Q', 'H']}
          labels={['A little (smallest)', 'Some (best for most)', 'More', 'Most (largest)']}
          onChange={(v) => onUpdate({ errorCorrection: v as 'L' | 'M' | 'Q' | 'H' })}
        />
      </Row>
    </>
  );
}

const BARCODE_TYPES: Array<[BarcodeFormat, string]> = [
  ['CODE128', 'Letters and numbers (most labels)'],
  ['CODE39', 'Capitals and numbers only'],
  ['UPC', 'Store product code, 12 digits'],
  ['EAN13', 'Store product code, 13 digits'],
  ['EAN8', 'Short product code, 8 digits'],
  ['ITF14', 'Carton code, 14 digits'],
];

function BarcodeProps({ element, onUpdate }: { element: BarcodeElement; onUpdate: (u: Partial<TemplateElement>) => void }) {
  return (
    <>
      <SectionLabel icon={<Barcode className="w-3 h-3" />} label="Barcode" />
      {element.isStatic
        ? <CompactTextInput label="" value={element.content} onChange={(v) => onUpdate({ content: v })} placeholder="Number or text" full />
        : null}
      <Row label="Type">
        <CompactSelect ariaLabel="Barcode type" value={element.barcodeFormat} options={BARCODE_TYPES.map(([v]) => v)} labels={BARCODE_TYPES.map(([, l]) => l)} onChange={(v) => onUpdate({ barcodeFormat: v as BarcodeFormat })} />
      </Row>
      <div className="flex min-h-control-sm items-center justify-between gap-2">
        <span id="barcode-text-label" className="text-sm text-zinc-300">Show the number under it</span>
        <Toggle checked={element.showText} onChange={(v) => onUpdate({ showText: v })} labelledBy="barcode-text-label" />
      </div>
    </>
  );
}

function LineProps({ element, onUpdate }: { element: LineElement; onUpdate: (u: Partial<TemplateElement>) => void }) {
  return (
    <>
      <SectionLabel icon={<span className="w-3 h-0.5 bg-current rounded" />} label="Line" />
      <Row label="Style"><CompactSelect ariaLabel="Line style" value={element.lineStyle || 'solid'} options={['solid', 'dotted', 'dashed']} labels={['Solid', 'Dotted', 'Dashed']} onChange={(v) => onUpdate({ lineStyle: v as LineElement['lineStyle'] })} /></Row>
      <CompactInput label="Wt" min={0} max={1000} what="Thickness" value={element.strokeWidth} onChange={(v) => onUpdate({ strokeWidth: v })} step={0.5} labelRight />
      <ColorRow label="Color" value={element.color} onChange={(v) => onUpdate({ color: v })} />
    </>
  );
}

function RectProps({ element, onUpdate }: { element: RectangleElement; onUpdate: (u: Partial<TemplateElement>) => void }) {
  return (
    <>
      <SectionLabel icon={<Square className="w-3 h-3" />} label="Box" />
      <div className="grid grid-cols-2 gap-1.5">
        <CompactInput label="Bdr" min={0} max={1000} what="Border" value={element.strokeWidth} onChange={(v) => onUpdate({ strokeWidth: v })} step={0.5} labelRight />
        <CompactInput label="Rad" min={0} max={1000} what="Corners" value={element.borderRadius} onChange={(v) => onUpdate({ borderRadius: v })} step={1} labelRight />
      </div>
      <ColorRow label="Border" value={element.strokeColor} onChange={(v) => onUpdate({ strokeColor: v })} />
      <ColorRow label="Fill" value={element.fillColor || '#000000'} onChange={(v) => onUpdate({ fillColor: v })} />
    </>
  );
}

function ImageProps({ element, onUpdate }: { element: ImageElement; onUpdate: (u: Partial<TemplateElement>) => void }) {
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadError(null); setUploading(true);
    try { onUpdate({ src: await prepareDesignerImage(file) }); }
    catch (error) { setUploadError((error as Error).message); }
    finally { setUploading(false); }
  };
  return (
    <>
      <SectionLabel icon={<Image className="w-3 h-3" />} label="Picture" />
      <div className="flex items-center gap-2">
        {element.src && <img src={element.src} alt="" className="size-10 shrink-0 rounded-md bg-white object-contain" />}
        <button type="button" disabled={uploading} onClick={() => fileInput.current?.click()} className="btn btn-secondary btn-sm">{element.src ? 'Replace picture…' : 'Choose a picture…'}</button>
        <input
          ref={fileInput}
          type="file"
          tabIndex={-1}
          aria-hidden="true"
          accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
          onChange={e => void handleUpload(e)}
          className="sr-only"
        />
      </div>
      {uploading && <p className="text-sm text-zinc-400">Preparing the picture…</p>}
      {uploadError && <p role="alert" className="text-sm text-red-400">{uploadError}</p>}
      <Row label="Picture fit">
        <CompactSelect ariaLabel="Picture fit" value={element.objectFit} options={['contain', 'cover', 'fill']} labels={['Shrink to fit', 'Fill and crop', 'Stretch']} onChange={(v) => onUpdate({ objectFit: v as ImageElement['objectFit'] })} />
      </Row>
      <label className="flex min-h-control-sm items-center gap-2 text-sm text-zinc-300">
        <input type="checkbox" className="size-4 accent-amber-500" checked={element.runSelectable ?? false} onChange={e => onUpdate({ runSelectable: e.target.checked, isStatic: true })} />
        Pick the picture when starting a run
      </label>
      {element.runSelectable && <p className="text-sm text-zinc-400">One picture for the whole run. This one is used if you don&rsquo;t pick another.</p>}
    </>
  );
}

// ── Primitives ──

// Icons are accepted for call-site compatibility but not drawn: a plain
// heading reads faster in a dense panel.
function SectionLabel({ label }: { icon?: React.ReactNode; label: string }) {
  return <h3 className="pt-3 pb-0.5 text-sm font-medium text-zinc-300">{label}</h3>;
}

function Divider() {
  return <div className="h-1" aria-hidden="true" />;
}

/** A label to the left of a control, so every select says what it is. */
function Row({ label, id, children, stacked }: { label: string; id?: string; children: React.ReactNode; stacked?: boolean }) {
  return (
    <div className={stacked ? 'space-y-1 pt-1' : 'flex min-h-control-sm items-center gap-2'}>
      <span id={id} className={stacked ? 'block text-sm text-zinc-400' : 'w-24 shrink-0 text-sm text-zinc-400'}>{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** A label above a text field, with an optional one-line hint below. */
function StackedField({ label, hint, children }: { label: string; hint?: string; children: (id: string) => React.ReactNode }) {
  const id = useId();
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm text-zinc-400">{label}</label>
      {children(id)}
      {hint && <p className="text-xs text-zinc-400">{hint}</p>}
    </div>
  );
}

/** Columns that look like this kind of item's come first ("SKU" for a barcode). */
function rankColumns(columns: string[], type: string | undefined): string[] {
  const looks = type === 'barcode' ? /sku|tag|barcode|upc|ean|code|\bid\b|uid|number/i
    : type === 'qr' ? /url|link|coa|qr|web|lab/i
      : /name|product|strain|item|title|description|weight|size|price|date|lot|batch/i;
  return [...columns.filter((c) => looks.test(c)), ...columns.filter((c) => !looks.test(c))];
}

/**
 * Which spreadsheet column fills a per-label item, as one question with one
 * control on every item: a box for the column's heading (empty until it has
 * one, never "Text 1"), with the known headings as suggestions to tap. The
 * item takes the column's name, so a spreadsheet with that heading fills it
 * (capitals and spaces don't matter).
 */
function ColumnPicker({ element, columns, fileName, onUpdate, placeholderName }: { element: TemplateElement; columns: string[]; fileName?: string; onUpdate: (updates: Partial<TemplateElement>) => void; placeholderName: () => string }) {
  const current = element.fieldName || '';
  const madeUp = isMadeUpFieldName(current);
  const simple = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');
  const suggestions = columns.filter((name) => simple(name) !== simple(current)).slice(0, 6);
  const kind = element.type === 'barcode' ? 'barcode' : element.type === 'qr' ? 'QR code' : element.type === 'text' ? 'text' : 'item';
  // The known headings show while choosing: the box is empty or being typed in.
  const [choosing, setChoosing] = useState(false);
  return (
    <StackedField label="What is this column called in your spreadsheet?" hint={madeUp ? `Until then it shows as “${kind}” on New run.` : undefined}>
      {(id) => <div
        className="space-y-1.5"
        onFocus={() => setChoosing(true)}
        onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setChoosing(false); }}
      >
        <input
          id={id}
          type="text"
          className="field field-sm w-full"
          value={madeUp ? '' : current}
          // An empty box keeps the item per label under its stand-in name.
          onChange={(e) => onUpdate({ fieldName: e.target.value.trim() ? e.target.value : placeholderName() })}
          placeholder={element.type === 'barcode' ? 'e.g. SKU' : element.type === 'qr' ? 'e.g. Lab Results Link' : 'e.g. Product Name'}
        />
        {suggestions.length > 0 && (madeUp || choosing) && (
          <div className="space-y-1">
            <p className="text-xs text-zinc-400">{fileName ? `From your last file, ${fileName}:` : 'Columns this design uses:'}</p>
            <div className="flex flex-wrap gap-1.5">
              {suggestions.map((name) => (
                <button key={name} type="button" className="btn btn-secondary btn-sm max-sm:min-h-11" onMouseDown={(e) => e.preventDefault()} onClick={() => onUpdate({ fieldName: name })}>{name}</button>
              ))}
            </div>
          </div>
        )}
      </div>}
    </StackedField>
  );
}

/** Show the Nabis picker for an item that already reads a Nabis detail (others get a link). */
function readsNabis(current: TemplateElement): boolean {
  return !!current.fieldName && MANIFEST_FIELD_OPTIONS.some((o) => o.value === current.fieldName);
}

function CompactInput({ label, value, onChange, step, min, max, unit = '', what }: {
  label: string; value: number; onChange: (v: number) => void; step: number; labelRight?: boolean;
  /** The values that can be used; anything else is refused with a plain message. */
  min?: number; max?: number; unit?: string;
  /** Whose value this is, for the message: "Barcode 1’s width". */
  what?: string;
}) {
  const accessibleLabel = ({ S: 'QR size', W: 'Width', H: 'Height', X: 'Distance from left edge', Y: 'Distance from top edge', Pt: 'Font size in points', LH: 'Line spacing', CW: 'Letter width', Min: 'Smallest font size for auto-fit', Track: 'Letter spacing', Wt: 'Line thickness in dots', Bdr: 'Border thickness in dots', Rad: 'Corner rounding in dots' } as Record<string, string>)[label] || label;
  const visibleLabel = VISIBLE_LABELS[label] || label;
  const [draft, setDraft] = useState(() => formatInputNumber(value));
  const [isFocused, setIsFocused] = useState(false);
  const [problem, setProblem] = useState('');
  const errorId = useId();

  useEffect(() => {
    if (!isFocused) setDraft(formatInputNumber(value));
  }, [isFocused, value]);

  const range = { min, max, unit, what: what ?? visibleLabel };
  // A usable value, or the reason it can't be used (never a silent 0 or 112).
  const read = (text: string): { value: number } | { problem: string } => {
    const parsed = parseSizeInput(text);
    const reason = sizeProblem(text, parsed, range);
    return reason || !parsed.ok ? { problem: reason || '' } : { value: parsed.value };
  };

  const commit = (nextDraft: string) => {
    const result = read(nextDraft);
    if ('value' in result) {
      setProblem('');
      if (result.value !== value) onChange(result.value);
      setDraft(formatInputNumber(result.value));
      return;
    }
    // Keep the last good value and say why the typed one wasn't used.
    setProblem(result.problem);
    setDraft(formatInputNumber(value));
  };

  return (
    <label className="block min-w-0">
      <span className="block pb-1 text-sm text-zinc-400">{visibleLabel}</span>
      <input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        aria-label={accessibleLabel}
        aria-invalid={problem ? true : undefined}
        aria-describedby={problem ? errorId : undefined}
        title={accessibleLabel}
        value={draft}
        onFocus={() => setIsFocused(true)}
        onChange={(e) => {
          const nextDraft = e.target.value;
          setDraft(nextDraft);
          setProblem('');
          // Live preview only for a value that can be used.
          const result = read(nextDraft);
          if ('value' in result && result.value !== value) onChange(result.value);
        }}
        onBlur={() => {
          setIsFocused(false);
          commit(draft);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.currentTarget.blur();
          } else if (e.key === 'Escape') {
            setDraft(formatInputNumber(value));
            setProblem('');
            e.currentTarget.blur();
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const delta = (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
            let next = Math.round((value + delta) * 1000) / 1000;
            if (min !== undefined) next = Math.max(min, next);
            if (max !== undefined) next = Math.min(max, next);
            setProblem('');
            setDraft(formatInputNumber(next));
            if (next !== value) onChange(next);
          }
        }}
        className={`field field-sm w-full tabular-nums ${problem ? 'border-red-500/70' : ''}`}
      />
      {problem && <span id={errorId} role="alert" className="block pt-1 text-sm text-red-400">{problem}</span>}
    </label>
  );
}

const VISIBLE_LABELS: Record<string, string> = { S: 'Size', W: 'Width', H: 'Height', X: 'From left', Y: 'From top', Pt: 'Text size (pt)', LH: 'Line spacing', CW: 'Letter width', Min: 'Smallest size (pt)', Track: 'Letter spacing', Wt: 'Thickness', Bdr: 'Border', Rad: 'Corners' };

function formatInputNumber(value: number): string {
  return Number.isFinite(value) ? String(Math.round(value * 1000) / 1000) : '';
}

function CompactTextInput({ label, value, onChange, placeholder, full }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; full?: boolean;
}) {
  return (
    <input
      type="text"
      aria-label={label || placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`field field-sm ${full ? 'w-full' : 'min-w-0 flex-1'}`}
    />
  );
}

function CompactSelect({ value, options, labels, onChange, ariaLabel }: {
  value: string; options: string[]; labels?: string[]; onChange: (v: string) => void; ariaLabel?: string;
}) {
  return (
    <CustomSelect
      compact
      aria-label={ariaLabel}
      value={value}
      onChange={onChange}
      options={options.map((o, i) => ({ value: o, label: labels ? labels[i] : o }))}
    />
  );
}

function ColorRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-2 h-control-sm">
      <span className="text-sm text-zinc-400 w-24 flex-shrink-0">{label}</span>
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="size-7 rounded border border-zinc-700 bg-transparent cursor-pointer flex-shrink-0"
      />
    </label>
  );
}

function Toggle({ checked, onChange, labelledBy }: { checked: boolean; onChange: (v: boolean) => void; labelledBy?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      onClick={() => onChange(!checked)}
      className="switch"
    />
  );
}
