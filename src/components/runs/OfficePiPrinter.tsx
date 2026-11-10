'use client';
import type { Run, LabelTemplate, LabelFormat } from '@/lib/types';
import { generateLabelsForRunWithImages } from '@/lib/runBuilder';
import { renderZplToDataUrl } from '@/lib/zplRenderClient';
import { OfficePrinterControls } from './OfficePrinterControls';
import { createPortal } from 'react-dom';
import { Printer as PrinterIcon, Hash, RotateCcw, CheckCircle2, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { confirmDialog } from '@/components/ui/feedback';
import { friendlyError, friendlyRenderError, isNetworkError } from '@/lib/userMessages';
import { firstUnsentLabel, isValidOfficeRange, officeProofKey, OFFICE_IN_PROGRESS as IN_PROGRESS, rangeOverlapsQueued } from '@/lib/officeRange';
interface Printer { station_id:string; id:string; name:string; dpi:number; max_width_dots:number; last_seen:string|null; online:boolean; available:boolean; dispatch_enabled:boolean; paired_at:string|null; needs_review:boolean; dispatch_hold_reason?:string|null }
interface Job { id:string; from:number; to:number; count:number; state:string; review:boolean; reason:string|null; cupsJobId:number|null }
interface PrintRequest { id:string; range_from:number; range_to:number; reprint_of:string|null; username:string; created_at?:string; jobs:Job[] }
/** HTTP error that remembers its status, so a definite refusal (4xx) reads differently from "not sure it arrived". */
class OfficeRequestError extends Error { constructor(message:string, public status:number){ super(message); } }
async function api(path:string,init?:RequestInit){
  const response=await fetch(path,{...init,headers:{'Content-Type':'application/json',...init?.headers},cache:'no-store'});
  const result=await response.json().catch(()=>({}));if(!response.ok)throw new OfficeRequestError(result.error || 'Request failed',response.status);return result;
}
const holdReasons:Record<string,string>={
  control_pending:'Waiting for office: a pause/resume command is still being delivered to the printer.',
  printer_paused:'Waiting for office: the printer is paused. Resume it to continue.',
  control_stale:'Waiting for office: the office computer has not reported the printer status recently, so new labels are held until it does.',
};
const labels:Record<string,string>={queued:'Waiting to be sent',claimed:'Picked up by the office',submitted:'In the office print queue',sent_to_printer:'Sent to printer',rejected:'Not printed — see reason',needs_review:'Check the printer before retrying',cancelled:'Cancelled before sending',resolved:'Checked by someone at the office'};
const inputClass='w-full rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-300 focus:border-amber-500/30';
/** Server wording -> plain words, without changing what the server checks. */
function officeMessage(error:unknown){
  return friendlyError(error,'The office printer request failed.')
    .replace('Prepare the proof again before printing.','Check the labels again before sending.')
    .replace('its bitmap proof is missing','the label check is missing');
}
function formatWhen(iso?:string){
  if(!iso)return '';
  try{return new Date(iso).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});}catch{return '';}
}
export function OfficePiPrinter({runId,total,connectionTarget,run,template,format,printAllowed=true}:{runId:string;total:number;connectionTarget:HTMLDivElement|null;run?:Run;template?:LabelTemplate;format?:LabelFormat;printAllowed?:boolean}){
  const uid=useId();
  const [printers,setPrinters]=useState<Printer[]>([]);const [selected,setSelected]=useState('');
  const [requests,setRequests]=useState<PrintRequest[]>([]);const [canPrint,setCanPrint]=useState(false);
  const [from,setFrom]=useState('1');const [to,setTo]=useState(String(total));
  const [error,setError]=useState('');const [errorKind,setErrorKind]=useState<'rejected'|'uncertain'|'other'>('other');
  const [notice,setNotice]=useState('');const [busy,setBusy]=useState(false);
  const [pending,setPending]=useState<{from:number;to:number}|null>(null);
  const bitmap = template?.thermalRenderMode === 'bitmap-v1';
  // Only things that change the printed labels invalidate the check; a
  // progress or status update on the run does not force a redo. The server
  // still verifies the digest against the saved run before queuing.
  const proofKey = useMemo(()=>officeProofKey(run,template,format,from,to),[run,template,format,from,to]);
  const currentProofKey = useRef(proofKey);
  useEffect(()=>{currentProofKey.current=proofKey;},[proofKey]);
  const [proof,setProof]=useState<{key:string;digest:string;feeds:string[]}|null>(null);
  const [proofIndex,setProofIndex]=useState(0),[proofImage,setProofImage]=useState('');
  useEffect(()=>{
    let active=true;setProofImage('');
    if(proof?.key===proofKey && format) renderZplToDataUrl(proof.feeds[proofIndex],format).then(url=>{if(active)setProofImage(url);}).catch(e=>{setErrorKind('other');setError(friendlyError(e));});
    return()=>{active=false;};
  },[proof,proofKey,proofIndex,format]);
  const preparationController=useRef<AbortController|null>(null);
  const [preparationProgress,setPreparationProgress]=useState<{completed:number;total:number}|null>(null);
  useEffect(()=>()=>{preparationController.current?.abort();},[proofKey]);
  const inFlight=useRef(false);
  const rangeEdited=useRef(false);
  const fromNumber=Number(from),toNumber=Number(to);
  const rangeValid=isValidOfficeRange(from,to,total);
  const prepareProof=async()=>{
    if(!run||!template||!format||inFlight.current||!rangeValid||!printAllowed)return;
    inFlight.current=true;setBusy(true);setError('');setProof(null);
    const key=proofKey;
    const controller=new AbortController();preparationController.current=controller;
    try{
      const feeds=await generateLabelsForRunWithImages(run,template,format,{from:fromNumber,to:toNumber}, {signal:controller.signal,onProgress:(completed,total)=>setPreparationProgress({completed,total})});
      if(!feeds.length)throw new Error('Choose a valid label range');
      const digests=feeds.map(z=>z.match(/\^FXLWBITMAP1:[a-f0-9]{64}:([a-f0-9]{64})\^FS/)?.[1]);
      const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(digests.join('\n')));
      const digest=Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
      if(!controller.signal.aborted && currentProofKey.current===key){setProof({key,digest,feeds});setProofIndex(0);}
    }catch(e){if(!controller.signal.aborted){setErrorKind('other');setError(friendlyRenderError(friendlyError(e,'Checking the labels failed.'),template.elements,format.labelsAcross||1));}}finally{preparationController.current=null;setPreparationProgress(null);inFlight.current=false;setBusy(false);}
  };
  const [showReprint,setShowReprint]=useState(false);
  const [reprintOf,setReprintOf]=useState('');
  const [review,setReview]=useState<Job|null>(null);const [reviewReason,setReviewReason]=useState('');const [checked,setChecked]=useState(false);
  // Persist a submission identity before network I/O. An uncertain response,
  // reload or double-click retries this identity, never manufactures new jobs.
  const storageKey=`lw:office-pending:${runId}`;
  useEffect(()=>{
    const saved=localStorage.getItem(storageKey);
    if(saved){try{const data=JSON.parse(saved);setPending({from:data.from,to:data.to});setFrom(String(data.from));setTo(String(data.to));setReprintOf(data.reprintOf || '');}catch{setErrorKind('other');setError('The saved request on this device could not be read. Check the queue below before starting over.');}}
  },[storageKey]);
  const refresh=useCallback(async()=>{
    const [stationData,jobData]=await Promise.all([api('/api/office/stations'),api('/api/office/jobs?runId='+encodeURIComponent(runId))]);
    setPrinters(stationData.printers);setCanPrint(stationData.canPrint);setRequests(jobData.requests);
    if(!rangeEdited.current && !localStorage.getItem(storageKey)){
      // Start after everything already sent or still on its way, so the
      // suggested range never repeats queued labels.
      // Everything sent or on its way: show the whole run (Start then reads
      // "Waiting for office printer…" or "All labels sent").
      const first=firstUnsentLabel(jobData.requests.flatMap((r:PrintRequest)=>r.jobs),total);
      setFrom(String(first ?? 1));setTo(String(total));
    }
    setSelected(value=>value || (stationData.printers[0]?`${stationData.printers[0].station_id}/${stationData.printers[0].id}`:''));
  },[runId,storageKey,total]);
  useEffect(()=>{
    let active=true;
    const update=()=>refresh().catch(err=>{if(active){setErrorKind('other');setError(officeMessage(err));}});
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
        // A new request always needs a check of exactly this range first.
        if(bitmap && proof?.key!==currentProofKey.current)return;
        if(!printAllowed)return;
        payload={runId,stationId:printer.station_id,printerId:printer.id,from:Number(from),to:Number(to),idempotencyKey:crypto.randomUUID(),...(reprintOf?{reprintOf}: {}),...(bitmap?{expectedBitmapDigest:proof?.digest}:{})};
        localStorage.setItem(storageKey,JSON.stringify(payload));setPending({from:payload.from,to:payload.to});
      }
      await api('/api/office/jobs',{method:'POST',body:JSON.stringify(payload)});
      localStorage.removeItem(storageKey);setPending(null);setNotice(`Sent labels ${payload.from}–${payload.to} to the office printer's queue. You can close this page.`);
      setReprintOf('');rangeEdited.current=false;await refresh();
    }catch(err){
      // A 4xx is a definite "no": nothing new was queued. Anything else
      // (offline, timeout, 5xx) might have arrived, so retry the same request.
      setErrorKind(err instanceof OfficeRequestError && err.status>=400 && err.status<500 ? 'rejected' : (isNetworkError(err) || (err instanceof OfficeRequestError && err.status>=500)) ? 'uncertain' : 'other');
      setError(officeMessage(err));
    }
    finally{inFlight.current=false;setBusy(false);}
  };
  const startOver=async()=>{
    if(errorKind!=='rejected'){
      const ok=await confirmDialog({title:'Start over?',body:'Check the queue below first — the office may already have this request. Starting over does not cancel anything already queued.',confirmLabel:'Start over'});
      if(!ok)return;
    }
    localStorage.removeItem(storageKey);setPending(null);setError('');
  };
  const act=async(action:()=>Promise<void>)=>{setBusy(true);setError('');try{await action();await refresh();}catch(err){setErrorKind('other');setError(officeMessage(err));}finally{setBusy(false);}};
  const allJobs=requests.flatMap(r=>r.jobs);
  const sent=allJobs.filter(j=>j.state==='sent_to_printer').reduce((sum,j)=>sum+j.count,0);
  const queued=allJobs.filter(j=>IN_PROGRESS.includes(j.state)).reduce((sum,j)=>sum+j.count,0);
  // Count delivered ranges once, even when a range has been reprinted.
  const ranges=allJobs.filter(j=>j.state==='sent_to_printer').sort((a,b)=>a.from-b.from);
  let delivered=0;let end=0;
  for(const job of ranges){delivered+=Math.max(0,job.to-Math.max(end,job.from-1));end=Math.max(end,job.to);}
  const pct=total?Math.min(100,Math.round(delivered/total*100)):0;
  const reprintRequests=requests.filter(r=>r.jobs.every(j=>!j.review && !['queued','claimed','submitted','needs_review'].includes(j.state)));
  // Queued work already covers (part of) this range: a second tap would only
  // be refused by the server, so wait instead.
  const waitingOnQueue=!pending && !reprintOf && rangeValid && rangeOverlapsQueued(allJobs,fromNumber,toNumber);
  const proofCurrent=!bitmap || proof?.key===proofKey;
  const sendCount=rangeValid?toNumber-fromNumber+1:0;
  const blockedByPrinter=!canPrint || !printer?.dispatch_enabled || !!printer?.needs_review;
  const disabled=busy || blockedByPrinter || !printAllowed || waitingOnQueue || (!pending && !rangeValid) || (!reprintOf && !pending && delivered >= total);
  const primaryLabel=busy
    ?(preparationProgress?'Checking labels…':'Sending to office printer…')
    :pending?'Check again'
    :waitingOnQueue?'Waiting for office printer…'
    :(!reprintOf && delivered>=total)?'All labels sent'
    :!proofCurrent?`Check labels & send to office printer`
    :reprintOf?`Reprint ${sendCount === 1 ? '1 label' : `${sendCount.toLocaleString()} labels`} on office printer`
    :`Send ${sendCount === 1 ? '1 label' : `${sendCount.toLocaleString()} labels`} to office printer`;
  const onPrimary=()=>{ if(!pending && !proofCurrent) void prepareProof(); else void submit(); };
  const connection=<div className="space-y-3">
    <label className="block text-xs text-zinc-400">Office printer<select className={inputClass+' mt-1'} value={selected} onChange={e=>setSelected(e.target.value)}>
      {!printers.length && <option value="">No office printer is set up for your account</option>}
      {printers.map(p=><option key={p.id} value={`${p.station_id}/${p.id}`}>{p.name}</option>)}
    </select></label>
    {printer && <div className="text-xs space-y-1 text-zinc-400">
      <p className={printer.online?'text-emerald-400':'text-amber-400'}>{printer.online?(printer.available?'Office printer connected':'Office connected, but the printer is not available'):'Office is offline — anything you send waits until it reconnects'}</p>
      {!printer.dispatch_enabled && <p className="text-amber-400">This office printer hasn&apos;t been switched on for printing yet, so sending is off.</p>}
      {printer.needs_review && <p className="text-red-400">Someone needs to check the printer before more labels can be sent.</p>}
      {printer.online && printer.dispatch_enabled && !printer.needs_review && printer.dispatch_hold_reason && holdReasons[printer.dispatch_hold_reason] && <p className="text-amber-400">{holdReasons[printer.dispatch_hold_reason]}</p>}
    </div>}
    <OfficePrinterControls />
    {printer && <details className="text-xs text-zinc-500"><summary className="cursor-pointer hover:text-zinc-300">Connection details</summary><p className="mt-2">Last contact: {printer.last_seen?new Date(printer.last_seen).toLocaleString():'not set up yet'} · {printer.dpi} DPI</p></details>}
  </div>;
  return <div className="space-y-4">
    {connectionTarget && createPortal(connection,connectionTarget)}
    <div className="flex items-center justify-between gap-2">
      <h2 className="text-xs text-zinc-500 font-semibold">Progress</h2>
      <span className="text-xs font-semibold text-zinc-100 tabular-nums">Sent to office printer: {delivered.toLocaleString()} of {total.toLocaleString()} · {pct}%</span>
    </div>
    <div className="h-3 rounded-full bg-zinc-900 overflow-hidden"><div className="h-full bg-amber-500 transition-colors" style={{width:`${pct}%`}} /></div>
    {pending && <div role="status" className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300 space-y-1">
      {errorKind==='rejected' && error
        ? <><p className="font-semibold">The office printer didn&apos;t accept labels {pending.from}–{pending.to}.</p><p>{error}</p><p>Nothing new was queued. Check the queue below, then start over.</p></>
        : <><p className="font-semibold">We&apos;re not sure the office got labels {pending.from}–{pending.to}.</p><p>Tap &ldquo;Check again&rdquo; — it won&apos;t print twice.</p></>}
      <button type="button" onClick={()=>void startOver()} disabled={busy} className={errorKind==='rejected'&&error?'mt-1 min-h-10 rounded-md bg-amber-500 px-3 text-xs font-semibold text-black hover:bg-amber-400 disabled:opacity-40':'text-amber-300 underline disabled:opacity-40'}>Start over{errorKind==='rejected'&&error?'':' (doesn’t cancel anything already queued)'}</button>
    </div>}
    <div className="grid grid-cols-3 gap-2">
      <label className="text-xs text-zinc-400">From label<input className={inputClass+' mt-1'} inputMode="numeric" disabled={!!pending || busy} value={from} onChange={e=>{rangeEdited.current=true;setFrom(e.target.value);}} /></label>
      <label className="text-xs text-zinc-400">Stop after label<input className={inputClass+' mt-1'} inputMode="numeric" disabled={!!pending || busy} value={to} onChange={e=>{rangeEdited.current=true;setTo(e.target.value);}} /></label>
      <label className="text-xs text-zinc-400">How many<input type="number" inputMode="numeric" min={1} max={Math.max(1,total-Number(from)+1)} disabled={!!pending || busy} className={inputClass+' mt-1'} value={Math.max(0,Number(to)-Number(from)+1)} onChange={e=>{rangeEdited.current=true;setTo(String(Math.min(total,Number(from)+Math.max(1,Number(e.target.value))-1)));}} /></label>
    </div>
    {!pending && !rangeValid && <p role="alert" className="text-xs text-amber-400">Enter label numbers from 1 to {total}, with &ldquo;Stop after&rdquo; at or after &ldquo;From&rdquo;.</p>}
    {reprintOf && <div className="space-y-2 rounded border border-amber-500/30 p-2 text-xs"><p>Reprint: these labels are printed again and recorded as a reprint in the history.</p><button type="button" className="min-h-9 rounded-md border border-zinc-700 px-3 text-zinc-200 hover:border-zinc-500" onClick={()=>{setReprintOf('');}}>Stop reprinting</button></div>}
    {!printAllowed && <p className="text-xs text-amber-400">Sending is off until every label has a value (see the list above).</p>}
    {waitingOnQueue && <p role="status" className="text-xs text-zinc-400">Some of these labels are already on their way to the office printer. When they&apos;re sent, use Reprint if you need them again.</p>}
    <button type="button" disabled={disabled} onClick={onPrimary} className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold bg-amber-500 text-black hover:bg-amber-400 disabled:opacity-40">{busy?<Loader2 className="w-4 h-4 animate-spin" />:<PrinterIcon className="w-4 h-4" />}{primaryLabel}</button>
    {error && !(pending && errorKind==='rejected') && <p role="alert" className="text-xs text-red-400">{error}</p>}
    {notice && <p role="status" className="text-xs text-emerald-400">{notice}</p>}
    {bitmap && !pending && <div className="space-y-2 rounded-lg border border-zinc-800 p-3 text-xs" aria-labelledby={`${uid}-check`}>
      <p id={`${uid}-check`} className="font-semibold text-zinc-300">Label check{rangeValid?` (${fromNumber}–${toNumber})`:''}</p>
      {preparationProgress && <div role="status" className="space-y-1">
        <p className="text-zinc-300">Checked {preparationProgress.completed.toLocaleString()} of {preparationProgress.total.toLocaleString()} labels…</p>
        <progress className="w-full" max={preparationProgress.total} value={preparationProgress.completed} aria-label="Checking labels" />
        <p className="text-zinc-500">Nothing has been sent to the printer yet.</p>
        <button type="button" onClick={()=>preparationController.current?.abort()} className="min-h-9 rounded-md border border-zinc-700 px-3 text-zinc-300">Stop checking</button>
      </div>}
      {!preparationProgress && proofCurrent && proof && <div className="space-y-2">
        <p className="flex items-center gap-1.5 text-emerald-400"><CheckCircle2 className="h-3.5 w-3.5" />{proof.feeds.length === 1 ? '1 label' : `${proof.feeds.length.toLocaleString()} labels`} checked — every label renders.</p>
        {proofImage ? <img src={proofImage} alt={`Checked label ${fromNumber+proofIndex}`} className="w-full bg-white" style={{imageRendering:'pixelated'}} /> : <p className="text-zinc-500 flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" />Drawing preview…</p>}
        <label className="flex items-center gap-2 text-zinc-400">Preview label #<input type="number" min={1} max={proof.feeds.length} value={proofIndex+1} onChange={e=>setProofIndex(Math.max(0,Math.min(proof.feeds.length-1,Number(e.target.value)-1)))} className={inputClass+' w-20'} /><span>of {proof.feeds.length}</span></label>
      </div>}
      {!preparationProgress && !proofCurrent && <p className="text-zinc-400">We draw every label first. If any label is missing a value or doesn&apos;t fit, nothing is sent.</p>}
    </div>}
    <p className="text-xs text-zinc-500">{queued>0?`${queued.toLocaleString()} label${queued===1?'':'s'} waiting to be sent. `:''}&ldquo;Sent&rdquo; means the office printer received them — it doesn&apos;t prove they came out.</p>
    <div className="pt-3 border-t border-zinc-800/60 space-y-2">
      <button type="button" disabled={busy || !!pending} onClick={()=>setShowReprint(value=>!value)} aria-expanded={showReprint} className="w-full flex min-h-10 items-center justify-center gap-1.5 px-3 rounded-md text-xs font-medium text-zinc-300 hover:text-amber-400 border border-zinc-800 disabled:opacity-40"><Hash className="w-3.5 h-3.5" />Reprint an earlier print…</button>
      <button type="button" disabled={busy || !!pending || !reprintRequests.length || allJobs.some(j=>j.review || ['queued','claimed','submitted','needs_review'].includes(j.state))} onClick={()=>{rangeEdited.current=true;setReprintOf(reprintRequests[0].id);setFrom('1');setTo(String(total));setShowReprint(false);}} className="w-full flex min-h-10 items-center justify-center gap-1.5 px-3 rounded-md text-xs font-medium text-zinc-300 hover:text-amber-400 border border-zinc-800 disabled:opacity-40"><RotateCcw className="w-3.5 h-3.5" />Reprint all</button>
      {showReprint && <label className="block text-xs text-zinc-400">Which print?
        <select className={inputClass+' mt-1'} value={reprintOf} onChange={e=>{const request=requests.find(r=>r.id===e.target.value);rangeEdited.current=true;setReprintOf(e.target.value);if(request){setFrom(String(request.range_from));setTo(String(request.range_to));}}}>
          <option value="">Choose a finished print</option>
          {reprintRequests.map(r=><option key={r.id} value={r.id}>Labels {r.range_from}–{r.range_to}{r.created_at?` · ${formatWhen(r.created_at)}`:''}{r.username?` · ${r.username}`:''}</option>)}
        </select>
        {!reprintRequests.length && <p className="mt-1">Nothing has finished printing yet. Check the queue below for work still on its way.</p>}
      </label>}
    </div>
    <details className="border-t border-zinc-800/60 pt-3">
      <summary className="cursor-pointer text-xs text-zinc-400">Queue details <span className="text-zinc-500">· {queued} waiting · {sent} sent</span></summary>
    <div className="max-h-96 overflow-y-auto space-y-3 mt-3">
      {requests.map(r=><div key={r.id} className="rounded border border-zinc-800 p-2 space-y-2 text-xs">
        <p className="font-medium">Labels {r.range_from}–{r.range_to} · {r.username}{r.reprint_of?' · reprint':''}</p>
        {r.created_at && <p className="text-zinc-500">{formatWhen(r.created_at)}</p>}
        <details><summary className="cursor-pointer text-zinc-400">{r.jobs.length} part{r.jobs.length===1?'':'s'} · {r.jobs.filter(j=>j.state==='sent_to_printer').length} sent</summary>
          {r.jobs.map(j=><div key={j.id} className="border-t border-zinc-800 py-2"><p>{j.from}–{j.to}: {j.review?'Check the printer before retrying':labels[j.state] ?? j.state}</p>{j.reason && <p className="text-zinc-500">{friendlyError(j.reason)}</p>}{j.cupsJobId && <p className="text-zinc-500">Office print job #{j.cupsJobId}</p>}
            {canPrint && (j.review || ['claimed','submitted','needs_review','rejected'].includes(j.state)) && <button type="button" disabled={busy} className="mt-1 text-amber-400 underline" onClick={()=>{setReview(j);setChecked(false);setReviewReason('');}}>Record what happened</button>}
          </div>)}
        </details>
        {canPrint && r.jobs.some(j=>j.state==='queued') && <button type="button" disabled={busy} className="text-amber-400 underline" onClick={()=>void act(async()=>{const result=await api('/api/office/jobs/'+r.id,{method:'DELETE'});setNotice(`Cancelled ${result.cancelled} part${result.cancelled===1?'':'s'} that hadn't been picked up. ${result.requires_review ? `${result.requires_review} part${result.requires_review===1?' was':'s were'} already picked up and need someone to check the printer; nothing was stopped at the office.` : ''}`.trim());})}>Cancel what hasn&apos;t been picked up</button>}
        {canPrint && r.jobs.every(j=>!j.review && !['queued','claimed','submitted','needs_review'].includes(j.state)) && <button type="button" className="ml-2 text-amber-400 underline" onClick={()=>{rangeEdited.current=true;setReprintOf(r.id);setFrom(String(r.range_from));setTo(String(r.range_to));}}>Reprint</button>}
      </div>)}
    </div>
    </details>
    <Dialog open={!!review} onClose={()=>setReview(null)} title={review?`What happened to labels ${review.from}–${review.to}?`:''} dismissible={!busy}>
      <p className="text-sm text-zinc-300">Check the printer and the office computer&apos;s print queue. Finish or cancel anything still waiting there first. Recording this can&apos;t stop the printer, and it doesn&apos;t reprint anything.</p>
      <label className="flex gap-2 text-sm text-zinc-200"><input type="checkbox" className="mt-1 accent-amber-500" checked={checked} onChange={e=>setChecked(e.target.checked)} />I checked the printer, and nothing still waiting at the office can print these labels later.</label>
      <label className="block text-sm text-zinc-300">What printed, what failed, and what you did
        <textarea className={inputClass+' mt-1 text-sm'} rows={3} value={reviewReason} onChange={e=>setReviewReason(e.target.value)} />
      </label>
      <div className="flex gap-2">
        <button type="button" disabled={busy || !checked || reviewReason.trim().length<3} className="min-h-10 rounded-lg bg-amber-500 px-4 text-sm font-semibold text-black disabled:opacity-40" onClick={()=>void act(async()=>{if(!review)return;await api('/api/office/review',{method:'POST',body:JSON.stringify({jobId:review.id,pendingCupsResolved:checked,reason:reviewReason})});setReview(null);setNotice('Saved. Nothing was reprinted.');})}>Save what happened</button>
        <button type="button" className="min-h-10 rounded-lg border border-zinc-800 px-4 text-sm text-zinc-300" onClick={()=>setReview(null)}>Cancel</button>
      </div>
    </Dialog>
  </div>;
}
