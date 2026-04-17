'use client';

import { LabelFormat, TemplateElement, TextElement, QRElement, BarcodeElement, LineElement, RectangleElement, ImageElement } from '@/lib/types';

interface PropertyPanelProps {
  element: TemplateElement | null;
  format: LabelFormat;
  onUpdate: (updates: Partial<TemplateElement>) => void;
}

export function PropertyPanel({ element, format, onUpdate }: PropertyPanelProps) {
  if (!element) {
    return (
      <div className="w-80 glass border-l border-zinc-800 p-6">
        <p className="text-sm text-zinc-500">Select an element to edit its properties</p>
      </div>
    );
  }

  const unitLabel = format.type === 'thermal' ? 'dots' : 'in';

  return (
    <div className="w-80 glass border-l border-zinc-800 p-6 overflow-y-auto">
      <h3 className="text-lg font-semibold text-zinc-100 mb-6 gradient-text">Properties</h3>

      {/* Position & Size */}
      <PropertyGroup title="Position & Size">
        <PropertyInput
          label={`X (${unitLabel})`}
          type="number"
          value={element.x}
          onChange={(value) => onUpdate({ x: Number(value) })}
          step={format.type === 'thermal' ? 1 : 0.01}
        />
        <PropertyInput
          label={`Y (${unitLabel})`}
          type="number"
          value={element.y}
          onChange={(value) => onUpdate({ y: Number(value) })}
          step={format.type === 'thermal' ? 1 : 0.01}
        />
        <PropertyInput
          label={`Width (${unitLabel})`}
          type="number"
          value={element.width}
          onChange={(value) => onUpdate({ width: Number(value) })}
          step={format.type === 'thermal' ? 1 : 0.01}
        />
        <PropertyInput
          label={`Height (${unitLabel})`}
          type="number"
          value={element.height}
          onChange={(value) => onUpdate({ height: Number(value) })}
          step={format.type === 'thermal' ? 1 : 0.01}
        />
        <PropertyInput
          label="Rotation (°)"
          type="number"
          value={element.rotation}
          onChange={(value) => onUpdate({ rotation: Number(value) })}
          step={1}
        />
      </PropertyGroup>

      {/* Content */}
      <PropertyGroup title="Content">
        <div className="flex items-center gap-2 mb-3">
          <label className="text-xs text-zinc-400 flex-1">Type</label>
          <button
            onClick={() => onUpdate({ isStatic: !element.isStatic })}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
              element.isStatic
                ? 'bg-zinc-700 text-zinc-200'
                : 'bg-amber-600 text-white'
            }`}
          >
            {element.isStatic ? 'Static' : 'Dynamic'}
          </button>
        </div>

        {!element.isStatic && (
          <>
            <PropertyInput
              label="Field Name"
              type="text"
              value={element.fieldName || ''}
              onChange={(value) => onUpdate({ fieldName: value as string })}
            />
            <PropertyInput
              label="Default Value"
              type="text"
              value={element.defaultValue || ''}
              onChange={(value) => onUpdate({ defaultValue: value as string })}
            />
          </>
        )}
      </PropertyGroup>

      {/* Type-specific properties */}
      {element.type === 'text' && <TextProperties element={element as TextElement} onUpdate={onUpdate} format={format} />}
      {element.type === 'qr' && <QRProperties element={element as QRElement} onUpdate={onUpdate} />}
      {element.type === 'barcode' && <BarcodeProperties element={element as BarcodeElement} onUpdate={onUpdate} />}
      {element.type === 'line' && <LineProperties element={element as LineElement} onUpdate={onUpdate} />}
      {element.type === 'rectangle' && <RectangleProperties element={element as RectangleElement} onUpdate={onUpdate} />}
      {element.type === 'image' && <ImageProperties element={element as ImageElement} onUpdate={onUpdate} />}
    </div>
  );
}

function TextProperties({ element, onUpdate, format }: { element: TextElement; onUpdate: (updates: Partial<TemplateElement>) => void; format: LabelFormat }) {
  return (
    <PropertyGroup title="Text Style">
      <PropertyInput
        label="Content"
        type="text"
        value={element.content}
        onChange={(value) => onUpdate({ content: value as string })}
      />
      <PropertyInput
        label="Font Size (pt)"
        type="number"
        value={element.fontSize}
        onChange={(value) => onUpdate({ fontSize: Number(value) })}
        step={1}
      />
      <PropertySelect
        label="Font Family"
        value={element.fontFamily}
        options={['Arial', 'Helvetica', 'Times New Roman', 'Courier', 'monospace']}
        onChange={(value) => onUpdate({ fontFamily: value as string })}
      />
      <PropertySelect
        label="Font Weight"
        value={element.fontWeight}
        options={['normal', 'bold']}
        onChange={(value) => onUpdate({ fontWeight: value as 'normal' | 'bold' })}
      />
      <PropertySelect
        label="Text Align"
        value={element.textAlign}
        options={['left', 'center', 'right']}
        onChange={(value) => onUpdate({ textAlign: value as 'left' | 'center' | 'right' })}
      />
      {format.type === 'sheet' && (
        <PropertyInput
          label="Color"
          type="color"
          value={element.color}
          onChange={(value) => onUpdate({ color: value as string })}
        />
      )}
    </PropertyGroup>
  );
}

function QRProperties({ element, onUpdate }: { element: QRElement; onUpdate: (updates: Partial<TemplateElement>) => void }) {
  return (
    <PropertyGroup title="QR Code">
      <PropertyInput
        label="Content"
        type="text"
        value={element.content}
        onChange={(value) => onUpdate({ content: value as string })}
      />
      <PropertySelect
        label="Error Correction"
        value={element.errorCorrection}
        options={['L', 'M', 'Q', 'H']}
        onChange={(value) => onUpdate({ errorCorrection: value as 'L' | 'M' | 'Q' | 'H' })}
      />
    </PropertyGroup>
  );
}

function BarcodeProperties({ element, onUpdate }: { element: BarcodeElement; onUpdate: (updates: Partial<TemplateElement>) => void }) {
  return (
    <PropertyGroup title="Barcode">
      <PropertyInput
        label="Content"
        type="text"
        value={element.content}
        onChange={(value) => onUpdate({ content: value as string })}
      />
      <PropertySelect
        label="Format"
        value={element.barcodeFormat}
        options={['CODE128', 'CODE39', 'UPC', 'EAN13', 'EAN8', 'ITF14']}
        onChange={(value) => onUpdate({ barcodeFormat: value as any })}
      />
      <div className="flex items-center gap-2">
        <label className="text-xs text-zinc-400 flex-1">Show Text</label>
        <input
          type="checkbox"
          checked={element.showText}
          onChange={(e) => onUpdate({ showText: e.target.checked })}
          className="w-4 h-4 rounded border-zinc-700 bg-zinc-900 text-amber-600 focus:ring-amber-500"
        />
      </div>
    </PropertyGroup>
  );
}

function LineProperties({ element, onUpdate }: { element: LineElement; onUpdate: (updates: Partial<TemplateElement>) => void }) {
  return (
    <PropertyGroup title="Line Style">
      <PropertyInput
        label="Stroke Width"
        type="number"
        value={element.strokeWidth}
        onChange={(value) => onUpdate({ strokeWidth: Number(value) })}
        step={0.5}
      />
      <PropertyInput
        label="Color"
        type="color"
        value={element.color}
        onChange={(value) => onUpdate({ color: value as string })}
      />
    </PropertyGroup>
  );
}

function RectangleProperties({ element, onUpdate }: { element: RectangleElement; onUpdate: (updates: Partial<TemplateElement>) => void }) {
  return (
    <PropertyGroup title="Rectangle Style">
      <PropertyInput
        label="Stroke Width"
        type="number"
        value={element.strokeWidth}
        onChange={(value) => onUpdate({ strokeWidth: Number(value) })}
        step={0.5}
      />
      <PropertyInput
        label="Stroke Color"
        type="color"
        value={element.strokeColor}
        onChange={(value) => onUpdate({ strokeColor: value as string })}
      />
      <PropertyInput
        label="Fill Color"
        type="color"
        value={element.fillColor}
        onChange={(value) => onUpdate({ fillColor: value as string })}
      />
      <PropertyInput
        label="Border Radius"
        type="number"
        value={element.borderRadius}
        onChange={(value) => onUpdate({ borderRadius: Number(value) })}
        step={1}
      />
    </PropertyGroup>
  );
}

function ImageProperties({ element, onUpdate }: { element: ImageElement; onUpdate: (updates: Partial<TemplateElement>) => void }) {
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      onUpdate({ src: dataUrl });
    };
    reader.readAsDataURL(file);
  };

  return (
    <PropertyGroup title="Image">
      <div className="mb-3">
        <label className="text-xs text-zinc-400 block mb-2">Upload Image</label>
        <input
          type="file"
          accept="image/*"
          onChange={handleImageUpload}
          className="text-xs text-zinc-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-amber-600 file:text-white hover:file:bg-amber-700 file:cursor-pointer"
        />
      </div>
      <PropertySelect
        label="Object Fit"
        value={element.objectFit}
        options={['contain', 'cover', 'fill']}
        onChange={(value) => onUpdate({ objectFit: value as 'contain' | 'cover' | 'fill' })}
      />
    </PropertyGroup>
  );
}

// Helper components
function PropertyGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-3">{title}</h4>
      <div className="space-y-3">
        {children}
      </div>
    </div>
  );
}

function PropertyInput({
  label,
  type,
  value,
  onChange,
  step,
}: {
  label: string;
  type: string;
  value: string | number;
  onChange: (value: string | number) => void;
  step?: number;
}) {
  return (
    <div>
      <label className="text-xs text-zinc-400 block mb-1.5">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(type === 'number' ? Number(e.target.value) : e.target.value)}
        step={step}
        className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl text-sm text-zinc-100 placeholder-zinc-500 px-3 py-2 focus:outline-none focus:border-amber-500/50"
      />
    </div>
  );
}

function PropertySelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label className="text-xs text-zinc-400 block mb-1.5">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl text-sm text-zinc-100 px-3 py-2 focus:outline-none focus:border-amber-500/50"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  );
}
