'use client';

import { useState, useEffect, useRef } from 'react';
import { useGlobalElementStore } from '@/lib/globalStore';
import type { LabelTemplate, ImageElement } from '@/lib/types';
import { MAX_RUN_IMAGE_BYTES, MAX_RUN_IMAGE_PIXELS, validateRunImages, type RunImageSelections } from '@/lib/runImages';

export function RunImagePicker({ template, selections, onChange, onBusyChange }: {
  template: LabelTemplate; selections: RunImageSelections; onChange: (value: RunImageSelections) => void; onBusyChange: (busy: boolean) => void;
}) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [librarySlot, setLibrarySlot] = useState<string | null>(null);
  const { globals, fetchGlobals, hydrated, loading, hasMore, error: libraryError } = useGlobalElementStore();
  const savedImages = globals.flatMap(group => group.elements.filter((e): e is ImageElement => e.type === 'image').map(image => ({ id: group.id + ':' + image.id, name: group.name, src: image.src })));
  const mounted = useRef(true);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});
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
  return <section className="card p-4 sm:p-5 space-y-3">
    <h2 className="text-base font-semibold text-zinc-100">Run images</h2>
    <p className="text-sm text-zinc-400">Choose once per slot for every label in this run. Leave unchanged to use the template default. Choices are saved with the run, not the preset. PNG, JPEG or WebP; 1 MB each, 16 megapixels max.</p>
    {slots.map((slot, index) => <div key={slot.id} className="flex items-center gap-3">
      <img src={selections[slot.id] ?? slot.src} alt={'Image slot ' + (index + 1) + ' preview'} className="size-20 shrink-0 bg-white rounded-md" style={{ objectFit: slot.objectFit }} />
      <div className="min-w-0 flex flex-wrap items-center gap-x-1 gap-y-1">
        <p className="w-full text-sm font-medium text-zinc-100">{slot.fieldName || ('Image slot ' + (index + 1))}</p>
        <input ref={node => { inputs.current[slot.id] = node; }} type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} className="hidden" aria-label={'Choose image for ' + (slot.fieldName || ('slot ' + (index + 1)))} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void upload(slot.id, file); }} />
        <button type="button" disabled={busy} className="btn btn-secondary btn-sm" onClick={() => inputs.current[slot.id]?.click()}>{Object.hasOwn(selections, slot.id) ? 'Replace image' : 'Choose image'}</button>
        <button type="button" disabled={busy} className="btn btn-ghost btn-sm" onClick={() => { setLibrarySlot(slot.id); if (!hydrated) void fetchGlobals(); }}>Choose from saved blocks</button>
        <p className="w-full text-xs text-zinc-500">{Object.hasOwn(selections, slot.id) ? 'Selected for this run' : 'Using template image'}</p>
        <button type="button" disabled={busy || !Object.hasOwn(selections, slot.id)} className="btn btn-ghost btn-sm" onClick={() => { const next = { ...selections }; delete next[slot.id]; onChange(next); setError(''); }}>Reset to template image</button>
      </div>
    </div>)}
    {librarySlot && <div className="rounded-lg bg-zinc-950 p-3 space-y-2">
      <div className="flex justify-between"><h3 className="section-title">Images from saved blocks</h3><button type="button" className="btn btn-ghost btn-sm -mr-2" onClick={() => setLibrarySlot(null)}>Close</button></div>
      <div className="flex flex-wrap gap-2">{savedImages.map(image => <button key={image.id} type="button" disabled={busy} className="w-24 rounded-md border border-zinc-800 p-1 text-xs text-zinc-300 transition-colors hover:border-zinc-600 hover:border-amber-500" onClick={() => { try { const next = { ...selections, [librarySlot]: image.src }; validateRunImages(next); onChange(next); setLibrarySlot(null); setError(''); } catch (e) { setError(e instanceof Error ? e.message : 'Unsupported saved image'); } }}><img src={image.src} alt={image.name} className="h-16 w-full object-contain bg-white" /><span>{image.name}</span></button>)}</div>
      {!loading && !savedImages.length && <p className="text-xs text-zinc-500">No images in loaded saved blocks. Upload an image, or save one as a reusable element in the designer.</p>}
      {libraryError && <p role="alert" className="text-xs text-red-400">{libraryError}</p>}
      {(hasMore || libraryError) && <button type="button" disabled={loading} className="btn btn-secondary btn-sm" onClick={() => void fetchGlobals(hasMore)}>Load saved blocks</button>}
      {loading && <p role="status" className="text-xs text-zinc-500">Loading saved blocks…</p>}
    </div>}
    {busy && <p role="status" className="text-xs text-zinc-400">Loading image…</p>}
    {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
  </section>;
}
