'use client';
import type { Run, LabelTemplate, LabelFormat } from '@/lib/types';
import { generateLabelsForRunWithImages } from '@/lib/runBuilder';
import { renderZplToDataUrl } from '@/lib/zplRenderClient';
import { OfficePrinterControls } from './OfficePrinterControls';
import { createPortal } from 'react-dom';
import { Printer as PrinterIcon, Hash, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
interface Printer { station_id:string; id:string; name:string; dpi:number; max_width_dots:number; last_seen:string|null; online:boolean; available:boolean; dispatch_enabled:boolean; paired_at:string|null; needs_review:boolean }
interface Job { id:string; from:number; to:number; count:number; state:string; review:boolean; reason:string|null; cupsJobId:number|null }
interface PrintRequest { id:string; range_from:number; range_to:number; reprint_of:string|null; username:string; jobs:Job[] }
async function api(path:string,init?:RequestInit){
  const response=await fetch(path,{...init,headers:{'Content-Type':'application/json',...init?.headers},cache:'no-store'});
  const result=await response.json();if(!response.ok)throw new Error(result.error || 'Request failed');return result;
}
const labels:Record<string,string>={queued:'Waiting for office',claimed:'Assigned to office',submitted:'Queued at office',sent_to_printer:'Sent to printer',rejected:'Rejected — check reason',needs_review:'Check printer before retrying',cancelled:'Cancelled before dispatch',resolved:'Reviewed by operator'};
const inputClass='w-full rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-300 focus:outline-none focus:border-amber-500/50';
export function OfficePiPrinter({runId,total,connectionTarget,run,template,format}:{runId:string;total:number;connectionTarget:HTMLDivElement|null;run?:Run;template?:LabelTemplate;format?:LabelFormat}){
  const [printers,setPrinters]=useState<Printer[]>([]);const [selected,setSelected]=useState('');
  const [requests,setRequests]=useState<PrintRequest[]>([]);const [canPrint,setCanPrint]=useState(false);
  const [from,setFrom]=useState('1');const [to,setTo]=useState(String(total));
  const [error,setError]=useState('');const [notice,setNotice]=useState('');const [busy,setBusy]=useState(false);
  const [pending,setPending]=useState<{from:number;to:number}|null>(null);
  const bitmap = template?.thermalRenderMode === 'bitmap-v1';
  const proofKey = JSON.stringify([run,template,format,from,to]);
  const currentProofKey = useRef(proofKey); currentProofKey.current = proofKey;
  const [proof,setProof]=useState<{key:string;digest:string;feeds:string[]}|null>(null);
  const [proofIndex,setProofIndex]=useState(0),[proofImage,setProofImage]=useState('');
  useEffect(()=>{
    let active=true;setProofImage('');
    if(proof?.key===proofKey && format) renderZplToDataUrl(proof.feeds[proofIndex],format).then(url=>{if(active)setProofImage(url);}).catch(e=>setError(e.message));
    return()=>{active=false;};
  },[proof,proofKey,proofIndex,format]);
  const prepareProof=async()=>{
    if(!run||!template||!format||inFlight.current)return;
    inFlight.current=true;setBusy(true);setError('');setProof(null);
    const key=proofKey;
    try{
      const feeds=await generateLabelsForRunWithImages(run,template,format,{from:Number(from),to:Number(to)});
      if(!feeds.length)throw new Error('Choose a valid label range');
      const digests=feeds.map(z=>z.match(/\^FXLWBITMAP1:[a-f0-9]{64}:([a-f0-9]{64})\^FS/)?.[1]);
      const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(digests.join('\n')));
      const digest=Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
      if(currentProofKey.current===key){setProof({key,digest,feeds});setProofIndex(0);}
    }catch(e){setError(e instanceof Error?e.message:'Proof failed');}finally{inFlight.current=false;setBusy(false);}
  };
  const [showReprint,setShowReprint]=useState(false);
  const [reprintOf,setReprintOf]=useState('');
  const [review,setReview]=useState<Job|null>(null);const [reviewReason,setReviewReason]=useState('');const [checked,setChecked]=useState(false);
  const inFlight=useRef(false);
  const rangeEdited=useRef(false);
  // Persist a submission identity before network I/O. An uncertain response,
  // reload or double-click retries this identity, never manufactures new jobs.
  const storageKey=`lw:office-pending:${runId}`;
  useEffect(()=>{
    const saved=localStorage.getItem(storageKey);
    if(saved){try{const data=JSON.parse(saved);setPending({from:data.from,to:data.to});setFrom(String(data.from));setTo(String(data.to));setReprintOf(data.reprintOf || '');}catch{setError('The pending request record could not be read. Check the queue before clearing it.');}}
  },[storageKey]);
  const refresh=useCallback(async()=>{
    const [stationData,jobData]=await Promise.all([api('/api/office/stations'),api('/api/office/jobs?runId='+encodeURIComponent(runId))]);
    setPrinters(stationData.printers);setCanPrint(stationData.canPrint);setRequests(jobData.requests);
    if(!rangeEdited.current && !localStorage.getItem(storageKey)){
      const deliveredJobs:Job[]=jobData.requests.flatMap((r:PrintRequest)=>r.jobs).filter((j:Job)=>j.state==='sent_to_printer').sort((a:Job,b:Job)=>a.from-b.from);
      let through=0;
      for(const job of deliveredJobs){if(job.from>through+1)break;through=Math.max(through,job.to);}
      setFrom(String(Math.min(total,through+1)));setTo(String(total));
    }
    setSelected(value=>value || (stationData.printers[0]?`${stationData.printers[0].station_id}/${stationData.printers[0].id}`:''));
  },[runId,storageKey,total]);
  useEffect(()=>{
    let active=true;
    const update=()=>refresh().catch(err=>{if(active)setError(err.message);});
    void update();const timer=setInterval(()=>void update(),5000);
    return()=>{active=false;clearInterval(timer);};
  },[refresh]);
  const printer=printers.find(p=>`${p.station_id}/${p.id}`===selected);
  const submit=async()=>{
    if(inFlight.current || !printer)return;inFlight.current=true;setBusy(true);setError('');setNotice('');
    try{
      let payload;
      const saved=localStorage.getItem(storageKey);
      if(saved)payload=JSON.parse(saved);
      else{
        payload={runId,stationId:printer.station_id,printerId:printer.id,from:Number(from),to:Number(to),idempotencyKey:crypto.randomUUID(),...(reprintOf?{reprintOf}: {}),...(bitmap?{expectedBitmapDigest:proof?.digest}:{})};
        localStorage.setItem(storageKey,JSON.stringify(payload));setPending({from:payload.from,to:payload.to});
      }
      const result=await api('/api/office/jobs',{method:'POST',body:JSON.stringify(payload)});
      localStorage.removeItem(storageKey);setPending(null);setNotice(`Queued labels ${payload.from}–${payload.to}. Request ${result.requestId.slice(0,8)}. You can close this page.`);
      setReprintOf('');rangeEdited.current=false;await refresh();
    }catch(err){setError(err instanceof Error?err.message:'Unable to queue labels');}
    finally{inFlight.current=false;setBusy(false);}
  };
  const act=async(action:()=>Promise<void>)=>{setBusy(true);setError('');try{await action();await refresh();}catch(err){setError(err instanceof Error?err.message:'Request failed');}finally{setBusy(false);}};
  const allJobs=requests.flatMap(r=>r.jobs);
  const sent=allJobs.filter(j=>j.state==='sent_to_printer').reduce((sum,j)=>sum+j.count,0);
  const queued=allJobs.filter(j=>['queued','claimed','submitted'].includes(j.state)).reduce((sum,j)=>sum+j.count,0);
  // Count delivered ranges once, even when a range has been reprinted.
  const ranges=allJobs.filter(j=>j.state==='sent_to_printer').sort((a,b)=>a.from-b.from);
  let delivered=0;let end=0;
  for(const job of ranges){delivered+=Math.max(0,job.to-Math.max(end,job.from-1));end=Math.max(end,job.to);}
  const pct=total?Math.min(100,Math.round(delivered/total*100)):0;
  const reprintRequests=requests.filter(r=>r.jobs.every(j=>!j.review && !['queued','claimed','submitted','needs_review'].includes(j.state)));
  const connection=<div className="space-y-3">
    <label className="block text-xs text-zinc-400">Printer<select className={inputClass+' mt-1'} value={selected} onChange={e=>setSelected(e.target.value)}>
      {!printers.length && <option value="">No authorized office printer</option>}
      {printers.map(p=><option key={p.id} value={`${p.station_id}/${p.id}`}>{p.name}</option>)}
    </select></label>
    {printer && <div className="text-xs space-y-1 text-zinc-400">
      <p className={printer.online?'text-emerald-400':'text-amber-400'}>{printer.online?(printer.available?'Connected':'Connected · printer unavailable'):'Office offline · queued work waits for reconnect'}</p>
      
      {!printer.dispatch_enabled && <p className="text-amber-400">Awaiting verified pairing and activation. Job creation is disabled.</p>}
      {printer.needs_review && <p className="text-red-400">Check printer before retrying. Dispatch is blocked until reviewed.</p>}
    </div>}
    <OfficePrinterControls />
    {printer && <details className="text-[11px] text-zinc-500"><summary className="cursor-pointer hover:text-zinc-300">Connection details</summary><p className="mt-2">Last contact: {printer.last_seen?new Date(printer.last_seen).toLocaleString():'not paired yet'} · {printer.dpi} DPI</p></details>}
  </div>;
  return <div className="space-y-4">
    {connectionTarget && createPortal(connection,connectionTarget)}
    <div className="flex items-center justify-between">
      <h2 className="text-xs text-zinc-500 uppercase tracking-wider font-semibold">Progress</h2>
      <span className="text-sm font-semibold text-zinc-100 tabular-nums">Sent to printer: {delivered} / {total} · {pct}%</span>
    </div>
    <div className="h-3 rounded-full bg-zinc-900 overflow-hidden"><div className="h-full bg-gradient-to-r from-amber-500 to-amber-400 transition-all" style={{width:`${pct}%`}} /></div>
    <p className="text-[11px] text-zinc-500">{queued} labels waiting for delivery. Delivery does not confirm physical printing.</p>
    <div className="grid grid-cols-2 gap-2">
      <label className="text-xs text-zinc-400">From label<input aria-label="Office from label" className={inputClass} inputMode="numeric" disabled={!!pending} value={from} onChange={e=>{rangeEdited.current=true;setFrom(e.target.value);}} /></label>
      <label className="text-xs text-zinc-400">Stop after label<input aria-label="Office through label" className={inputClass} inputMode="numeric" disabled={!!pending} value={to} onChange={e=>{rangeEdited.current=true;setTo(e.target.value);}} /></label>
    </div>
    <label className="block text-xs text-zinc-400">Print count<input aria-label="Office print label count" type="number" min={1} max={Math.max(1,total-Number(from)+1)} disabled={!!pending} className={inputClass+' mt-1'} value={Math.max(0,Number(to)-Number(from)+1)} onChange={e=>{rangeEdited.current=true;setTo(String(Math.min(total,Number(from)+Math.max(1,Number(e.target.value))-1)));}} /></label>
    {pending && <p className="text-xs text-amber-400">Pending submission for labels {pending.from}–{pending.to}. Retry checks the same request; it does not create another batch.</p>}
    {reprintOf && <div className="space-y-2 rounded border border-amber-700 p-2 text-xs"><p>Reprint linked to the original print. This will be recorded in history.</p><button onClick={()=>{setReprintOf('');}}>Exit reprint mode</button></div>}
    {bitmap && !pending && <div className="space-y-2 text-xs">
      <button disabled={busy} onClick={()=>void prepareProof()} className="text-amber-400 underline disabled:opacity-40">{busy?'Preparing…':'Prepare exact range proof'}</button>
      {proof?.key===proofKey && <div><p>{proof.feeds.length} feeds checked · preview feed {proofIndex+1}</p>
        {proofImage && <img src={proofImage} alt="Office range bitmap proof" className="w-full bg-white" style={{imageRendering:'pixelated'}} />}
        <input aria-label="Office proof feed" type="number" min={1} max={proof.feeds.length} value={proofIndex+1} onChange={e=>setProofIndex(Math.max(0,Math.min(proof.feeds.length-1,Number(e.target.value)-1)))} className={inputClass} />
      </div>}
      {proof?.key!==proofKey && <p className="text-zinc-400">Prepare the selected range before printing. Missing values or overflow stop the entire request.</p>}
    </div>}
    <button disabled={(bitmap && !pending && proof?.key!==proofKey) || (!reprintOf && !pending && delivered >= total) || busy || !canPrint || !printer?.dispatch_enabled || !!printer?.needs_review} onClick={()=>void submit()} className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold bg-gradient-to-r from-amber-500 to-amber-600 text-black hover:from-amber-400 hover:to-amber-500 disabled:opacity-40"><PrinterIcon className="w-4 h-4" />{busy?'Working…':pending?'Retry same request':reprintOf?'Start Reprint':delivered>=total?'Completed':delivered>0?'Resume Printing':'Start Printing'}</button>
    <div className="pt-3 border-t border-zinc-800/60 space-y-2">
      <button disabled={busy || !!pending} onClick={()=>setShowReprint(value=>!value)} className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium text-zinc-400 hover:text-amber-400 border border-zinc-800 disabled:opacity-40"><Hash className="w-3 h-3" />Reprint from label…</button>
      <button disabled={busy || !!pending || !reprintRequests.length || allJobs.some(j=>j.review || ['queued','claimed','submitted','needs_review'].includes(j.state))} onClick={()=>{rangeEdited.current=true;setReprintOf(reprintRequests[0].id);setFrom('1');setTo(String(total));setShowReprint(false);}} className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium text-zinc-400 hover:text-amber-400 border border-zinc-800 disabled:opacity-40"><RotateCcw className="w-3 h-3" />Reprint all</button>
      {showReprint && <label className="block text-xs text-zinc-400">Previous print range
        <select aria-label="Previous print range" className={inputClass+' mt-1'} value={reprintOf} onChange={e=>{const request=requests.find(r=>r.id===e.target.value);rangeEdited.current=true;setReprintOf(e.target.value);if(request){setFrom(String(request.range_from));setTo(String(request.range_to));}}}>
          <option value="">Select a completed or reviewed request</option>
          {reprintRequests.map(r=><option key={r.id} value={r.id}>Labels {r.range_from}–{r.range_to} · {r.id.slice(0,8)}</option>)}
        </select>
        {!reprintRequests.length && <p className="mt-1">No completed or reviewed requests yet. Check queue details for pending work.</p>}
      </label>}
    </div>
    {error && <div role="alert" className="text-xs text-red-400 space-y-2"><p>{error}</p><p>Retry keeps the same request ID. If this was a validation error, check the queue below before changing the request.</p><button onClick={()=>{localStorage.removeItem(storageKey);setPending(null);setError('');}} className="underline">Clear pending request form (does not cancel queued jobs)</button></div>}
    {notice && <p role="status" className="text-xs text-emerald-400">{notice}</p>}
    <details className="border-t border-zinc-800/60 pt-3">
      <summary className="cursor-pointer text-xs text-zinc-400">Queue details <span className="text-zinc-600">· {queued} waiting · {sent} sent</span></summary>
    <div className="max-h-96 overflow-y-auto space-y-3 mt-3">
      {requests.map(r=><div key={r.id} className="rounded border border-zinc-800 p-2 space-y-2 text-xs">
        <p className="font-medium">Labels {r.range_from}–{r.range_to} · {r.username}{r.reprint_of?' · reprint':''}</p>
        <p className="text-zinc-500">Request {r.id.slice(0,8)}</p>
        <details><summary className="cursor-pointer text-zinc-400">{r.jobs.length} batches · {r.jobs.filter(j=>j.state==='sent_to_printer').length} sent</summary>
          {r.jobs.map(j=><div key={j.id} className="border-t border-zinc-800 py-2"><p>{j.from}–{j.to}: {j.review?'Check printer before retrying':labels[j.state]}</p>{j.reason && <p className="text-zinc-500">{j.reason}</p>}{j.cupsJobId && <p className="text-zinc-500">Office CUPS job {j.cupsJobId}</p>}
            {canPrint && (j.review || ['claimed','submitted','needs_review','rejected'].includes(j.state)) && <button disabled={busy} className="mt-1 text-amber-400 underline" onClick={()=>{setReview(j);setChecked(false);setReviewReason('');}}>Review outcome</button>}
          </div>)}
        </details>
        {canPrint && r.jobs.some(j=>j.state==='queued') && <button disabled={busy} className="text-amber-400 underline" onClick={()=>void act(async()=>{const result=await api('/api/office/jobs/'+r.id,{method:'DELETE'});setNotice(`Cancelled ${result.cancelled} unclaimed batches. ${result.requires_review} assigned batches require review; no CUPS cancellation was sent.`);})}>Cancel unclaimed batches</button>}
        {canPrint && r.jobs.every(j=>!j.review && !['queued','claimed','submitted','needs_review'].includes(j.state)) && <button className="ml-2 text-amber-400 underline" onClick={()=>{rangeEdited.current=true;setReprintOf(r.id);setFrom(String(r.range_from));setTo(String(r.range_to));}}>Reprint</button>}
      </div>)}
    </div>
    </details>
    {review && <div role="dialog" aria-label="Review office print outcome" className="rounded border border-amber-600 bg-zinc-950 p-3 space-y-3 text-xs">
      <p className="font-semibold">Review labels {review.from}–{review.to}</p>
      <p>Check the physical printer and office CUPS queue. Finish or cancel pending local work before resolving. This button cannot stop the printer.</p>
      <label className="flex gap-2"><input type="checkbox" checked={checked} onChange={e=>setChecked(e.target.checked)} />I checked the printer and no pending CUPS job can print these labels later.</label>
      <textarea className={inputClass} placeholder="What printed, what failed, and how pending work was resolved" value={reviewReason} onChange={e=>setReviewReason(e.target.value)} />
      <button disabled={busy || !checked || reviewReason.trim().length<3} className="rounded bg-amber-500 p-2 text-black disabled:opacity-40" onClick={()=>void act(async()=>{await api('/api/office/review',{method:'POST',body:JSON.stringify({jobId:review.id,pendingCupsResolved:checked,reason:reviewReason})});setReview(null);setNotice('Review recorded. No reprint was created.');})}>Record resolution</button>
      <button className="ml-3" onClick={()=>setReview(null)}>Close</button>
    </div>}
  </div>;
}
