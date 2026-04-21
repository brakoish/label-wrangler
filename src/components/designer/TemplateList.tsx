'use client';

import { useState, useEffect } from 'react';
import { Plus, FileText, Trash2, Type, QrCode, Barcode, Square, Image, Minus, Copy } from 'lucide-react';
import { LabelFormat, LabelTemplate, TemplateElement, TextElement } from '@/lib/types';
import { useFormatStore } from '@/lib/store';
import { CustomSelect } from '@/components/ui/CustomSelect';

interface TemplateListProps {
  templates: LabelTemplate[];
  onSelectTemplate: (id: string) => void;
  onDeleteTemplate: (id: string) => void;
  onDuplicateTemplate?: (template: LabelTemplate) => void;
  onNewTemplate: () => void;
}

export function TemplateList({
  templates,
  onSelectTemplate,
  onDeleteTemplate,
  onDuplicateTemplate,
  onNewTemplate,
}: TemplateListProps) {
  const { formats } = useFormatStore();

  return (
    <div className="max-w-[1600px] mx-auto w-full p-8">
      {templates.length === 0 ? (
        <div className="flex items-center justify-center py-24">
          <div className="text-center max-w-sm">
            <div className="w-20 h-20 mx-auto mb-6 rounded-3xl bg-gradient-to-br from-zinc-800 to-zinc-900 flex items-center justify-center border border-zinc-800">
              <FileText className="w-10 h-10 text-zinc-600" />
            </div>
            <h3 className="text-zinc-300 font-semibold text-lg">No templates yet</h3>
            <p className="text-zinc-500 text-sm mt-2">
              Create your first label template to start designing
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

          {templates.map((template) => {
            const format = formats.find((f) => f.id === template.formatId);
            return (
              <TemplateCard
                key={template.id}
                template={template}
                format={format}
                onSelect={() => onSelectTemplate(template.id)}
                onDelete={() => onDeleteTemplate(template.id)}
                onDuplicate={onDuplicateTemplate ? () => onDuplicateTemplate(template) : undefined}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

// Mini label preview — renders elements as simplified shapes
function MiniPreview({ template, format }: { template: LabelTemplate; format?: LabelFormat }) {
  if (!format) return <div className="w-full h-full bg-zinc-900 rounded-lg" />;

  const isThermal = format.type === 'thermal';
  const dpi = format.dpi || 203;
  const vbW = isThermal ? format.width * dpi : format.width;
  const vbH = isThermal ? format.height * dpi : format.height;

  const pad = Math.min(vbW, vbH) * 0.08;
  const totalW = vbW + pad * 2;
  const totalH = vbH + pad * 2;

  const sorted = [...template.elements].sort((a, b) => a.zIndex - b.zIndex);

  return (
    <svg
      viewBox={`${-pad} ${-pad} ${totalW} ${totalH}`}
      className="w-full h-full"
      preserveAspectRatio="xMidYMid meet"
    >
      {/* Background */}
      <rect x={-pad} y={-pad} width={totalW} height={totalH} fill="#18181b" rx={pad * 0.4} />
      {/* Label surface */}
      <rect x={0} y={0} width={vbW} height={vbH} fill={isThermal ? '#ffffff' : '#fafafa'} stroke="#3f3f46" strokeWidth={Math.min(vbW, vbH) * 0.006} rx={Math.min(vbW, vbH) * 0.01} />
      {/* Elements as simplified shapes */}
      {sorted.map((el) => {
        switch (el.type) {
          case 'text':
            return (
              <g key={el.id}>
                <rect x={el.x} y={el.y} width={el.width} height={el.height || (el as TextElement).fontSize * 1.2} fill="#d4d4d8" rx={vbW * 0.005} opacity={0.6} />
              </g>
            );
          case 'qr':
            return (
              <g key={el.id}>
                <rect x={el.x} y={el.y} width={el.width} height={el.height} fill="#a1a1aa" rx={vbW * 0.005} />
                {/* Mini QR pattern */}
                <rect x={el.x + el.width * 0.1} y={el.y + el.height * 0.1} width={el.width * 0.25} height={el.height * 0.25} fill="#3f3f46" />
                <rect x={el.x + el.width * 0.65} y={el.y + el.height * 0.1} width={el.width * 0.25} height={el.height * 0.25} fill="#3f3f46" />
                <rect x={el.x + el.width * 0.1} y={el.y + el.height * 0.65} width={el.width * 0.25} height={el.height * 0.25} fill="#3f3f46" />
              </g>
            );
          case 'barcode':
            return (
              <g key={el.id}>
                {/* Mini barcode lines */}
                {Array.from({ length: 12 }).map((_, i) => (
                  <rect
                    key={i}
                    x={el.x + (el.width / 14) * (i + 1)}
                    y={el.y}
                    width={el.width / 28}
                    height={el.height * 0.75}
                    fill="#52525b"
                  />
                ))}
              </g>
            );
          case 'rectangle':
            return (
              <rect key={el.id} x={el.x} y={el.y} width={el.width} height={el.height} fill="none" stroke="#71717a" strokeWidth={Math.min(vbW, vbH) * 0.005} />
            );
          case 'line':
            return (
              <line key={el.id} x1={el.x} y1={el.y} x2={el.x + el.width} y2={el.y + el.height} stroke="#71717a" strokeWidth={Math.min(vbW, vbH) * 0.005} />
            );
          case 'image':
            return (
              <rect key={el.id} x={el.x} y={el.y} width={el.width} height={el.height} fill="#3f3f46" rx={vbW * 0.005} />
            );
          default:
            return null;
        }
      })}
    </svg>
  );
}

function TemplateCard({
  template,
  format,
  onSelect,
  onDelete,
  onDuplicate,
}: {
  template: LabelTemplate;
  format?: LabelFormat;
  onSelect: () => void;
  onDelete: () => void;
  onDuplicate?: () => void;
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
                if (confirm(`Delete template "${template.name}"?`)) {
                  onDelete();
                }
              }}
              className="p-1 rounded-lg hover:bg-red-600/20 text-zinc-600 hover:text-red-400 transition-colors"
              title="Delete template"
            >
              <Trash2 className="w-3.5 h-3.5" />
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

interface NewTemplateDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (name: string, description: string, formatId: string) => void;
}

export function NewTemplateDialog({ isOpen, onClose, onCreate }: NewTemplateDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [formatId, setFormatId] = useState('');
  const { formats } = useFormatStore();

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !formatId) return;
    onCreate(name, description, formatId);
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
                No formats yet — <a href="/" className="text-amber-400 hover:text-amber-300">create a format</a> first
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
