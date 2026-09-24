'use client';
import { useEffect, useRef, useState } from 'react';
import { useTemplateStore } from '@/lib/templateStore';
import { useFormatStore } from '@/lib/store';
import { bitmapCopy, importNaturalDesign } from '@/lib/thermal/import';
import { getBitmapProof } from '@/lib/thermal/client';
import { generateZPLWithImages } from '@/lib/zplGenerator';
import { renderZplToDataUrl } from '@/lib/zplRenderClient';
import type { LabelTemplate, LabelFormat } from '@/lib/types';

export function BitmapTemplateActions({ source, format, values = {}, onCreated }: { source?: LabelTemplate; format?: LabelFormat; values?: Record<string, string>; onCreated: (id: string) => void }) {
  const file = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<{ template: LabelTemplate; format: LabelFormat; report: string[] } | null>(null);
  const [proof, setProof] = useState(''), [oldProof, setOldProof] = useState('');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true; setProof(''); setOldProof('');
    if (!draft) return;
    getBitmapProof(draft.template, draft.format, values).then(r => { if (active) setProof(r.proof); }).catch(e => { if (active) setError(e.message); });
    if (source && format) generateZPLWithImages(source, format, values).then(z => renderZplToDataUrl(z, format)).then(url => { if (active) setOldProof(url); }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  // Draft captures the conversion inputs. Parent changes do not alter this proof.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);
  const load = (value: unknown) => { setError(''); try { setDraft(importNaturalDesign(value)); } catch (e) { setError((e as Error).message); } };
  const create = async () => {
    if (!draft) return;
    setBusy(true); setError('');
    try {
      let target = useFormatStore.getState().formats.find(f => f.type === 'thermal' && f.width === draft.format.width && f.height === draft.format.height && (f.dpi || 203) === draft.format.dpi && (f.labelsAcross || 1) === (draft.format.labelsAcross || 1) && (f.horizontalGapThermal || 0) === (draft.format.horizontalGapThermal || 0) && (f.linerWidth || 0) === (draft.format.linerWidth || 0) && (f.sideMarginThermal || 0) === (draft.format.sideMarginThermal || 0));
      if (!target) {
        const { id: _id, createdAt: _c, updatedAt: _u, ...spec } = draft.format;
        void _id; void _c; void _u;
        target = await useFormatStore.getState().addFormat(spec);
      }
      const created = await useTemplateStore.getState().addTemplate({ name: draft.template.name, description: draft.template.description, formatId: target.id, thermalRenderMode: 'bitmap-v1', elements: draft.template.elements.map(e => ({ ...e, id: crypto.randomUUID() })) });
      if (source) localStorage.setItem(`lw:test-data:${created.id}`, JSON.stringify(values));
      setDraft(null); onCreated(created.id);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return <div className="text-xs">
    {source ? source.thermalRenderMode !== 'bitmap-v1' && format?.type === 'thermal' && <button className="text-amber-400 border border-zinc-700 rounded px-2 py-1" onClick={() => { setError(''); setDraft({ template: { ...bitmapCopy(source), name: `${source.name} (bitmap)` }, format, report: ['Creates a new editable template. Original templates and runs are unchanged.', 'Fonts use bundled Liberation equivalents; native character width resets to 1. Compare the proofs and adjust the copy as needed.'] }); }}>Duplicate and convert</button> : <div className="flex gap-3 px-8 pt-5">
      <button className="text-amber-400" onClick={() => file.current?.click()}>Import Natural label JSON</button>
      <button className="text-amber-400" onClick={async () => { setError(''); try { const r = await fetch('/api/thermal/example'); if (!r.ok) throw new Error('Unable to load example'); load(await r.json()); } catch (e) { setError((e as Error).message); } }}>Lemon example</button>
      <input ref={file} type="file" accept=".json" className="hidden" onChange={async e => { const f = e.target.files?.[0]; if (!f) return; try { if (f.size > 4_000_000) throw new Error('Design exceeds 4 MB'); load(JSON.parse(await f.text())); } catch (e) { setError((e as Error).message); } e.target.value = ''; }} />
    </div>}
    {error && !draft && <p role="alert" className="text-red-400 p-2">{error}</p>}
    {draft && <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"><div role="dialog" aria-label="Review bitmap conversion" className="bg-zinc-950 border border-zinc-700 rounded-xl p-5 max-w-4xl w-full max-h-[90vh] overflow-auto space-y-4">
      <h2 className="text-lg">Review bitmap copy</h2>
      {draft.report.map((s, i) => <p key={i} className="text-zinc-400">{s}</p>)}
      <div className="grid sm:grid-cols-2 gap-4">
        {source && <div><p>Original native output</p>{oldProof && <img src={oldProof} alt="Original native proof" className="w-full bg-white" />}</div>}
        <div><p>New bitmap proof</p>{proof ? <img src={proof} alt="New bitmap proof" className="w-full bg-white" style={{ imageRendering: 'pixelated' }} /> : <p className="text-zinc-500">{error ? 'Adjust the editable copy to resolve the issue below.' : 'Rendering…'}</p>}</div>
      </div>
      {error && <p role="alert" className="text-red-400">{error}</p>}
      <p className="text-zinc-500">A copy can be saved for adjustments even if preflight reports overflow. Printing stays blocked until a valid proof is ready.</p>
      <button disabled={busy} onClick={() => void create()} className="bg-amber-500 text-black rounded px-3 py-2">{busy ? 'Creating…' : 'Create editable bitmap copy'}</button>
      <button disabled={busy} className="ml-3" onClick={() => { setDraft(null); setError(''); }}>Cancel</button>
    </div></div>}
  </div>;
}
