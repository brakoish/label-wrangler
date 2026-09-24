'use client';

import { useState, useEffect, useId, useMemo } from 'react';
import QRCode from 'qrcode';
import JsBarcode from 'jsbarcode';
import { Plus, FileText, Archive, RotateCcw, Type, QrCode, Barcode, Square, Image, Minus, Copy, Pencil } from 'lucide-react';
import { BarcodeElement, ImageElement, LabelFormat, LabelTemplate, LineElement, QRElement, RectangleElement, TemplateElement, TextElement } from '@/lib/types';
import { useFormatStore } from '@/lib/store';
import { CustomSelect } from '@/components/ui/CustomSelect';
import { generateZPLWithImages } from '@/lib/zplGenerator';
import { renderZplToDataUrl } from '@/lib/zplRenderClient';
import { getBitmapProof } from '@/lib/thermal/client';
import { layoutThermalText, wrapThermalText } from '@/lib/thermalTextLayout';

interface TemplateListProps {
  templates: LabelTemplate[];
  onSelectTemplate: (id: string) => void;
  onDeleteTemplate: (id: string) => Promise<void>;
  onRestoreTemplate: (id: string) => Promise<void>;
  onDuplicateTemplate?: (template: LabelTemplate) => void;
  onRenameTemplate?: (template: LabelTemplate) => void;
  onNewTemplate: () => void;
}

