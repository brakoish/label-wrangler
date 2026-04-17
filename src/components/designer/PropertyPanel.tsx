'use client';

import { AlignHorizontalJustifyCenter, AlignHorizontalJustifyStart, AlignHorizontalJustifyEnd, AlignVerticalJustifyCenter, AlignVerticalJustifyStart, AlignVerticalJustifyEnd } from 'lucide-react';
import { LabelFormat, TemplateElement, TextElement, QRElement, BarcodeElement, LineElement, RectangleElement, ImageElement } from '@/lib/types';

interface PropertyPanelProps {
  element: TemplateElement | null;
  format: LabelFormat;
  onUpdate: (updates: Partial<TemplateElement>) => void;
}

export function PropertyPanel({ element, format, onUpdate }: PropertyPanelProps) {
  if (!element) {
    return (
      <div className="w-[320px] border-l border-zinc-800/50 flex items-center justify-center">
        <div className="text-center max-w-[200px]">
          <p className="text-zinc-500 text-sm">Select an element to edit its properties</p>
        </div>
      </div>
    );
  }

  const unitLabel = format.type === 'thermal' ? 'dots' : 'in';
  const isThermal = format.type === 'thermal';
  const dpi = format.dpi || 203;
  const labelW = isThermal ? format.width * dpi : format.width;
  const labelH = isThermal ? format.height * dpi : format.height;

  return (
    <div className="w-[320px] border-l border-zinc-800/50 overflow-y-auto">
      <div className="p-4 space-y-4">
        {/* Position & Size */}
        <PropertyGroup title="Position & Size">
          <div className="grid grid-cols-2 gap-3">
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
            {element.type === 'qr' ? (
              <div className="col-span-2">
                <PropertyInput
                  label={`Size (${unitLabel})`}
                  type="number"
                  value={element.width}
                  onChange={(value) => onUpdate({ width: Number(value), height: Number(value) })}
                  step={format.type === 'thermal' ? 1 : 0.01}
                />
              </div>
            ) : (
              <>
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
              </>
            )}
          </div>
          <PropertyInput
            label="Rotation"
            type="number"
            value={element.rotation}
            onChange={(value) => onUpdate({ rotation: Number(value) })}
            step={1}
            suffix="°"
          />
        </PropertyGroup>

        {/* Align to Label */}
        <PropertyGroup title="Align to Label">
          <div className="grid grid-cols-6 gap-1.5">
            <AlignButton
              icon={<AlignHorizontalJustifyStart className="w-4 h-4" />}
              title="Align left"
              onClick={() => onUpdate({ x: 0 })}
            />
            <AlignButton
              icon={<AlignHorizontalJustifyCenter className="w-4 h-4" />}
              title="Center horizontally"
              onClick={() => onUpdate({ x: Math.round(((labelW - element.width) / 2) * 100) / 100 })}
            />
            <AlignButton
              icon={<AlignHorizontalJustifyEnd className="w-4 h-4" />}
              title="Align right"
              onClick={() => onUpdate({ x: Math.round((labelW - element.width) * 100) / 100 })}
            />
            <AlignButton
              icon={<AlignVerticalJustifyStart className="w-4 h-4" />}
              title="Align top"
              onClick={() => onUpdate({ y: 0 })}
            />
            <AlignButton
              icon={<AlignVerticalJustifyCenter className="w-4 h-4" />}
              title="Center vertically"
              onClick={() => onUpdate({ y: Math.round(((labelH - element.height) / 2) * 100) / 100 })}
            />
            <AlignButton
              icon={<AlignVerticalJustifyEnd className="w-4 h-4" />}
              title="Align bottom"
              onClick={() => onUpdate({ y: Math.round((labelH - element.height) * 100) / 100 })}
            />
          </div>
        </PropertyGroup>

        {/* Content & Data Binding */}
        <PropertyGroup title="Data Binding">
          <div className="flex items-center justify-between">
            <span className="text-xs text-zinc-400">Value type</span>
            <div className="flex gap-1 p-0.5 bg-zinc-900/50 rounded-lg border border-zinc-800/50">
              <button
                onClick={() => onUpdate({ isStatic: true })}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                  element.isStatic
                    ? 'bg-zinc-700 text-white shadow-sm'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                Static
              </button>
              <button
                onClick={() => onUpdate({ isStatic: false })}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                  !element.isStatic
                    ? 'bg-amber-500/20 text-amber-400 shadow-sm'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                Dynamic
              </button>
            </div>
          </div>

          {!element.isStatic && (
            <>
              <PropertyInput
                label="Field Name"
                type="text"
                value={element.fieldName || ''}
                onChange={(value) => onUpdate({ fieldName: value as string })}
                placeholder="e.g. product_name"
              />
              <PropertyInput
                label="Default Value"
                type="text"
                value={element.defaultValue || ''}
                onChange={(value) => onUpdate({ defaultValue: value as string })}
                placeholder="Preview text..."
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
      <div className="grid grid-cols-2 gap-3">
        <PropertyInput
          label="Font Size"
          type="number"
          value={element.fontSize}
          onChange={(value) => onUpdate({ fontSize: Number(value) })}
          step={1}
          suffix="pt"
        />
        <PropertySelect
          label="Weight"
          value={element.fontWeight}
          options={['normal', 'bold']}
          onChange={(value) => onUpdate({ fontWeight: value as 'normal' | 'bold' })}
        />
      </div>
      <PropertySelect
        label="Font Family"
        value={element.fontFamily}
        options={['Arial', 'Helvetica', 'Times New Roman', 'Courier', 'monospace']}
        onChange={(value) => onUpdate({ fontFamily: value as string })}
      />
      <PropertySelect
        label="Alignment"
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
        label="Data"
        type="text"
        value={element.content}
        onChange={(value) => onUpdate({ content: value as string })}
        placeholder="URL or text to encode"
      />
      <PropertySelect
        label="Error Correction"
        value={element.errorCorrection}
        options={['L', 'M', 'Q', 'H']}
        labels={['Low (L)', 'Medium (M)', 'Quartile (Q)', 'High (H)']}
        onChange={(value) => onUpdate({ errorCorrection: value as 'L' | 'M' | 'Q' | 'H' })}
      />
    </PropertyGroup>
  );
}

function BarcodeProperties({ element, onUpdate }: { element: BarcodeElement; onUpdate: (updates: Partial<TemplateElement>) => void }) {
  return (
    <PropertyGroup title="Barcode">
      <PropertyInput
        label="Data"
        type="text"
        value={element.content}
        onChange={(value) => onUpdate({ content: value as string })}
        placeholder="Value to encode"
      />
      <PropertySelect
        label="Format"
        value={element.barcodeFormat}
        options={['CODE128', 'CODE39', 'UPC', 'EAN13', 'EAN8', 'ITF14']}
        onChange={(value) => onUpdate({ barcodeFormat: value as any })}
      />
      <div className="flex items-center justify-between py-1">
        <span className="text-xs text-zinc-400">Show text below</span>
        <button
          onClick={() => onUpdate({ showText: !element.showText })}
          className={`w-9 h-5 rounded-full transition-all ${
            element.showText ? 'bg-amber-500' : 'bg-zinc-700'
          }`}
        >
          <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${
            element.showText ? 'translate-x-4.5' : 'translate-x-0.5'
          }`} />
        </button>
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
      <div className="grid grid-cols-2 gap-3">
        <PropertyInput
          label="Stroke"
          type="number"
          value={element.strokeWidth}
          onChange={(value) => onUpdate({ strokeWidth: Number(value) })}
          step={0.5}
        />
        <PropertyInput
          label="Radius"
          type="number"
          value={element.borderRadius}
          onChange={(value) => onUpdate({ borderRadius: Number(value) })}
          step={1}
        />
      </div>
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
    </PropertyGroup>
  );
}

function ImageProperties({ element, onUpdate }: { element: ImageElement; onUpdate: (updates: Partial<TemplateElement>) => void }) {
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      onUpdate({ src: event.target?.result as string });
    };
    reader.readAsDataURL(file);
  };

  return (
    <PropertyGroup title="Image">
      <div>
        <label className="text-xs text-zinc-400 block mb-1.5">Upload</label>
        <input
          type="file"
          accept="image/*"
          onChange={handleImageUpload}
          className="text-xs text-zinc-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-amber-500 file:text-black hover:file:bg-amber-400 file:cursor-pointer"
        />
      </div>
      <PropertySelect
        label="Fit"
        value={element.objectFit}
        options={['contain', 'cover', 'fill']}
        onChange={(value) => onUpdate({ objectFit: value as 'contain' | 'cover' | 'fill' })}
      />
    </PropertyGroup>
  );
}

// --- Shared form components ---

function PropertyGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="p-4 rounded-2xl bg-zinc-900/30 border border-zinc-800/50">
      <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">{title}</h4>
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
  suffix,
  placeholder,
}: {
  label: string;
  type: string;
  value: string | number;
  onChange: (value: string | number) => void;
  step?: number;
  suffix?: string;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="text-xs text-zinc-500 block mb-1.5">{label}</label>
      <div className="relative">
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(type === 'number' ? Number(e.target.value) : e.target.value)}
          step={step}
          placeholder={placeholder}
          className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl text-sm text-zinc-100 placeholder-zinc-600 px-3 py-2 focus:outline-none focus:border-amber-500/50 transition-all"
        />
        {suffix && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-500">{suffix}</span>
        )}
      </div>
    </div>
  );
}

function PropertySelect({
  label,
  value,
  options,
  labels,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  labels?: string[];
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label className="text-xs text-zinc-500 block mb-1.5">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl text-sm text-zinc-100 px-3 py-2 focus:outline-none focus:border-amber-500/50 transition-all"
      >
        {options.map((option, i) => (
          <option key={option} value={option}>
            {labels ? labels[i] : option}
          </option>
        ))}
      </select>
    </div>
  );
}

function AlignButton({ icon, title, onClick }: { icon: React.ReactNode; title: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="flex items-center justify-center p-2 rounded-lg bg-zinc-900/50 border border-zinc-800/50 text-zinc-400 hover:text-amber-400 hover:border-amber-500/30 hover:bg-amber-500/5 transition-all"
    >
      {icon}
    </button>
  );
}
