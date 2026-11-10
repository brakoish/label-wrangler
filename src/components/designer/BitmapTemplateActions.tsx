'use client';
import { useEffect, useRef, useState } from 'react';
import { useTemplateStore } from '@/lib/templateStore';
import { useFormatStore } from '@/lib/store';
import { bitmapCopy, importNaturalDesign } from '@/lib/thermal/import';
import { getBitmapProof } from '@/lib/thermal/client';
import { generateZPLWithImages } from '@/lib/zplGenerator';
import { renderZplToDataUrl } from '@/lib/zplRenderClient';
import type { LabelTemplate, LabelFormat } from '@/lib/types';
import { Dialog } from '@/components/ui/Dialog';
import { friendlyError } from '@/lib/userMessages';

export function BitmapTemplateActions({ source, format, values = {}, onCreated }: { source?: LabelTemplate; format?: LabelFormat; values?: Record<string, string>; onCreated: (id: string) => void }) {
  const file = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<{ template: LabelTemplate; format: LabelFormat; report: string[] } | null>(null);
  const [prepared, setPrepared] = useState<LabelTemplate | null>(null);
  const [adjustments, setAdjustments] = useState(0);
  const [proof, setProof] = useState(''), [oldProof, setOldProof] = useState('');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true; setProof(''); setOldProof(''); setPrepared(null); setAdjustments(0);
    if (!draft) return;
    if (source) {
      fetch('/api/thermal/convert', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ template: source, format: draft.format, values }) })
        .then(async response => { const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Conversion failed'); return result; })
        .then(result => { if (active) { setPrepared({ ...result.template, name: draft.template.name }); setProof(result.proof); setAdjustments(result.adjustments.length); setError((result.warnings || []).map((w: { message: string }) => w.message).join(' ')); } })
        .catch(e => { if (active) setError(e.message); });
    } else {
      getBitmapProof(draft.template, draft.format, values).then(r => { if (active) { setPrepared(draft.template); setProof(r.proof); } }).catch(e => { if (active) setError(e.message); });
    }
    if (source && format) generateZPLWithImages(source, format, values).then(z => renderZplToDataUrl(z, format)).then(url => { if (active) setOldProof(url); }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  // Draft captures the conversion inputs. Parent changes do not alter this proof.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);
  const load = (value: unknown) => { setError(''); try { setDraft(importNaturalDesign(value)); } catch (e) { setError((e as Error).message); } };
  const create = async () => {
    if (!draft || !proof || !prepared) return;
    setBusy(true); setError('');
    try {
      let target = useFormatStore.getState().formats.find(f => f.type === 'thermal' && f.width === draft.format.width && f.height === draft.format.height && (f.dpi || 203) === draft.format.dpi && (f.labelsAcross || 1) === (draft.format.labelsAcross || 1) && (f.horizontalGapThermal || 0) === (draft.format.horizontalGapThermal || 0) && (f.linerWidth || 0) === (draft.format.linerWidth || 0) && (f.sideMarginThermal || 0) === (draft.format.sideMarginThermal || 0));
      if (!target) {
        const { id: _id, createdAt: _c, updatedAt: _u, ...spec } = draft.format;
        void _id; void _c; void _u;
        target = await useFormatStore.getState().addFormat(spec);
      }
      const created = await useTemplateStore.getState().addTemplate({ name: draft.template.name, description: draft.template.description, formatId: target.id, thermalRenderMode: 'bitmap-v1', elements: prepared.elements.map(e => ({ ...e, id: crypto.randomUUID() })) });
      if (source) localStorage.setItem(`lw:test-data:${created.id}`, JSON.stringify(values));
      setDraft(null); onCreated(created.id);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return <div className="text-sm">
    {source ? source.thermalRenderMode !== 'bitmap-v1' && format?.type === 'thermal' && <details className="group relative"><summary className="btn btn-ghost btn-sm list-none [&::-webkit-details-marker]:hidden">More</summary><div className="popover-enter absolute right-0 top-full z-30 mt-1 w-72 rounded-xl bg-zinc-900 p-3 shadow-xl shadow-black/40 [--origin:top_right]"><p className="pb-2 text-zinc-400">Make a copy that prints any font as an exact picture. This design stays as it is.</p><button type="button" className="btn btn-secondary btn-sm w-full" onClick={(e) => { (e.currentTarget.closest('details') as HTMLDetailsElement | null)?.removeAttribute('open'); setError(''); setDraft({ template: { ...bitmapCopy(source, format), name: `${source.name} (exact print)` }, format, report: ['Makes a new design. This one and its runs stay as they are.', 'Text uses fonts built into the app and is sized once to fit the sample values. Compare the two previews before you make the copy.'] }); }}>Make an exact-print copy</button></div></details> : <details className="px-4 sm:px-6 lg:px-8"><summary className="inline-flex min-h-control-sm cursor-pointer items-center text-zinc-400 hover:text-zinc-100">Admin tools</summary><div className="flex flex-wrap gap-3 pt-2">
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => file.current?.click()}>Import a design file</button>
      <button type="button" className="btn btn-secondary btn-sm" onClick={async () => { setError(''); try { const r = await fetch('/api/thermal/example'); if (!r.ok) throw new Error('Unable to load example'); load(await r.json()); } catch (e) { setError((e as Error).message); } }}>Load the test design</button>
      <input ref={file} type="file" accept=".json" className="hidden" onChange={async e => { const f = e.target.files?.[0]; if (!f) return; try { if (f.size > 4_000_000) throw new Error('Design exceeds 4 MB'); load(JSON.parse(await f.text())); } catch (e) { setError((e as Error).message); } e.target.value = ''; }} />
    </div></details>}
    {error && !draft && <p role="alert" className="text-red-400 py-2">{friendlyError(error)}</p>}
    <Dialog open={!!draft} onClose={() => { if (!busy) { setDraft(null); setError(''); } }} dismissible={!busy} title="Make an exact-print copy" className="max-w-4xl">{draft && <div className="space-y-4">
      {draft.report.map((s, i) => <p key={i} className="text-zinc-400">{s}</p>)}
      <div className="grid sm:grid-cols-2 gap-4">
        {source && <div className="space-y-2"><p className="section-title">How it prints now</p>{oldProof && <img src={oldProof} alt="How it prints now" className="w-full bg-white" />}</div>}
        <div className="space-y-2"><p className="section-title">Exact-print copy</p>{proof ? <img src={proof} alt="Exact-print copy" className="w-full bg-white" style={{ imageRendering: 'pixelated' }} /> : <p className="text-zinc-500">{error ? 'Fix the problem below, then try again.' : 'Drawing the preview…'}</p>}</div>
      </div>
      {adjustments > 0 && <p className="text-amber-400">Made {adjustments} text {adjustments === 1 ? 'item' : 'items'} smaller to fit. Longer values may need more room.</p>}
      {error && <p role="alert" className="text-red-400">{friendlyError(error)}</p>}
      <p className="text-zinc-500">{source ? 'You can fix any problems in the copy afterwards. This design stays as it is.' : 'The copy needs a working preview first.'}</p>
      <button disabled={busy || !proof || !prepared} onClick={() => void create()} className="btn btn-primary">{busy ? 'Making the copy…' : 'Make the copy'}</button>
      <button type="button" disabled={busy} className="btn btn-secondary ml-2" onClick={() => { setDraft(null); setError(''); }}>Cancel</button>
    </div>}</Dialog>
  </div>;
}
