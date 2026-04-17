'use client';

import {
  AlignHorizontalJustifyCenter, AlignHorizontalJustifyStart, AlignHorizontalJustifyEnd,
  AlignVerticalJustifyCenter, AlignVerticalJustifyStart, AlignVerticalJustifyEnd,
  Move, Maximize2, RotateCw, Type, QrCode, Barcode, Square, Image, Link2, Unlink2,
} from 'lucide-react';
import { LabelFormat, TemplateElement, TextElement, QRElement, BarcodeElement, LineElement, RectangleElement, ImageElement } from '@/lib/types';

interface PropertyPanelProps {
  element: TemplateElement | null;
  format: LabelFormat;
  onUpdate: (updates: Partial<TemplateElement>) => void;
}

export function PropertyPanel({ element, format, onUpdate }: PropertyPanelProps) {
  if (!element) {
    return (
      <div className="w-[280px] border-l border-zinc-800/50 flex items-center justify-center">
        <p className="text-zinc-600 text-xs">Select an element</p>
      </div>
    );
  }

  const u = format.type === 'thermal' ? 'dots' : 'in';
  const step = format.type === 'thermal' ? 1 : 0.01;
  const isThermal = format.type === 'thermal';
  const dpi = format.dpi || 203;
  const labelW = isThermal ? format.width * dpi : format.width;
  const labelH = isThermal ? format.height * dpi : format.height;

  // Element type badge
  const typeIcons: Record<string, React.ReactNode> = {
    text: <Type className="w-3 h-3" />,
    qr: <QrCode className="w-3 h-3" />,
    barcode: <Barcode className="w-3 h-3" />,
    line: <span className="w-3 h-0.5 bg-current rounded" />,
    rectangle: <Square className="w-3 h-3" />,
    image: <Image className="w-3 h-3" />,
  };

  return (
    <div className="w-[280px] border-l border-zinc-800/50 overflow-y-auto">
      {/* Element type header */}
      <div className="px-4 py-3 border-b border-zinc-800/50 flex items-center gap-2">
        <div className="w-6 h-6 rounded-md bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
          {typeIcons[element.type]}
        </div>
        <span className="text-sm font-medium text-zinc-200 capitalize">{element.type}</span>
        <span className="ml-auto text-[10px] text-zinc-600 uppercase tracking-wider">{u}</span>
      </div>

      <div className="p-3 space-y-1">
        {/* ── Size ── */}
        <SectionLabel icon={<Maximize2 className="w-3 h-3" />} label="Size" />
        {element.type === 'qr' ? (
          <div className="grid grid-cols-1">
            <CompactInput label="S" value={element.width} onChange={(v) => onUpdate({ width: v, height: v })} step={step} />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-1">
            <CompactInput label="W" value={element.width} onChange={(v) => onUpdate({ width: v })} step={step} />
            <CompactInput label="H" value={element.height} onChange={(v) => onUpdate({ height: v })} step={step} />
          </div>
        )}

        {/* ── Position ── */}
        <SectionLabel icon={<Move className="w-3 h-3" />} label="Position" />
        <div className="grid grid-cols-2 gap-1">
          <CompactInput label="X" value={element.x} onChange={(v) => onUpdate({ x: v })} step={step} />
          <CompactInput label="Y" value={element.y} onChange={(v) => onUpdate({ y: v })} step={step} />
        </div>

        {/* ── Rotation ── */}
        <div className="grid grid-cols-2 gap-1">
          <div>
            <SectionLabel icon={<RotateCw className="w-3 h-3" />} label="Rotate" />
            <CompactInput label="°" value={element.rotation} onChange={(v) => onUpdate({ rotation: v })} step={1} labelRight />
          </div>
        </div>

        {/* ── Alignment ── */}
        <div className="pt-2 pb-1">
          <div className="flex items-center gap-0.5">
            <AlignBtn icon={<AlignHorizontalJustifyStart className="w-3.5 h-3.5" />} tip="Left" onClick={() => onUpdate({ x: 0 })} />
            <AlignBtn icon={<AlignHorizontalJustifyCenter className="w-3.5 h-3.5" />} tip="Center H" onClick={() => onUpdate({ x: (labelW - element.width) / 2 })} />
            <AlignBtn icon={<AlignHorizontalJustifyEnd className="w-3.5 h-3.5" />} tip="Right" onClick={() => onUpdate({ x: labelW - element.width })} />
            <div className="w-px h-4 bg-zinc-800 mx-1" />
            <AlignBtn icon={<AlignVerticalJustifyStart className="w-3.5 h-3.5" />} tip="Top" onClick={() => onUpdate({ y: 0 })} />
            <AlignBtn icon={<AlignVerticalJustifyCenter className="w-3.5 h-3.5" />} tip="Center V" onClick={() => onUpdate({ y: (labelH - element.height) / 2 })} />
            <AlignBtn icon={<AlignVerticalJustifyEnd className="w-3.5 h-3.5" />} tip="Bottom" onClick={() => onUpdate({ y: labelH - element.height })} />
          </div>
        </div>

        <Divider />

        {/* ── Data Binding ── */}
        <div className="flex items-center justify-between py-1">
          <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">Binding</span>
          <div className="flex gap-0.5 p-0.5 bg-zinc-900/80 rounded-md border border-zinc-800/50">
            <button
              onClick={() => onUpdate({ isStatic: true })}
              className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all ${
                element.isStatic ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              Static
            </button>
            <button
              onClick={() => onUpdate({ isStatic: false })}
              className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all ${
                !element.isStatic ? 'bg-amber-500/20 text-amber-400' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              Dynamic
            </button>
          </div>
        </div>

        {!element.isStatic && (
          <div className="space-y-1">
            <CompactTextInput label="Field" value={element.fieldName || ''} onChange={(v) => onUpdate({ fieldName: v })} placeholder="product_name" />
            <CompactTextInput label="Default" value={element.defaultValue || ''} onChange={(v) => onUpdate({ defaultValue: v })} placeholder="Preview..." />
          </div>
        )}

        <Divider />

        {/* ── Type-specific ── */}
        {element.type === 'text' && <TextProps element={element as TextElement} onUpdate={onUpdate} format={format} />}
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

function TextProps({ element, onUpdate, format }: { element: TextElement; onUpdate: (u: Partial<TemplateElement>) => void; format: LabelFormat }) {
  return (
    <>
      <SectionLabel icon={<Type className="w-3 h-3" />} label="Text" />
      <CompactTextInput label="" value={element.content} onChange={(v) => onUpdate({ content: v })} placeholder="Enter text..." full />
      <div className="grid grid-cols-2 gap-1">
        <CompactInput label="Pt" value={element.fontSize} onChange={(v) => onUpdate({ fontSize: v })} step={1} labelRight />
        <CompactSelect value={element.fontWeight} options={['normal', 'bold']} onChange={(v) => onUpdate({ fontWeight: v as 'normal' | 'bold' })} />
      </div>
      <CompactSelect value={element.fontFamily} options={['Arial', 'Helvetica', 'Times New Roman', 'Courier', 'monospace']} onChange={(v) => onUpdate({ fontFamily: v })} />
      <div className="flex gap-0.5">
        {(['left', 'center', 'right'] as const).map((a) => (
          <button
            key={a}
            onClick={() => onUpdate({ textAlign: a })}
            className={`flex-1 py-1 rounded-md text-[10px] font-medium transition-all ${
              element.textAlign === a ? 'bg-zinc-700 text-zinc-100' : 'bg-zinc-900/50 text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {a.charAt(0).toUpperCase() + a.slice(1)}
          </button>
        ))}
      </div>
      {format.type === 'sheet' && (
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-zinc-500 uppercase tracking-wider w-10">Color</span>
          <input
            type="color"
            value={element.color}
            onChange={(e) => onUpdate({ color: e.target.value })}
            className="w-6 h-6 rounded-md border border-zinc-700 bg-transparent cursor-pointer"
          />
          <span className="text-xs text-zinc-400 font-mono">{element.color}</span>
        </div>
      )}
    </>
  );
}

function QRProps({ element, onUpdate }: { element: QRElement; onUpdate: (u: Partial<TemplateElement>) => void }) {
  return (
    <>
      <SectionLabel icon={<QrCode className="w-3 h-3" />} label="QR Code" />
      <CompactTextInput label="" value={element.content} onChange={(v) => onUpdate({ content: v })} placeholder="URL or data" full />
      <CompactSelect
        value={element.errorCorrection}
        options={['L', 'M', 'Q', 'H']}
        labels={['Low', 'Medium', 'Quartile', 'High']}
        onChange={(v) => onUpdate({ errorCorrection: v as 'L' | 'M' | 'Q' | 'H' })}
      />
    </>
  );
}

function BarcodeProps({ element, onUpdate }: { element: BarcodeElement; onUpdate: (u: Partial<TemplateElement>) => void }) {
  return (
    <>
      <SectionLabel icon={<Barcode className="w-3 h-3" />} label="Barcode" />
      <CompactTextInput label="" value={element.content} onChange={(v) => onUpdate({ content: v })} placeholder="Value to encode" full />
      <CompactSelect
        value={element.barcodeFormat}
        options={['CODE128', 'CODE39', 'UPC', 'EAN13', 'EAN8', 'ITF14']}
        onChange={(v) => onUpdate({ barcodeFormat: v as any })}
      />
      <div className="flex items-center justify-between py-0.5">
        <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Text</span>
        <Toggle checked={element.showText} onChange={(v) => onUpdate({ showText: v })} />
      </div>
    </>
  );
}

function LineProps({ element, onUpdate }: { element: LineElement; onUpdate: (u: Partial<TemplateElement>) => void }) {
  return (
    <>
      <SectionLabel icon={<span className="w-3 h-0.5 bg-current rounded" />} label="Line" />
      <CompactInput label="Wt" value={element.strokeWidth} onChange={(v) => onUpdate({ strokeWidth: v })} step={0.5} />
      <ColorRow label="Color" value={element.color} onChange={(v) => onUpdate({ color: v })} />
    </>
  );
}

function RectProps({ element, onUpdate }: { element: RectangleElement; onUpdate: (u: Partial<TemplateElement>) => void }) {
  return (
    <>
      <SectionLabel icon={<Square className="w-3 h-3" />} label="Rectangle" />
      <div className="grid grid-cols-2 gap-1">
        <CompactInput label="Bdr" value={element.strokeWidth} onChange={(v) => onUpdate({ strokeWidth: v })} step={0.5} />
        <CompactInput label="Rad" value={element.borderRadius} onChange={(v) => onUpdate({ borderRadius: v })} step={1} />
      </div>
      <ColorRow label="Stroke" value={element.strokeColor} onChange={(v) => onUpdate({ strokeColor: v })} />
      <ColorRow label="Fill" value={element.fillColor || '#000000'} onChange={(v) => onUpdate({ fillColor: v })} />
    </>
  );
}

function ImageProps({ element, onUpdate }: { element: ImageElement; onUpdate: (u: Partial<TemplateElement>) => void }) {
  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => onUpdate({ src: ev.target?.result as string });
    reader.readAsDataURL(file);
  };
  return (
    <>
      <SectionLabel icon={<Image className="w-3 h-3" />} label="Image" />
      <input
        type="file"
        accept="image/*"
        onChange={handleUpload}
        className="text-[10px] text-zinc-400 file:mr-2 file:py-1 file:px-2 file:rounded-md file:border-0 file:text-[10px] file:font-medium file:bg-zinc-800 file:text-zinc-300 hover:file:bg-zinc-700 file:cursor-pointer w-full"
      />
      <CompactSelect value={element.objectFit} options={['contain', 'cover', 'fill']} onChange={(v) => onUpdate({ objectFit: v as any })} />
    </>
  );
}

// ── Primitives ──

function SectionLabel({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-1.5 pt-2 pb-1">
      <span className="text-zinc-500">{icon}</span>
      <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">{label}</span>
    </div>
  );
}

function Divider() {
  return <div className="border-t border-zinc-800/40 my-1" />;
}

function CompactInput({ label, value, onChange, step, labelRight }: {
  label: string; value: number; onChange: (v: number) => void; step: number; labelRight?: boolean;
}) {
  return (
    <div className="flex items-center bg-zinc-900/60 border border-zinc-800/50 rounded-lg overflow-hidden h-7">
      {!labelRight && (
        <span className="text-[10px] text-zinc-500 font-medium w-6 text-center flex-shrink-0 border-r border-zinc-800/40">{label}</span>
      )}
      <input
        type="number"
        value={typeof value === 'number' ? Math.round(value * 1000) / 1000 : value}
        onChange={(e) => onChange(Number(e.target.value))}
        step={step}
        className="flex-1 bg-transparent text-xs text-zinc-100 px-1.5 h-full focus:outline-none min-w-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
      />
      {labelRight && (
        <span className="text-[10px] text-zinc-500 font-medium w-5 text-center flex-shrink-0 border-l border-zinc-800/40">{label}</span>
      )}
    </div>
  );
}

function CompactTextInput({ label, value, onChange, placeholder, full }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; full?: boolean;
}) {
  return (
    <div className="flex items-center bg-zinc-900/60 border border-zinc-800/50 rounded-lg overflow-hidden h-7">
      {label && (
        <span className="text-[10px] text-zinc-500 font-medium px-2 flex-shrink-0 border-r border-zinc-800/40">{label}</span>
      )}
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`${full ? 'w-full' : 'flex-1'} bg-transparent text-xs text-zinc-100 px-2 h-full focus:outline-none placeholder-zinc-600 min-w-0`}
      />
    </div>
  );
}

function CompactSelect({ value, options, labels, onChange }: {
  value: string; options: string[]; labels?: string[]; onChange: (v: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-zinc-900/60 border border-zinc-800/50 rounded-lg text-xs text-zinc-100 px-2 h-7 focus:outline-none focus:border-amber-500/30"
    >
      {options.map((o, i) => (
        <option key={o} value={o}>{labels ? labels[i] : o}</option>
      ))}
    </select>
  );
}

function ColorRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2 h-7">
      <span className="text-[10px] text-zinc-500 uppercase tracking-wider w-8 flex-shrink-0">{label}</span>
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-5 h-5 rounded border border-zinc-700 bg-transparent cursor-pointer flex-shrink-0"
      />
      <span className="text-[10px] text-zinc-400 font-mono">{value}</span>
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`w-7 h-4 rounded-full transition-all flex-shrink-0 ${checked ? 'bg-amber-500' : 'bg-zinc-700'}`}
    >
      <div className={`w-3 h-3 rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
    </button>
  );
}

function AlignBtn({ icon, tip, onClick }: { icon: React.ReactNode; tip: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={tip}
      className="flex items-center justify-center w-7 h-7 rounded-md text-zinc-500 hover:text-amber-400 hover:bg-amber-500/5 transition-all"
    >
      {icon}
    </button>
  );
}
