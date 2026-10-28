'use client';

import { useState, useEffect, useRef } from 'react';
import type { LabelTemplate, ImageElement } from '@/lib/types';
import { MAX_RUN_IMAGE_BYTES, MAX_RUN_IMAGE_PIXELS, validateRunImages, type RunImageSelections } from '@/lib/runImages';

export function RunImagePicker({ template, selections, onChange, onBusyChange }: {
  template: LabelTemplate; selections: RunImageSelections; onChange: (value: RunImageSelections) => void; onBusyChange: (busy: boolean) => void;
}) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; onBusyChange(false); }; }, [onBusyChange]);
  const slots = template.elements.filter((e): e is ImageElement => e.type === 'image' && e.runSelectable === true);
  if (!slots.length) return null;
  async function upload(id: string, file: File) {
    setError(''); setBusy(true); onBusyChange(true);
    try {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > MAX_RUN_IMAGE_BYTES) throw new Error('Choose a PNG, JPEG or WebP file, 1 MB or smaller.');
      const src = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('Could not read image.'));
        reader.readAsDataURL(file);
      });
      const next = { ...selections, [id]: src };
      validateRunImages(next);
      const image = new Image();
      image.src = src;
      await image.decode();
      if (image.naturalWidth * image.naturalHeight > MAX_RUN_IMAGE_PIXELS) throw new Error('Image must be 16 megapixels or smaller.');
      if (mounted.current) onChange(next);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load image.'); }
    finally { if (mounted.current) { setBusy(false); onBusyChange(false); } }
  }
  return <section className="rounded-xl border border-zinc-800 p-4 space-y-3">
    <h2 className="text-sm font-medium text-zinc-200">Run images</h2>
    <p className="text-xs text-zinc-500">Choose once per slot for every label in this run. Leave unchanged to use the template default. Choices are saved with the run, not the preset. PNG, JPEG or WebP; 1 MB each, 16 megapixels max.</p>
    {slots.map((slot, index) => <div key={slot.id} className="flex items-center gap-3">
      <img src={selections[slot.id] ?? slot.src} alt={'Image slot ' + (index + 1) + ' preview'} className="w-20 h-20 bg-white rounded border border-zinc-700" style={{ objectFit: slot.objectFit }} />
      <div className="min-w-0 space-y-1">
        <label className="block text-xs text-zinc-300">{slot.fieldName || ('Image slot ' + (index + 1))}
          <input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} className="block w-full text-xs mt-1" onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void upload(slot.id, file); }} />
        </label>
        <button type="button" disabled={busy || !Object.hasOwn(selections, slot.id)} className="text-xs text-amber-400 disabled:opacity-40" onClick={() => { const next = { ...selections }; delete next[slot.id]; onChange(next); setError(''); }}>Reset to template image</button>
      </div>
    </div>)}
    {busy && <p role="status" className="text-xs text-zinc-400">Loading image…</p>}
    {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
  </section>;
}
