'use client';
import type { Run, LabelTemplate, LabelFormat } from '@/lib/types';
import { generateLabelsForRunWithImages } from '@/lib/runBuilder';
import { renderZplToDataUrl } from '@/lib/zplRenderClient';
import { OfficePrinterControls } from './OfficePrinterControls';
import { createPortal } from 'react-dom';
import { Printer as PrinterIcon, RotateCcw, CheckCircle2, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { CustomSelect } from '@/components/ui/CustomSelect';
import { confirmDialog } from '@/components/ui/feedback';
import { friendlyError, friendlyRenderError } from '@/lib/userMessages';
import { firstUnsentLabel, isValidOfficeRange, officePrintedThrough, officeProofKey, OFFICE_IN_PROGRESS as IN_PROGRESS, queuedBeyond, rangeOverlapsQueued } from '@/lib/officeRange';
import { keepPendingAfter, officeFailureKind, officePrinterReadiness, plainOfficeRefusal, readRefusal, type OfficeRefusalRecord } from '@/lib/officeSendOutcome';
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
  control_pending:'Waiting while a pause or resume reaches the printer.',
  printer_paused:'The printer is paused. Resume it to continue.',
  control_stale:'The office computer hasn’t reported in lately, so new labels wait until it does.',
};
const labels:Record<string,string>={queued:'Waiting to be sent',claimed:'Picked up by the office',submitted:'In the office print queue',sent_to_printer:'Sent to printer',rejected:'Not printed — see reason',needs_review:'Check the printer before retrying',cancelled:'Cancelled before sending',resolved:'Checked by someone at the office'};
const inputClass='field tabular-nums';
const plural=(n:number)=>n===1?'1 label':`${n.toLocaleString()} labels`;
/** Server wording -> plain words, without changing what the server checks. */
function officeMessage(error:unknown){
  if(error instanceof OfficeRequestError && error.status>=400 && error.status<500)return plainOfficeRefusal(error.message,error.status).message;
  return friendlyError(error,'The office printer request failed.')
    .replace('Prepare the proof again before printing.','Check the labels again before sending.')
    .replace('its bitmap proof is missing','the label check is missing');
}
function formatWhen(iso?:string){
  if(!iso)return '';
  try{return new Date(iso).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});}catch{return '';}
}
export function OfficePiPrinter({runId,total,connectionTarget,run,template,format,printAllowed=true,printedCount=0,onOfficeProgress}:{runId:string;total:number;connectionTarget:HTMLDivElement|null;run?:Run;template?:LabelTemplate;format?:LabelFormat;printAllowed?:boolean;
  /** Labels already counted as printed for this run (on any printer). */
  printedCount?:number;
  /** Called when office deliveries move the run's progress forward. */
  onOfficeProgress?:(through:number)=>void}){
  const uid=useId();
  const [printers,setPrinters]=useState<Printer[]>([]);const [selected,setSelected]=useState('');
  const [requests,setRequests]=useState<PrintRequest[]>([]);const [loaded,setLoaded]=useState(false);const [canPrint,setCanPrint]=useState(false);
  const [from,setFrom]=useState('1');const [to,setTo]=useState(String(total));
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');const [busy,setBusy]=useState(false);
  const [pending,setPending]=useState<{from:number;to:number}|null>(null);
  // A send the server definitely refused (4xx). Kept on this device so a
  // refresh still says what happened instead of "not sure it arrived".
  const [refusal,setRefusal]=useState<OfficeRefusalRecord|null>(null);
  const [chooseAgain,setChooseAgain]=useState(false);
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
    if(proof?.key===proofKey && format) renderZplToDataUrl(proof.feeds[proofIndex],format).then(url=>{if(active)setProofImage(url);}).catch(e=>{setError(friendlyError(e));});
    return()=>{active=false;};
  },[proof,proofKey,proofIndex,format]);
  const preparationController=useRef<AbortController|null>(null);
  const [preparationProgress,setPreparationProgress]=useState<{completed:number;total:number}|null>(null);
  useEffect(()=>()=>{preparationController.current?.abort();},[proofKey]);
  const inFlight=useRef(false);
  const rangeEdited=useRef(false);
  const fromNumber=Number(from),toNumber=Number(to);
  const rangeValid=isValidOfficeRange(from,to,total);
  const refusedKey=`lw:office-refused:${runId}`;
  const clearRefusal=useCallback(()=>{setRefusal(null);try{localStorage.removeItem(refusedKey);}catch{/* nothing saved */}},[refusedKey]);
  const prepareProof=async()=>{
    if(!run||!template||!format||inFlight.current||!rangeValid||!printAllowed)return;
    inFlight.current=true;setBusy(true);setError('');setProof(null);clearRefusal();
    const key=proofKey;
    const controller=new AbortController();preparationController.current=controller;
    try{
      const feeds=await generateLabelsForRunWithImages(run,template,format,{from:fromNumber,to:toNumber}, {signal:controller.signal,onProgress:(completed,total)=>setPreparationProgress({completed,total})});
      if(!feeds.length)throw new Error('Choose a valid label range');
      const digests=feeds.map(z=>z.match(/\^FXLWBITMAP1:[a-f0-9]{64}:([a-f0-9]{64})\^FS/)?.[1]);
      const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(digests.join('\n')));
      const digest=Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
      if(!controller.signal.aborted && currentProofKey.current===key){setProof({key,digest,feeds});setProofIndex(0);}
    }catch(e){if(!controller.signal.aborted){setError(friendlyRenderError(friendlyError(e,'Checking the labels failed.'),template.elements,format.labelsAcross||1));}}finally{preparationController.current=null;setPreparationProgress(null);inFlight.current=false;setBusy(false);}
  };
  const [showReprint,setShowReprint]=useState(false);
  const [reprintOf,setReprintOf]=useState('');
  const [review,setReview]=useState<Job|null>(null);const [reviewReason,setReviewReason]=useState('');const [checked,setChecked]=useState(false);
  // Persist a submission identity before network I/O. An uncertain response,
  // reload or double-click retries this identity, never manufactures new jobs.
  const storageKey=`lw:office-pending:${runId}`;
  useEffect(()=>{
    const saved=localStorage.getItem(storageKey);
    if(saved){try{const data=JSON.parse(saved);setPending({from:data.from,to:data.to});setFrom(String(data.from));setTo(String(data.to));setReprintOf(data.reprintOf || '');}catch{setError('The saved request on this device couldn’t be read. Check the office queue below before starting over.');}}
    else{let saved:string|null=null;try{saved=localStorage.getItem(refusedKey);}catch{saved=null;}setRefusal(readRefusal(saved));}
  },[storageKey,refusedKey]);
  const refresh=useCallback(async()=>{
    const [stationData,jobData]=await Promise.all([api('/api/office/stations'),api('/api/office/jobs?runId='+encodeURIComponent(runId))]);
    setPrinters(stationData.printers);setCanPrint(stationData.canPrint);setRequests(jobData.requests);setLoaded(true);
    setSelected(value=>value || (stationData.printers[0]?`${stationData.printers[0].station_id}/${stationData.printers[0].id}`:''));
  },[runId]);
  useEffect(()=>{
    let active=true;
    const update=()=>refresh().catch(err=>{if(active){setError(officeMessage(err));}});
    void update();const timer=setInterval(()=>void update(),5000);
    return()=>{active=false;clearInterval(timer);};
  },[refresh]);
  const allJobs=useMemo(()=>requests.flatMap(r=>r.jobs),[requests]);
  // One progress for the run across every printer: labels counted as printed
  // plus contiguous ranges the office reported sent to the printer.
  const doneThrough=officePrintedThrough(printedCount,allJobs,total);
  const moreOnTheWay=queuedBeyond(allJobs,doneThrough);
  const done=total>0 && doneThrough>=total;
  // Record office progress on the run (the server keeps the highest count),
  // so the header, the Runs list and this panel agree.
  const recorded=useRef(0);
  useEffect(()=>{
    if(!loaded || doneThrough<=printedCount || recorded.current>=doneThrough)return;
    recorded.current=doneThrough;onOfficeProgress?.(doneThrough);
  },[loaded,doneThrough,printedCount,onOfficeProgress]);
  // Suggest the next labels to send: after everything printed anywhere and
  // everything already on its way. Updates after each send and as the office
  // reports progress, unless the person typed their own range.
  useEffect(()=>{
    if(!loaded || rangeEdited.current || pending)return;
    const first=firstUnsentLabel(allJobs,total,doneThrough);
    setFrom(String(first ?? 1));setTo(String(total));
  },[loaded,allJobs,total,doneThrough,pending]);
  const printer=printers.find(p=>`${p.station_id}/${p.id}`===selected);
  const readiness=officePrinterReadiness(printer,refusal?.reason ?? null);
  const submit=async()=>{
    if(inFlight.current || !printer)return;inFlight.current=true;setBusy(true);setError('');setNotice('');
    try{
      let payload;
      const saved=localStorage.getItem(storageKey);
      if(saved){
        try{payload=JSON.parse(saved);}catch{setError('The saved request on this device couldn’t be read. Check the office queue below before starting over.');return;}
      }else{
        // A new request always needs a check of exactly this range first.
        if(bitmap && proof?.key!==currentProofKey.current)return;
        if(!printAllowed)return;
        payload={runId,stationId:printer.station_id,printerId:printer.id,from:Number(from),to:Number(to),idempotencyKey:crypto.randomUUID(),...(reprintOf?{reprintOf}: {}),...(bitmap?{expectedBitmapDigest:proof?.digest}:{})};
        localStorage.setItem(storageKey,JSON.stringify(payload));setPending({from:payload.from,to:payload.to});
      }
      clearRefusal();
      try{
        await api('/api/office/jobs',{method:'POST',body:JSON.stringify(payload)});
        localStorage.removeItem(storageKey);setPending(null);setNotice(`Queued labels ${payload.from}–${payload.to} for the office printer. You can close this page.`);
        setReprintOf('');setChooseAgain(false);setShowReprint(false);rangeEdited.current=false;
      }catch(err){
        // A 4xx is a definite "no": nothing new was queued, so the saved
        // request is cleared and never offered for resend. Anything else
        // (offline, timeout, 5xx) might have arrived, so the same request is
        // kept and "Send again" reuses its idempotency key.
        const status=err instanceof OfficeRequestError?err.status:undefined;
        if(!keepPendingAfter(officeFailureKind(status))){
          localStorage.removeItem(storageKey);setPending(null);
          const plain=plainOfficeRefusal(err instanceof Error?err.message:'',status);
          const record:OfficeRefusalRecord={from:payload.from,to:payload.to,reason:plain.reason,message:plain.message,at:new Date().toISOString()};
          try{localStorage.setItem(refusedKey,JSON.stringify(record));}catch{/* shown on this page anyway */}
          setRefusal(record);
          if(plain.reason==='labels-changed')setProof(null);
        }else setError(officeMessage(err));
      }
      await refresh().catch(()=>{});
    }
    finally{inFlight.current=false;setBusy(false);}
  };
  const startOver=async()=>{
    const ok=await confirmDialog({title:'Start over?',body:'Check the office queue below first — the office may already have this request. Starting over doesn’t cancel anything already queued.',confirmLabel:'Start over'});
    if(!ok)return;
    localStorage.removeItem(storageKey);setPending(null);setError('');
  };
  const act=async(action:()=>Promise<void>)=>{setBusy(true);setError('');try{await action();await refresh();}catch(err){setError(officeMessage(err));}finally{setBusy(false);}};
  const sent=allJobs.filter(j=>j.state==='sent_to_printer').reduce((sum,j)=>sum+j.count,0);
  const queued=allJobs.filter(j=>IN_PROGRESS.includes(j.state)).reduce((sum,j)=>sum+j.count,0);
  const reprintRequests=requests.filter(r=>r.jobs.every(j=>!j.review && !['queued','claimed','submitted','needs_review'].includes(j.state)));
  const workOnItsWay=allJobs.some(j=>j.review || ['queued','claimed','submitted','needs_review'].includes(j.state));
  // Queued work already covers (part of) this range: a second tap would only
  // be refused by the server, so wait instead.
  const waitingOnQueue=!pending && !reprintOf && rangeValid && rangeOverlapsQueued(allJobs,fromNumber,toNumber);
  const proofCurrent=!bitmap || proof?.key===proofKey;
  const sendCount=rangeValid?toNumber-fromNumber+1:0;
  const blockedByPrinter=!canPrint || !readiness.canSend;
  // A finished run shows a finished state; sending again is a deliberate choice.
  const showDone=done && !reprintOf && !pending && !chooseAgain;
  const allQueued=!pending && !reprintOf && !chooseAgain && firstUnsentLabel(allJobs,total,doneThrough)===null && !done;
  const disabled=busy || blockedByPrinter || !printAllowed || waitingOnQueue || (!pending && !rangeValid);
  const primaryLabel=busy
    ?(preparationProgress?'Checking labels…':'Sending to office printer…')
    :pending?'Send again'
    :refusal?'Try again'
    :waitingOnQueue?'Waiting for office printer…'
    :!proofCurrent?`Check labels & send to office printer`
    :reprintOf?`Reprint ${plural(sendCount)} on office printer`
    :`Send ${plural(sendCount)} to office printer`;
  const onPrimary=()=>{
    if(refusal){const again=refusal.reason==='labels-changed';clearRefusal();if(again||!proofCurrent){void prepareProof();return;}}
    if(!pending && !proofCurrent) void prepareProof(); else void submit();
  };
  const alreadyPrinted=!pending && !reprintOf && rangeValid && fromNumber<=doneThrough;
  const statusTone=readiness.tone==='ok'?'text-emerald-400':readiness.tone==='bad'?'text-red-400':'text-amber-300';
  const connection=<div className="space-y-3">
    {printers.length>1
      ? <div className="space-y-1"><span id={`${uid}-printer`} className="field-label">Office printer</span><CustomSelect aria-labelledby={`${uid}-printer`} value={selected} onChange={setSelected} options={printers.map(p=>({value:`${p.station_id}/${p.id}`,label:p.name}))} /></div>
      : <p className="text-sm text-zinc-300">{printer?printer.name:loaded?'No office printer is set up for your account.':'Looking for the office printer…'}</p>}
    {printer && <div className="space-y-1 text-sm">
      <p className={`flex items-center gap-2 ${statusTone}`}><span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${readiness.tone==='ok'?'bg-emerald-400':readiness.tone==='bad'?'bg-red-400':'bg-amber-300'}`} />{readiness.text}</p>
      {readiness.tone==='ok' && printer.dispatch_hold_reason && holdReasons[printer.dispatch_hold_reason] && <p className="text-amber-300">{holdReasons[printer.dispatch_hold_reason]}</p>}
    </div>}
    {printer && <OfficePrinterControls />}
    {printer && <details className="text-sm text-zinc-400"><summary className="flex min-h-control cursor-pointer items-center hover:text-zinc-200">Connection details</summary><p className="pb-2">Last contact: {printer.last_seen?new Date(printer.last_seen).toLocaleString():'not set up yet'} · {printer.dpi} DPI</p></details>}
  </div>;
  return <div className="space-y-4">
    {connectionTarget && createPortal(connection,connectionTarget)}
    {moreOnTheWay>0 && <p role="status" className="text-sm text-zinc-400 tabular-nums">{plural(moreOnTheWay)} more on the way to the office printer</p>}
    {pending && <div role="status" className="space-y-2 rounded-lg bg-amber-500/10 p-3 text-sm text-amber-300">
      <p className="font-medium">We&apos;re not sure the office got labels {pending.from}–{pending.to}.</p>
      <p>Tap &ldquo;Send again&rdquo;. It&apos;s the same request, so it won&apos;t print twice.</p>
      <button type="button" onClick={()=>void startOver()} disabled={busy} className="btn btn-ghost btn-sm -ml-2 text-amber-300">Start over</button>
    </div>}
    {refusal && !pending && <div role="alert" className="space-y-1 rounded-lg bg-amber-500/10 p-3 text-sm text-amber-300">
      <p className="font-medium">Labels {refusal.from}–{refusal.to} weren&apos;t sent.</p>
      <p>{refusal.message}</p>
    </div>}
    {showDone ? <div className="space-y-3">
      <p role="status" className="flex min-h-control items-center gap-2 text-sm font-medium text-emerald-400"><CheckCircle2 className="h-4 w-4 rounded-full animate-success" aria-hidden="true" />All {total.toLocaleString()} labels printed</p>
      <button type="button" disabled={busy || workOnItsWay} onClick={()=>{rangeEdited.current=true;setChooseAgain(true);setFrom('1');setTo(String(total));setNotice('');}} className="btn btn-secondary btn-sm w-full"><RotateCcw className="h-4 w-4" aria-hidden="true" />Print some labels again…</button>
    </div> : allQueued ? <p role="status" className="flex min-h-control items-center gap-2 text-sm text-zinc-300"><Loader2 className="h-4 w-4 animate-spin text-amber-400" aria-hidden="true" />Every label is on its way to the office printer.</p> : <>
    {chooseAgain && !reprintOf && <div className="flex items-center justify-between gap-2 text-sm text-zinc-300"><span>Choose which labels to print again.</span><button type="button" className="btn btn-ghost btn-sm" onClick={()=>{setChooseAgain(false);rangeEdited.current=false;}}>Cancel</button></div>}
    <div className="grid grid-cols-3 gap-2">
      <label className="text-xs font-medium text-zinc-400">From label<input className={inputClass+' mt-1'} inputMode="numeric" disabled={!!pending || busy} value={from} onChange={e=>{rangeEdited.current=true;setFrom(e.target.value);}} /></label>
      <label className="text-xs font-medium text-zinc-400">Stop after label<input className={inputClass+' mt-1'} inputMode="numeric" disabled={!!pending || busy} value={to} onChange={e=>{rangeEdited.current=true;setTo(e.target.value);}} /></label>
      <label className="text-xs font-medium text-zinc-400">How many<input type="number" inputMode="numeric" min={1} max={Math.max(1,total-Number(from)+1)} disabled={!!pending || busy} className={inputClass+' mt-1'} value={Math.max(0,Number(to)-Number(from)+1)} onChange={e=>{rangeEdited.current=true;setTo(String(Math.min(total,Number(from)+Math.max(1,Number(e.target.value))-1)));}} /></label>
    </div>
    {!pending && !rangeValid && <p role="alert" className="text-sm text-amber-300">Enter label numbers from 1 to {total}, with &ldquo;Stop after&rdquo; at or after &ldquo;From&rdquo;.</p>}
    {alreadyPrinted && !chooseAgain && <div className="space-y-1 text-sm text-amber-300"><p>Labels {fromNumber}–{Math.min(toNumber,doneThrough)} are already printed.</p>{doneThrough<toNumber && <button type="button" className="btn btn-ghost btn-sm -ml-2 text-amber-300" onClick={()=>{rangeEdited.current=true;setFrom(String(doneThrough+1));}}>Send {doneThrough+1}–{toNumber} instead</button>}</div>}
    {reprintOf && <div className="space-y-1 text-sm text-amber-300"><p>Reprint: these labels print again and are logged as a reprint.</p><button type="button" className="btn btn-ghost btn-sm -ml-2 text-amber-300" onClick={()=>{setReprintOf('');rangeEdited.current=false;}}>Stop reprinting</button></div>}
    {!printAllowed && <p className="text-sm text-amber-300">Sending is off until every label has a value (see the list above).</p>}
    {waitingOnQueue && <p role="status" className="text-sm text-zinc-400">Some of these labels are already on their way. Once they&apos;re sent, use Reprint if you need them again.</p>}
    <button type="button" disabled={disabled} onClick={onPrimary} className="btn btn-primary w-full">{busy?<Loader2 className="w-4 h-4 animate-spin" />:<PrinterIcon className="w-4 h-4" />}{primaryLabel}</button>
    {blockedByPrinter && !busy && printer && <p className="text-sm text-zinc-400">{!canPrint?'Your account can’t send labels to the office printer.':readiness.text}</p>}
    </>}
    {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
    {notice && <p role="status" className="text-sm text-emerald-400 animate-enter">{notice}</p>}
    {bitmap && !pending && !showDone && !allQueued && (preparationProgress || (proofCurrent && proof) ) && <div className="space-y-2 text-sm" aria-labelledby={`${uid}-check`}>
      <p id={`${uid}-check`} className="sr-only">Label check{rangeValid?` (${fromNumber}–${toNumber})`:''}</p>
      {preparationProgress && <div role="status" className="space-y-2">
        <p className="text-zinc-300 tabular-nums">Checked {preparationProgress.completed.toLocaleString()} of {preparationProgress.total.toLocaleString()} labels… nothing is sent yet.</p>
        <progress className="w-full accent-amber-500" max={preparationProgress.total} value={preparationProgress.completed} aria-label="Checking labels" />
        <button type="button" onClick={()=>preparationController.current?.abort()} className="btn btn-secondary btn-sm">Stop checking</button>
      </div>}
      {!preparationProgress && proofCurrent && proof && <div className="space-y-2">
        <p className="flex items-center gap-1.5 text-emerald-400"><CheckCircle2 className="h-4 w-4 rounded-full animate-success" aria-hidden="true" />{plural(proof.feeds.length)} checked</p>
        {proofImage ? <img src={proofImage} alt={`Checked label ${fromNumber+proofIndex}`} className="w-full rounded bg-white" style={{imageRendering:'pixelated'}} /> : <p className="text-zinc-400 flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />Drawing preview…</p>}
        {proof.feeds.length>1 && <label className="flex items-center gap-2 text-zinc-400">Preview label<input type="number" min={1} max={proof.feeds.length} value={proofIndex+1} onChange={e=>setProofIndex(Math.max(0,Math.min(proof.feeds.length-1,Number(e.target.value)-1)))} className={inputClass+' field-sm w-20'} /><span className="tabular-nums">of {proof.feeds.length}</span></label>}
      </div>}
    </div>}
    {bitmap && !pending && !showDone && !allQueued && !preparationProgress && !proofCurrent && !refusal && <p className="text-sm text-zinc-400">Every label is drawn first. If one is missing a value or doesn&apos;t fit, nothing is sent.</p>}
    {(reprintRequests.length>0 || showReprint) && <div className="space-y-2">
      <button type="button" disabled={busy || !!pending} onClick={()=>setShowReprint(value=>!value)} aria-expanded={showReprint} className="btn btn-ghost btn-sm w-full text-zinc-300"><RotateCcw className="w-4 h-4" aria-hidden="true" />Reprint an earlier office print…</button>
      {showReprint && <div className="space-y-2">
        <span id={`${uid}-reprint`} className="field-label">Which print?</span>
        <CustomSelect aria-labelledby={`${uid}-reprint`} value={reprintOf} placeholder="Choose a finished print" onChange={value=>{const request=requests.find(r=>r.id===value);rangeEdited.current=true;setReprintOf(value);setChooseAgain(false);if(request){setFrom(String(request.range_from));setTo(String(request.range_to));}}}
          options={reprintRequests.map(r=>({value:r.id,label:`Labels ${r.range_from}–${r.range_to}`,sublabel:[formatWhen(r.created_at),r.username].filter(Boolean).join(' · ')}))} />
        <button type="button" disabled={busy || !reprintRequests.length || workOnItsWay} onClick={()=>{rangeEdited.current=true;setReprintOf(reprintRequests[0].id);setFrom('1');setTo(String(total));setShowReprint(false);setChooseAgain(false);}} className="btn btn-ghost btn-sm">Reprint all {total.toLocaleString()}</button>
      </div>}
    </div>}
    {requests.length>0 && <details>
      <summary className="flex min-h-control cursor-pointer items-center gap-1 text-sm text-zinc-400 hover:text-zinc-200">Office queue <span className="tabular-nums">· {queued.toLocaleString()} on the way · {sent.toLocaleString()} sent</span></summary>
      <ul className="max-h-96 overflow-y-auto space-y-4 pt-2 text-sm">
        {requests.map(r=><li key={r.id} className="space-y-1">
          <p className="font-medium text-zinc-200">Labels {r.range_from}–{r.range_to}{r.reprint_of?' · reprint':''}</p>
          <p className="text-zinc-400">{[formatWhen(r.created_at),r.username].filter(Boolean).join(' · ')}</p>
          <ul className="space-y-1">{r.jobs.map(j=><li key={j.id} className="text-zinc-300"><span className="tabular-nums">{j.from}–{j.to}</span>: {j.review?'Check the printer before retrying':labels[j.state] ?? j.state}{j.reason && <span className="block text-zinc-400">{friendlyError(j.reason)}</span>}
            {canPrint && (j.review || ['claimed','submitted','needs_review','rejected'].includes(j.state)) && <button type="button" disabled={busy} className="btn btn-ghost btn-sm -ml-2 block text-amber-300" onClick={()=>{setReview(j);setChecked(false);setReviewReason('');}}>Record what happened</button>}
          </li>)}</ul>
          <div className="flex flex-wrap gap-1 -ml-2">
            {canPrint && r.jobs.some(j=>j.state==='queued') && <button type="button" disabled={busy} className="btn btn-ghost btn-sm text-amber-300" onClick={()=>void act(async()=>{const result=await api('/api/office/jobs/'+r.id,{method:'DELETE'});setNotice(`Cancelled ${result.cancelled} part${result.cancelled===1?'':'s'} that hadn't been picked up. ${result.requires_review ? `${result.requires_review} part${result.requires_review===1?' was':'s were'} already picked up and need someone to check the printer; nothing was stopped at the office.` : ''}`.trim());})}>Cancel what hasn&apos;t been picked up</button>}
            {canPrint && r.jobs.every(j=>!j.review && !['queued','claimed','submitted','needs_review'].includes(j.state)) && <button type="button" className="btn btn-ghost btn-sm text-amber-300" onClick={()=>{rangeEdited.current=true;setReprintOf(r.id);setChooseAgain(false);setFrom(String(r.range_from));setTo(String(r.range_to));}}>Reprint</button>}
          </div>
        </li>)}
      </ul>
    </details>}
    <Dialog open={!!review} onClose={()=>setReview(null)} title={review?`What happened to labels ${review.from}–${review.to}?`:''} dismissible={!busy}>
      <p className="text-sm text-zinc-300">Check the printer and the office computer&apos;s print queue. Finish or cancel anything still waiting there first. Recording this can&apos;t stop the printer, and it doesn&apos;t reprint anything.</p>
      <label className="flex gap-2 text-sm text-zinc-200"><input type="checkbox" className="mt-1 accent-amber-500" checked={checked} onChange={e=>setChecked(e.target.checked)} />I checked the printer, and nothing still waiting at the office can print these labels later.</label>
      <label className="block text-sm text-zinc-300">What printed, what failed, and what you did
        <textarea className={inputClass+' mt-1 text-sm'} rows={3} value={reviewReason} onChange={e=>setReviewReason(e.target.value)} />
      </label>
      <div className="flex gap-2">
        <button type="button" disabled={busy || !checked || reviewReason.trim().length<3} className="btn btn-primary" onClick={()=>void act(async()=>{if(!review)return;await api('/api/office/review',{method:'POST',body:JSON.stringify({jobId:review.id,pendingCupsResolved:checked,reason:reviewReason})});setReview(null);setNotice('Saved. Nothing was reprinted.');})}>Save what happened</button>
        <button type="button" className="btn btn-secondary" onClick={()=>setReview(null)}>Cancel</button>
      </div>
    </Dialog>
  </div>;
}