export function TemplateList({
  templates,
  onSelectTemplate,
  onDeleteTemplate,
  onRestoreTemplate,
  onDuplicateTemplate,
  onRenameTemplate,
  onNewTemplate,
}: TemplateListProps) {
  const { formats } = useFormatStore();
  const [showArchived, setShowArchived] = useState(false);
  const [error, setError] = useState('');
  const [pendingId, setPendingId] = useState<string | null>(null);
  const visibleTemplates = templates.filter((t) => Boolean(t.archivedAt) === showArchived);
  const changeArchive = async (template: LabelTemplate) => {
    setError('');
    setPendingId(template.id);
    try {
      await (template.archivedAt ? onRestoreTemplate(template.id) : onDeleteTemplate(template.id));
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to update template. Please try again.');
    } finally {
      setPendingId(null);
    }
  };

  return (
    <div className="max-w-[1600px] mx-auto w-full p-8">
      <div className="flex gap-3 mb-6">
        <button onClick={() => setShowArchived(false)} aria-pressed={!showArchived} className={!showArchived ? 'text-amber-400' : 'text-zinc-400'}>Active ({templates.filter((t) => !t.archivedAt).length})</button>
        <button onClick={() => setShowArchived(true)} aria-pressed={showArchived} className={showArchived ? 'text-amber-400' : 'text-zinc-400'}>Archived ({templates.filter((t) => t.archivedAt).length})</button>
      </div>
      {error && <p role="alert" className="text-red-400 mb-4">{error}</p>}
      {visibleTemplates.length === 0 ? (
        <div className="flex items-center justify-center py-24">
          <div className="text-center max-w-sm">
            <div className="w-20 h-20 mx-auto mb-6 rounded-3xl bg-gradient-to-br from-zinc-800 to-zinc-900 flex items-center justify-center border border-zinc-800">
              <FileText className="w-10 h-10 text-zinc-600" />
            </div>
            <h3 className="text-zinc-300 font-semibold text-lg">{showArchived ? 'No archived templates' : 'No active templates'}</h3>
            <p className="text-zinc-500 text-sm mt-2">
              {showArchived ? 'Archived templates will appear here. Saved runs keep working.' : 'Create a template or restore one from Archived.'}
            </p>
            <button
              onClick={onNewTemplate}
              className="mt-4 text-amber-400 hover:text-amber-300 text-sm font-medium"
            >
              Create your first template
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {/* New Template card */}
          <button
            onClick={onNewTemplate}
            className="rounded-2xl border-2 border-dashed border-zinc-800 hover:border-amber-500/30 p-6 flex flex-col items-center justify-center gap-3 text-zinc-500 hover:text-amber-400 transition-all min-h-[240px] group"
          >
            <div className="w-12 h-12 rounded-xl bg-zinc-900 border border-zinc-800 group-hover:border-amber-500/30 group-hover:bg-amber-500/5 flex items-center justify-center transition-all">
              <Plus className="w-6 h-6" />
            </div>
            <span className="text-sm font-medium">New Template</span>
          </button>

          {visibleTemplates.map((template) => {
            const format = formats.find((f) => f.id === template.formatId);
            return (
              <TemplateCard
                key={template.id}
                template={template}
                format={format}
                onSelect={() => onSelectTemplate(template.id)}
                onDelete={() => void changeArchive(template)}
                pending={pendingId !== null}
                onDuplicate={onDuplicateTemplate ? () => onDuplicateTemplate(template) : undefined}
                onRename={onRenameTemplate ? () => onRenameTemplate(template) : undefined}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function sampleDataForTemplate(template: LabelTemplate) {
  const values: Record<string, string> = {};
  for (const element of template.elements) {
    if (element.isStatic || !element.fieldName || values[element.fieldName]) continue;
    values[element.fieldName] = element.defaultValue || element.fieldName;
  }
  return values;
}

function resolveElementContent(element: TemplateElement, testData?: Record<string, string>): string {
  if (element.isStatic) {
    if ('content' in element) return element.content || '';
    return '';
  }

  const value = (element.fieldName && testData?.[element.fieldName])
    || element.defaultValue
    || element.fieldName
    || '';

  return `${element.prefix || ''}${value}${element.suffix || ''}`;
}

function labelViewBox(format: LabelFormat) {
  const dpi = format.dpi || 203;
  return {
    vbW: format.type === 'thermal' ? format.width * dpi : format.width,
    vbH: format.type === 'thermal' ? format.height * dpi : format.height,
  };
}

// Mini label preview — renders the actual template instead of a gray skeleton.
function MiniPreview({ template, format }: { template: LabelTemplate; format?: LabelFormat }) {
  const [thermalUrl, setThermalUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [draftWarning, setDraftWarning] = useState('');
  const sampleData = useMemo(() => sampleDataForTemplate(template), [template]);

  useEffect(() => {
    let active = true;
    setThermalUrl(null); setPreviewError(''); setDraftWarning('');
    if (!format || format.type !== 'thermal') return () => { active = false; };

    const preview = template.thermalRenderMode === 'bitmap-v1'
      ? getBitmapProof(template, format, sampleData, true).then(result => {
          if (active) setDraftWarning(result.warnings?.[0]?.message || '');
          return result.proof;
        })
      : generateZPLWithImages(template, format, sampleData).then(zpl => renderZplToDataUrl(zpl, format));
    preview
      .then((url) => { if (active) setThermalUrl(url); })
      .catch(error => { if (active) setPreviewError(error instanceof Error ? error.message : 'Preview unavailable'); });

    return () => { active = false; };
  }, [format, sampleData, template]);

  if (!format) return <div className="w-full h-full bg-zinc-900 rounded-lg" />;

  if (format.type === 'thermal' && thermalUrl) {
    return (
      <div className="relative w-full h-full flex items-center justify-center rounded-lg bg-zinc-950">
        <img
          src={thermalUrl}
          alt={`${template.name} preview`}
          className="max-w-full max-h-full object-contain"
          style={{ imageRendering: 'pixelated' }}
        />
        {draftWarning && <span title={draftWarning} className="absolute bottom-1 left-1 rounded bg-amber-950 px-1 text-xs text-amber-300">Draft · needs attention</span>}
      </div>
    );
  }

  if (template.thermalRenderMode === 'bitmap-v1') return <p className="text-xs text-zinc-500 p-3">{previewError ? `Preview unavailable: ${previewError}` : 'Loading bitmap preview…'}</p>;
  const { vbW, vbH } = labelViewBox(format);

  const pad = Math.min(vbW, vbH) * 0.08;
  const totalW = vbW + pad * 2;
  const totalH = vbH + pad * 2;

  return (
    <svg
      viewBox={`${-pad} ${-pad} ${totalW} ${totalH}`}
      className="w-full h-full"
      preserveAspectRatio="xMidYMid meet"
    >
      {/* Background */}
      <rect x={-pad} y={-pad} width={totalW} height={totalH} fill="#18181b" rx={pad * 0.4} />
      {/* Label surface */}
      <rect x={0} y={0} width={vbW} height={vbH} fill="#ffffff" stroke="#3f3f46" strokeWidth={Math.min(vbW, vbH) * 0.006} rx={Math.min(vbW, vbH) * 0.01} />
      <MiniPreviewElements template={template} format={format} testData={sampleData} vbW={vbW} />
    </svg>
  );
}

function MiniPreviewElements({ template, format, testData, vbW }: { template: LabelTemplate; format: LabelFormat; testData: Record<string, string>; vbW: number }) {
  return (
    <>
      {[...template.elements].sort((a, b) => a.zIndex - b.zIndex).map((element) => (
        <MiniPreviewElement key={element.id} element={element} format={format} testData={testData} vbW={vbW} />
      ))}
    </>
  );
}

function MiniPreviewElement({ element, format, testData, vbW }: { element: TemplateElement; format: LabelFormat; testData: Record<string, string>; vbW: number }) {
  const transform = `translate(${element.x} ${element.y}) rotate(${element.rotation || 0})`;

  switch (element.type) {
    case 'text':
      return <MiniText element={element as TextElement} format={format} testData={testData} transform={transform} />;
    case 'qr':
      return <MiniQr element={element as QRElement} testData={testData} transform={transform} />;
    case 'barcode':
      return <MiniBarcode element={element as BarcodeElement} testData={testData} transform={transform} />;
    case 'rectangle':
      return <MiniRectangle element={element as RectangleElement} format={format} transform={transform} />;
    case 'line':
      return <MiniLine element={element as LineElement} format={format} transform={transform} />;
    case 'image':
      return <MiniImage element={element as ImageElement} transform={transform} vbW={vbW} />;
    default:
      return null;
  }
}

function MiniText({ element, format, testData, transform }: { element: TextElement; format: LabelFormat; testData: Record<string, string>; transform: string }) {
  const content = resolveElementContent(element, testData);
  if (!content) return null;

  const dpi = format.dpi || 203;
  const thermalLayout = format.type === 'thermal' && element.autoFit === true
    ? layoutThermalText({
        content,
        width: element.width,
        height: element.height,
        fontSize: element.fontSize,
        dpi,
        lineHeight: element.lineHeight,
        charWidth: element.charWidth,
        autoFit: element.autoFit,
        minFontSize: element.minFontSize,
      })
    : null;
  const fontSize = thermalLayout?.fontHeight ?? (format.type === 'thermal' ? element.fontSize * (dpi / 72) : element.fontSize / 72);
  const lineHeight = thermalLayout?.lineAdvance ?? fontSize * (element.lineHeight || 1.2);
  const maxChars = Math.max(1, Math.floor(element.width / Math.max(1, fontSize * (element.charWidth ?? 0.5))));
  const visibleLines = thermalLayout?.visibleLines ?? wrapThermalText(content, maxChars).slice(0, Math.max(1, Math.floor(element.height / lineHeight)));

  let x = 0;
  let anchor: 'start' | 'middle' | 'end' = 'start';
  if (element.textAlign === 'center') {
    x = element.width / 2;
    anchor = 'middle';
  } else if (element.textAlign === 'right') {
    x = element.width;
    anchor = 'end';
  }

  return (
    <text
      transform={transform}
      fontSize={fontSize}
      fontFamily={element.fontFamily}
      fontWeight={element.fontWeight}
      fill={format.type === 'thermal' ? '#000000' : element.color || '#111827'}
      textAnchor={anchor}
    >
      {visibleLines.map((line, index) => (
        <tspan key={`${element.id}-${index}`} x={x} y={fontSize * 0.85 + index * lineHeight}>
          {line}
        </tspan>
      ))}
    </text>
  );
}

function MiniQr({ element, testData, transform }: { element: QRElement; testData: Record<string, string>; transform: string }) {
  const [dataUrl, setDataUrl] = useState('');
  const content = resolveElementContent(element, testData) || 'QR';

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(content, {
      errorCorrectionLevel: element.errorCorrection,
      width: 128,
      margin: 0,
      color: { dark: '#000000', light: '#ffffff' },
    })
      .then((url: string) => { if (active) setDataUrl(url); })
      .catch(() => { if (active) setDataUrl(''); });
    return () => { active = false; };
  }, [content, element.errorCorrection]);

  if (!dataUrl) return <rect transform={transform} x={0} y={0} width={element.width} height={element.height} fill="#d4d4d8" />;

  return (
    <image
      transform={transform}
      x={0}
      y={0}
      width={element.width}
      height={element.height}
      href={dataUrl}
      preserveAspectRatio="xMidYMid meet"
    />
  );
}

function MiniBarcode({ element, testData, transform }: { element: BarcodeElement; testData: Record<string, string>; transform: string }) {
  const [barcodeData, setBarcodeData] = useState<{ svg: string; viewBox: string } | null>(null);
  const clipId = useId().replace(/:/g, '');
  const content = resolveElementContent(element, testData) || '123456789';

  useEffect(() => {
    try {
      const tempSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      JsBarcode(tempSvg, content, {
        format: element.barcodeFormat,
        width: 2,
        height: 80,
        displayValue: element.showText,
        margin: 0,
        fontSize: 14,
      });
      const w = tempSvg.getAttribute('width') || '200';
      const h = tempSvg.getAttribute('height') || '100';
      setBarcodeData({ svg: tempSvg.innerHTML, viewBox: `0 0 ${w} ${h}` });
    } catch {
      setBarcodeData(null);
    }
  }, [content, element.barcodeFormat, element.showText]);

  if (!barcodeData) return <rect transform={transform} x={0} y={0} width={element.width} height={element.height} fill="#d4d4d8" />;

  return (
    <g transform={transform}>
      <clipPath id={clipId}>
        <rect x={0} y={0} width={element.width} height={element.height} />
      </clipPath>
      <svg
        x={0}
        y={0}
        width={element.width}
        height={element.height}
        viewBox={barcodeData.viewBox}
        preserveAspectRatio="xMidYMid meet"
        clipPath={`url(#${clipId})`}
      >
        <g dangerouslySetInnerHTML={{ __html: barcodeData.svg }} />
      </svg>
    </g>
  );
}

function MiniRectangle({ element, format, transform }: { element: RectangleElement; format: LabelFormat; transform: string }) {
  const dpi = format.dpi || 203;
  const strokeWidth = format.type === 'thermal' ? Math.max(1, element.strokeWidth * (dpi / 72)) : element.strokeWidth / 72;
  return (
    <rect
      transform={transform}
      x={0}
      y={0}
      width={element.width}
      height={element.height}
      fill={element.fillColor || 'none'}
      stroke={format.type === 'thermal' ? '#000000' : element.strokeColor || '#111827'}
      strokeWidth={strokeWidth}
      rx={element.borderRadius}
    />
  );
}

function MiniLine({ element, format, transform }: { element: LineElement; format: LabelFormat; transform: string }) {
  const dpi = format.dpi || 203;
  const strokeWidth = format.type === 'thermal' ? Math.max(1, element.strokeWidth * (dpi / 72)) : element.strokeWidth / 72;
  return (
    <line
      transform={transform}
      x1={0}
      y1={0}
      x2={element.width}
      y2={element.height}
      stroke={format.type === 'thermal' ? '#000000' : element.color || '#111827'}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
    />
  );
}

function MiniImage({ element, transform, vbW }: { element: ImageElement; transform: string; vbW: number }) {
  if (!element.src) return <rect transform={transform} x={0} y={0} width={element.width} height={element.height} fill="#3f3f46" rx={vbW * 0.005} />;
  return (
    <image
      transform={transform}
      x={0}
      y={0}
      width={element.width}
      height={element.height}
      href={element.src}
      preserveAspectRatio={element.objectFit === 'fill' ? 'none' : element.objectFit === 'cover' ? 'xMidYMid slice' : 'xMidYMid meet'}
    />
  );
}

function TemplateCard({
  template,
  format,
  onSelect,
  onDelete,
  pending,
  onDuplicate,
  onRename,
}: {
  template: LabelTemplate;
  format?: LabelFormat;
  onSelect: () => void;
  onDelete: () => void;
  pending: boolean;
  onDuplicate?: () => void;
  onRename?: () => void;
}) {
  const dynamicCount = template.elements.filter((e) => !e.isStatic).length;
  const formatName = format?.name || 'Unknown Format';
  const formatType = format?.type || 'sheet';

  // Element type summary
  const typeCounts: Record<string, number> = {};
  template.elements.forEach((e) => {
    typeCounts[e.type] = (typeCounts[e.type] || 0) + 1;
  });

  const typeIcons: Record<string, React.ReactNode> = {
    text: <Type className="w-3 h-3" />,
    qr: <QrCode className="w-3 h-3" />,
    barcode: <Barcode className="w-3 h-3" />,
    rectangle: <Square className="w-3 h-3" />,
    line: <Minus className="w-3 h-3" />,
    image: <Image className="w-3 h-3" />,
  };

  return (
    <div
      onClick={onSelect}
      className="glass rounded-2xl border border-zinc-800 hover:border-amber-500/30 transition-all cursor-pointer group overflow-hidden"
    >
      {/* Preview area */}
      <div className="h-[140px] bg-zinc-950 p-3 border-b border-zinc-800/50">
        {template.elements.length > 0 ? (
          <MiniPreview template={template} format={format} />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-zinc-700 text-xs">Empty template</span>
          </div>
        )}
      </div>

      {/* Info area */}
      <div className="p-4">
        <div className="flex items-start justify-between mb-2">
          <h3 className="text-sm font-semibold text-zinc-100 truncate group-hover:text-amber-400 transition-colors flex-1">
            {template.name}
          </h3>
          <div className="flex items-center gap-0.5 ml-2 flex-shrink-0">
            {onRename && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRename();
                }}
                className="p-1 rounded-lg hover:bg-amber-500/10 text-zinc-600 hover:text-amber-400 transition-colors"
                title="Rename template"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
            )}
            {onDuplicate && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDuplicate();
                }}
                className="p-1 rounded-lg hover:bg-amber-500/10 text-zinc-600 hover:text-amber-400 transition-colors"
                title="Duplicate to another format"
              >
                <Copy className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (template.archivedAt || confirm(`Archive template "${template.name}"? It will leave the active list. Existing runs are preserved, and you can restore it later.`)) {
                  onDelete();
                }
              }}
              className="p-1 rounded-lg hover:bg-red-600/20 text-zinc-600 hover:text-red-400 transition-colors"
              disabled={pending}
              title={template.archivedAt ? "Restore template" : "Archive template"}
              aria-label={`${template.archivedAt ? "Restore" : "Archive"} ${template.name}`}
            >
              {template.archivedAt ? <RotateCcw className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        {/* Format badge */}
        <div className="flex items-center gap-2 mb-3">
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
            formatType === 'thermal'
              ? 'bg-orange-500/10 text-orange-400 border border-orange-500/20'
              : 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
          }`}>
            {formatName}
          </span>
          {format && (
            <span className="text-[10px] text-zinc-600">{format.width}&quot; × {format.height}&quot;</span>
          )}
        </div>

        {/* Element summary */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            {Object.entries(typeCounts).map(([type, count]) => (
              <span key={type} className="flex items-center gap-0.5 text-zinc-500" title={`${count} ${type}`}>
                {typeIcons[type]}
                <span className="text-[10px]">{count}</span>
              </span>
            ))}
            {dynamicCount > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 ml-1">
                {dynamicCount} dynamic
              </span>
            )}
          </div>
          <span className="text-[10px] text-zinc-600">{new Date(template.updatedAt).toLocaleDateString()}</span>
        </div>
      </div>
    </div>
  );
}

interface RenameTemplateDialogProps {
  isOpen: boolean;
  source: LabelTemplate | null;
  onClose: () => void;
  onSave: (name: string, description: string) => void;
}

export function RenameTemplateDialog({ isOpen, source, onClose, onSave }: RenameTemplateDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  useEffect(() => {
    if (isOpen && source) {
      setName(source.name);
      setDescription(source.description ?? '');
    }
  }, [isOpen, source]);

  if (!isOpen || !source) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSave(name.trim(), description.trim());
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="glass rounded-2xl p-6 max-w-md w-full border border-zinc-800">
        <h3 className="text-xl font-semibold text-zinc-100 mb-6 gradient-text">Rename Template</h3>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-sm text-zinc-400 block mb-2">Template Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Product Label"
              className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl text-sm text-zinc-100 placeholder-zinc-500 px-3 py-2.5 focus:outline-none focus:border-amber-500/50"
              autoFocus
            />
          </div>

          <div>
            <label className="text-sm text-zinc-400 block mb-2">Description (optional)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe this template..."
              rows={3}
              className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl text-sm text-zinc-100 placeholder-zinc-500 px-3 py-2.5 focus:outline-none focus:border-amber-500/50 resize-none"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 rounded-xl bg-zinc-800 text-zinc-300 text-sm font-medium hover:bg-zinc-700 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim()}
              className="flex-1 px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 text-black text-sm font-semibold hover:from-amber-400 hover:to-amber-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-amber-500/20"
            >
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface NewTemplateDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (name: string, description: string, formatId: string, thermalRenderMode: 'native-v1' | 'bitmap-v1') => void;
}

export function NewTemplateDialog({ isOpen, onClose, onCreate }: NewTemplateDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [formatId, setFormatId] = useState('');
  const [renderMode, setRenderMode] = useState<'native-v1' | 'bitmap-v1'>('bitmap-v1');
  const { formats } = useFormatStore();

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !formatId) return;
    onCreate(name, description, formatId, formats.find(f => f.id === formatId)?.type === 'thermal' ? renderMode : 'native-v1');
    setName('');
    setDescription('');
    setFormatId('');
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="glass rounded-2xl p-6 max-w-md w-full border border-zinc-800">
        <h3 className="text-xl font-semibold text-zinc-100 mb-6 gradient-text">New Template</h3>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-sm text-zinc-400 block mb-2">Template Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Product Label"
              className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl text-sm text-zinc-100 placeholder-zinc-500 px-3 py-2.5 focus:outline-none focus:border-amber-500/50"
              autoFocus
            />
          </div>

          <div>
            <label className="text-sm text-zinc-400 block mb-2">Description (optional)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe this template..."
              rows={3}
              className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl text-sm text-zinc-100 placeholder-zinc-500 px-3 py-2.5 focus:outline-none focus:border-amber-500/50 resize-none"
            />
          </div>

          <div>
            <label className="text-sm text-zinc-400 block mb-2">Label Format</label>
            {formats.length === 0 ? (
              <p className="text-sm text-zinc-500 py-2">
                No formats yet — <a href="/formats" className="text-amber-400 hover:text-amber-300">create a format</a> first
              </p>
            ) : (
              <CustomSelect
                value={formatId}
                onChange={setFormatId}
                placeholder="Select a format..."
                options={formats.map((format) => ({
                  value: format.id,
                  label: format.name,
                  sublabel: `${format.width}" × ${format.height}" — ${format.type}`,
                }))}
              />
            )}
          </div>

          {formats.find(f => f.id === formatId)?.type === 'thermal' && <label className="block text-sm text-zinc-400">Thermal rendering
            <select aria-label="Thermal rendering" className="block w-full mt-2 bg-zinc-900 rounded p-2" value={renderMode} onChange={e => setRenderMode(e.target.value as 'native-v1' | 'bitmap-v1')}>
              <option value="bitmap-v1">Exact bitmap · editable fonts · connection required</option>
              <option value="native-v1">Native · legacy printer fonts</option>
            </select>
          </label>}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 rounded-xl bg-zinc-800 text-zinc-300 text-sm font-medium hover:bg-zinc-700 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim() || !formatId}
              className="flex-1 px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 text-black text-sm font-semibold hover:from-amber-400 hover:to-amber-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-amber-500/20"
            >
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface DuplicateTemplateDialogProps {
  isOpen: boolean;
  source: LabelTemplate | null;
  onClose: () => void;
  onCreate: (name: string, formatId: string, scale: boolean) => void;
}

/**
 * Modal for duplicating a template to a (possibly different) format.
 * Lets the user choose whether to scale elements proportionally or keep them
 * at their exact positions.
 */
export function DuplicateTemplateDialog({ isOpen, source, onClose, onCreate }: DuplicateTemplateDialogProps) {
  const [name, setName] = useState('');
  const [formatId, setFormatId] = useState('');
  const [scale, setScale] = useState(true);
  const { formats } = useFormatStore();

  // Reset form when opening for a new source template.
  useEffect(() => {
    if (isOpen && source) {
      setName(`Copy of ${source.name}`);
      setFormatId(source.formatId);
      setScale(true);
    }
  }, [isOpen, source]);

  if (!isOpen || !source) return null;

  const sourceFormat = formats.find((f) => f.id === source.formatId);
  const targetFormat = formats.find((f) => f.id === formatId);
  const isDifferentFormat = formatId !== source.formatId;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !formatId) return;
    onCreate(name, formatId, scale);
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="glass rounded-2xl p-6 max-w-md w-full border border-zinc-800">
        <h3 className="text-xl font-semibold text-zinc-100 mb-1 gradient-text">Duplicate Template</h3>
        <p className="text-xs text-zinc-500 mb-6">
          Creating a copy of <span className="text-zinc-300">{source.name}</span>
          {sourceFormat && <span> ({sourceFormat.width}&quot; × {sourceFormat.height}&quot;)</span>}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-sm text-zinc-400 block mb-2">New Template Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl text-sm text-zinc-100 placeholder-zinc-500 px-3 py-2.5 focus:outline-none focus:border-amber-500/50"
              autoFocus
            />
          </div>

          <div>
            <label className="text-sm text-zinc-400 block mb-2">Target Format</label>
            {formats.length === 0 ? (
              <p className="text-sm text-zinc-500 py-2">No formats available.</p>
            ) : (
              <CustomSelect
                value={formatId}
                onChange={setFormatId}
                placeholder="Select a format..."
                options={formats.map((format) => ({
                  value: format.id,
                  label: format.name,
                  sublabel: `${format.width}" × ${format.height}" — ${format.type}`,
                }))}
              />
            )}
          </div>

          {isDifferentFormat && targetFormat && (
            <label className="flex items-start gap-3 p-3 rounded-xl bg-zinc-900/50 border border-zinc-800 cursor-pointer hover:border-amber-500/30 transition-colors">
              <input
                type="checkbox"
                checked={scale}
                onChange={(e) => setScale(e.target.checked)}
                className="mt-0.5 accent-amber-500"
              />
              <div className="flex-1">
                <div className="text-sm font-medium text-zinc-200">Scale elements proportionally</div>
                <div className="text-xs text-zinc-500 mt-0.5">
                  Resize text, positions, and QR codes to fit the new label dimensions. Uncheck to keep exact coordinates.
                </div>
              </div>
            </label>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 rounded-xl bg-zinc-800 text-zinc-300 text-sm font-medium hover:bg-zinc-700 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim() || !formatId}
              className="flex-1 px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 text-black text-sm font-semibold hover:from-amber-400 hover:to-amber-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-amber-500/20"
            >
              Duplicate
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
