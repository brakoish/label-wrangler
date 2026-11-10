'use client';
import type { Run, LabelTemplate, LabelFormat, RunStatus } from '@/lib/types';
import { generateLabelsForRunWithImages } from '@/lib/runBuilder';
import { renderZplToDataUrl } from '@/lib/zplRenderClient';
import { OfficePrinterControls } from './OfficePrinterControls';
import { createPortal } from 'react-dom';
import { Printer as PrinterIcon, RotateCcw, CheckCircle2, Loader2, AlertCircle } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { CustomSelect } from '@/components/ui/CustomSelect';
import { Fold, FoldToggle } from '@/components/ui/Fold';
import { confirmDialog } from '@/components/ui/feedback';
import { friendlyError, friendlyRenderError } from '@/lib/userMessages';
import { capAfterSizeError, firstUnsentLabel, isValidOfficeRange, officeProofKey, officeSendCap, officeSendPlan, OFFICE_BITMAP_LABELS_PER_SEND, OFFICE_MAX_LABELS, suggestOfficeRange, type OfficeDeliverySummary, type OfficeFailedPart, type OfficeSendPlan } from '@/lib/officeRange';
import { keepPendingAfter, officeFailureKind, officePrinterReadiness, plainJobReason, plainOfficeRefusal, readRefusal, refusalStillApplies, uncertainSendWords, type OfficeRefusalRecord } from '@/lib/officeSendOutcome';
import type { OfficeJob, OfficeRequest } from './useOfficeRequests';
interface Printer { station_id:string; id:string; name:string; dpi:number; max_width_dots:number; last_seen:string|null; online:boolean; available:boolean; dispatch_enabled:boolean; paired_at:string|null; needs_review:boolean; dispatch_hold_reason?:string|null }
/** HTTP error that remembers its status, so a definite refusal reads differently from "not sure it arrived". */
class OfficeRequestError extends Error { constructor(message:string, public status:number, public code?:string){ super(message); } }
async function api(path:string,init?:RequestInit){
  const response=await fetch(path,{...init,headers:{'Content-Type':'application/json',...init?.headers},cache:'no-store'});
  const result=await response.json().catch(()=>({}));if(!response.ok)throw new OfficeRequestError(result.error || 'Request failed',response.status,typeof result.code==='string'?result.code:undefined);return result;
}
const holdReasons:Record<string,string>={
  control_pending:'Waiting while a pause or resume reaches the printer.',
  printer_paused:'The printer is paused. Resume it to continue.',
  control_stale:'The office computer hasn’t reported in lately, so new labels wait until it does.',
};
const labels:Record<string,string>={queued:'Waiting to be sent',claimed:'Picked up by the office',submitted:'In the office print queue',sent_to_printer:'Sent to the printer',rejected:'Didn’t print',needs_review:'Check the printer before retrying',cancelled:'Cancelled before sending',resolved:'Checked by someone at the office'};
const inputClass='field tabular-nums';
const plural=(n:number)=>n===1?'1 label':`${n.toLocaleString()} labels`;
const range=(a:number,b:number)=>a===b?`label ${a}`:`labels ${a}–${b}`;
const Range=(a:number,b:number)=>a===b?`Label ${a}`:`Labels ${a}–${b}`;
const capitalise=(text:string)=>text.charAt(0).toUpperCase()+text.slice(1);
/** Server wording -> plain words, without changing what the server checks. */
function officeMessage(error:unknown,fallback='The office printer didn’t answer. Try again in a moment.'){
  if(error instanceof OfficeRequestError){
    if(officeFailureKind(error.status)==='refused')return plainOfficeRefusal(error.message,error.status).message;
    if(error.status===401)return 'You’re signed out. Sign in again to see the office printer.';
    if(error.status===403)return 'Your account can’t see the office printer. Ask your admin for access.';
    return fallback;
  }
  return friendlyError(error,fallback);
}
function formatWhen(iso?:string){
  if(!iso)return '';
  try{return new Date(iso).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});}catch{return '';}
}
function lastSeen(iso:string|null){
  if(!iso)return 'Not set up yet';
  const seconds=Math.max(0,Math.round((Date.now()-Date.parse(iso))/1000));
  if(!Number.isFinite(seconds))return 'Not set up yet';
  if(seconds<60)return 'Last seen just now';
  const minutes=Math.round(seconds/60);if(minutes<60)return `Last seen ${minutes} minute${minutes===1?'':'s'} ago`;
  const hours=Math.round(minutes/60);if(hours<48)return `Last seen ${hours} hour${hours===1?'':'s'} ago`;
  return `Last seen ${formatWhen(iso)}`;
}
type Pending={from:number;to:number;reprintOf?:string;status?:number;code?:string};
export function OfficePiPrinter({runId,total,connectionTarget,run,template,format,printAllowed=true,printedCount=0,runStatus,requests,summary,requestsLoaded,requestsError,refreshRequests,layoutWarnings=[]}:{runId:string;total:number;connectionTarget:HTMLDivElement|null;run?:Run;template?:LabelTemplate;format?:LabelFormat;printAllowed?:boolean;
  /** Labels already counted as printed for this run (on any printer). Office sends never change it. */
  printedCount?:number;
  runStatus?:RunStatus;
  /** The run's office requests, read by the run page (shared with its header). */
  requests:OfficeRequest[];
  summary:OfficeDeliverySummary;
  requestsLoaded:boolean;
  requestsError?:{status:number;message:string}|null;
  refreshRequests:()=>Promise<void>;
  /** Items that cover each other or run off the label: asked about before sending. */
  layoutWarnings?:string[]}){
  const uid=useId();
  const [printers,setPrinters]=useState<Printer[]>([]);const [selected,setSelected]=useState('');
  const [stationsLoaded,setStationsLoaded]=useState(false);const [canPrint,setCanPrint]=useState(false);
  const [from,setFrom]=useState('1');const [to,setTo]=useState(String(total));
  const [error,setError]=useState('');
  const [notice,setNotice]=useState<{text:string;requestId?:string;at:number}|null>(null);
  const [busy,setBusy]=useState(false);
  const [pending,setPending]=useState<Pending|null>(null);
  // A send the server definitely refused. Kept on this device so a refresh
  // still says what happened, until live status says otherwise.
  const [refusal,setRefusal]=useState<OfficeRefusalRecord|null>(null);
  const [chooseAgain,setChooseAgain]=useState(false);
  const [sentThisVisit,setSentThisVisit]=useState(false);
  const stationErrorRef=useRef('');
  const bitmap = template?.thermalRenderMode === 'bitmap-v1';
  const across = Math.max(1, format?.labelsAcross || 1);
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
  /** The range someone just checked in the "Print again" dialog: that dialog was the ask. */
  const fixedRange=useRef('');
  const fromNumber=Number(from),toNumber=Number(to);
  const rangeValid=isValidOfficeRange(from,to,total);
  const refusedKey=`lw:office-refused:${runId}`;
  const clearRefusal=useCallback(()=>{setRefusal(null);try{localStorage.removeItem(refusedKey);}catch{/* nothing saved */}},[refusedKey]);
  const jobs=useMemo(()=>requests.flatMap(r=>r.jobs.map(j=>({...j,requestId:r.id}))),[requests]);

  // --- How many labels one send may hold -------------------------------------
  // The server refuses more than 10,000 labels or 32 MiB of printer data in
  // one send, and stops drawing bitmap labels after a few minutes. A few
  // sample labels give the size per label before any long check starts.
  const defaultCap=bitmap?OFFICE_BITMAP_LABELS_PER_SEND:OFFICE_MAX_LABELS;
  const [sizeCap,setSizeCap]=useState<{key:string;cap:number}|null>(null);
  const designKey=useMemo(()=>officeProofKey(run,template,format,'',''),[run,template,format]);
  const cap=Math.max(1,sizeCap?.key===designKey?sizeCap.cap:defaultCap);
  useEffect(()=>{
    if(!run||!template||!format||total<=0)return;
    let active=true;const controller=new AbortController();
    const sampleTo=Math.min(total,Math.max(8,across*2));
    generateLabelsForRunWithImages(run,template,format,{from:1,to:sampleTo},{signal:controller.signal})
      .then(feeds=>{if(active&&feeds.length){const estimate=officeSendCap(feeds.map(f=>new TextEncoder().encode(f).length),across,bitmap);setSizeCap(current=>({key:designKey,cap:Math.min(current?.key===designKey?current.cap:Infinity,estimate)}));}})
      .catch(()=>{/* the full check reports any problem */});
    return()=>{active=false;controller.abort();};
  },[run,template,format,total,across,bitmap,designKey]);

  const prepareProof=async()=>{
    if(!run||!template||!format||inFlight.current||!rangeValid||!printAllowed)return;
    inFlight.current=true;setBusy(true);setError('');setProof(null);clearRefusal();setNotice(null);
    const key=proofKey;const start=fromNumber;
    const controller=new AbortController();preparationController.current=controller;
    try{
      const feeds=await generateLabelsForRunWithImages(run,template,format,{from:fromNumber,to:toNumber}, {signal:controller.signal,onProgress:(completed,total)=>setPreparationProgress({completed,total})});
      if(!feeds.length)throw new Error('Choose a valid label range');
      const digests=feeds.map(z=>z.match(/\^FXLWBITMAP1:[a-f0-9]{64}:([a-f0-9]{64})\^FS/)?.[1]);
      const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(digests.join('\n')));
      const digest=Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
      if(!controller.signal.aborted && currentProofKey.current===key){setProof({key,digest,feeds});setProofIndex(0);}
    }catch(e){if(!controller.signal.aborted){
      // Too much printer data for one send: shrink the suggested size and
      // say so in plain words, instead of showing the size error.
      const smaller=capAfterSizeError(e instanceof Error?e.message:'',start);
      if(smaller)setSizeCap({key:designKey,cap:Math.min(cap,smaller)});
      else setError(friendlyRenderError(friendlyError(e,'Checking the labels failed.'),template.elements,format.labelsAcross||1));
    }}finally{preparationController.current=null;setPreparationProgress(null);inFlight.current=false;setBusy(false);}
  };
  const [reprintOf,setReprintOf]=useState('');
  const [review,setReview]=useState<OfficeJob|null>(null);const [reviewReason,setReviewReason]=useState('');const [checked,setChecked]=useState(false);
  const [fixPart,setFixPart]=useState<OfficeFailedPart|null>(null);
  const [queueOpen,setQueueOpen]=useState(false);const [detailsOpen,setDetailsOpen]=useState(false);
  // Persist a submission identity before network I/O. An uncertain response,
  // reload or double-click retries this identity, never manufactures new jobs.
  const storageKey=`lw:office-pending:${runId}`;
  useEffect(()=>{
    const saved=localStorage.getItem(storageKey);
    if(saved){try{const data=JSON.parse(saved);setPending({from:data.from,to:data.to,reprintOf:data.reprintOf});setFrom(String(data.from));setTo(String(data.to));setReprintOf(data.reprintOf || '');}catch{setError('The saved request on this device couldn’t be read. Check the office queue below before starting over.');}}
    else{let saved:string|null=null;try{saved=localStorage.getItem(refusedKey);}catch{saved=null;}setRefusal(readRefusal(saved));}
  },[storageKey,refusedKey]);
  const refreshStations=useCallback(async()=>{
    const stationData=await api('/api/office/stations');
    setPrinters(stationData.printers);setCanPrint(stationData.canPrint);setStationsLoaded(true);
    setSelected(value=>value || (stationData.printers[0]?`${stationData.printers[0].station_id}/${stationData.printers[0].id}`:''));
  },[]);
  useEffect(()=>{
    let active=true;
    // A good answer clears an earlier "couldn't reach" line.
    const update=()=>refreshStations().then(()=>{if(active)setError(e=>e && e===stationErrorRef.current?'':e);}).catch(err=>{if(active){const m=officeMessage(err);stationErrorRef.current=m;setError(m);}});
    void update();const timer=setInterval(()=>void update(),5000);
    return()=>{active=false;clearInterval(timer);};
  },[refreshStations]);
  const refresh=useCallback(async()=>{await Promise.all([refreshStations(),refreshRequests()]);},[refreshStations,refreshRequests]);
  const loaded=stationsLoaded && requestsLoaded;

  // The queued notice goes away as soon as the office picks the request up,
  // anything fails, or after a minute.
  useEffect(()=>{
    if(!notice)return;
    const request=notice.requestId?requests.find(r=>r.id===notice.requestId):undefined;
    if(summary.failed.length || (request && request.jobs.some(j=>j.state!=='queued'))){setNotice(null);return;}
    const timer=setTimeout(()=>setNotice(null),Math.max(0,60_000-(Date.now()-notice.at)));
    return()=>clearTimeout(timer);
  },[notice,requests,summary.failed.length]);

  const nothingLeft=firstUnsentLabel(jobs,total,printedCount)===null;
  // Suggest the next labels to send: after everything printed anywhere and
  // everything the office already has, never running into later office work,
  // and never more than one send can hold.
  useEffect(()=>{
    if(!loaded || rangeEdited.current || pending)return;
    const next=suggestOfficeRange(jobs,total,printedCount,cap);
    if(next){setFrom(String(next.from));setTo(String(next.to));}
    else{setFrom('1');setTo(String(Math.min(total,cap)));}
  },[loaded,jobs,total,printedCount,pending,cap]);
  const printer=printers.find(p=>`${p.station_id}/${p.id}`===selected);
  const readiness=officePrinterReadiness(printer);
  // A remembered refusal never outlives what live status says.
  const shownRefusal=refusalStillApplies(refusal,printer)?refusal:null;
  useEffect(()=>{if(refusal && printer && !refusalStillApplies(refusal,printer))clearRefusal();},[refusal,printer,clearRefusal]);

  // How this range has to go so the server takes it: new, reprint, or wait.
  const plan:OfficeSendPlan=useMemo(()=>{
    if(pending)return pending.reprintOf?{kind:'reprint',reprintOf:pending.reprintOf,overlap:{from:pending.from,to:pending.to}}:{kind:'new'};
    if(!rangeValid)return {kind:'new'};
    const automatic=officeSendPlan(jobs,fromNumber,toNumber);
    // A failed part the person chose to print again: the server takes any
    // earlier request of this run as the original.
    if(automatic.kind==='new' && reprintOf)return {kind:'reprint',reprintOf,overlap:{from:fromNumber,to:toNumber}};
    if(automatic.kind==='reprint' && reprintOf && requests.some(r=>r.id===reprintOf))return {...automatic,reprintOf};
    return automatic;
  },[pending,rangeValid,jobs,fromNumber,toNumber,reprintOf,requests]);
  const sendCount=rangeValid?toNumber-fromNumber+1:0;
  const tooBig=!pending && rangeValid && sendCount>cap;
  const [askedKey,setAskedKey]=useState('');
  const rangeKey=`${proofKey}|${plan.kind}`;

  const submit=async()=>{
    if(inFlight.current || !printer)return;inFlight.current=true;setBusy(true);setError('');setNotice(null);
    try{
      let payload;
      const saved=localStorage.getItem(storageKey);
      if(saved){
        try{payload=JSON.parse(saved);}catch{setError('The saved request on this device couldn’t be read. Check the office queue below before starting over.');return;}
      }else{
        // A new request always needs a check of exactly this range first, and
        // is never one the server would refuse.
        if(bitmap && proof?.key!==currentProofKey.current)return;
        if(!printAllowed || plan.kind==='wait' || tooBig)return;
        const reprint=plan.kind==='reprint'?plan.reprintOf:'';
        payload={runId,stationId:printer.station_id,printerId:printer.id,from:Number(from),to:Number(to),idempotencyKey:crypto.randomUUID(),...(reprint?{reprintOf:reprint}: {}),...(bitmap?{expectedBitmapDigest:proof?.digest}:{})};
        localStorage.setItem(storageKey,JSON.stringify(payload));setPending({from:payload.from,to:payload.to,reprintOf:payload.reprintOf});
      }
      clearRefusal();
      try{
        const result=await api('/api/office/jobs',{method:'POST',body:JSON.stringify(payload)});
        localStorage.removeItem(storageKey);setPending(null);
        setNotice({text:`${Range(payload.from,payload.to)} ${payload.from===payload.to?'is':'are'} queued for the office printer. You can leave this page; the office keeps going.`,requestId:typeof result?.requestId==='string'?result.requestId:undefined,at:Date.now()});
        setReprintOf('');setChooseAgain(false);rangeEdited.current=false;setSentThisVisit(true);
      }catch(err){
        // A definite refusal (400/404/409/413) means nothing new was queued,
        // so the saved request is cleared and never offered for resend.
        // Anything else (offline, timeout, 5xx, signed out, no access, busy)
        // might mean an earlier try arrived, so the same request is kept and
        // "Send again" reuses its idempotency key.
        const status=err instanceof OfficeRequestError?err.status:undefined;
        if(!keepPendingAfter(officeFailureKind(status))){
          localStorage.removeItem(storageKey);setPending(null);
          const plain=plainOfficeRefusal(err instanceof Error?err.message:'',status);
          const record:OfficeRefusalRecord={from:payload.from,to:payload.to,reason:plain.reason,message:plain.message,at:new Date().toISOString()};
          try{localStorage.setItem(refusedKey,JSON.stringify(record));}catch{/* shown on this page anyway */}
          setRefusal(record);
          if(plain.reason==='labels-changed')setProof(null);
        }else setPending({from:payload.from,to:payload.to,reprintOf:payload.reprintOf,status,code:err instanceof OfficeRequestError?err.code:undefined});
      }
      await refresh().catch(()=>{});
    }
    finally{inFlight.current=false;setBusy(false);}
  };
  const startOver=async()=>{
    const ok=await confirmDialog({title:'Start over?',body:'Check the office queue below first. The office may already have this request, and starting over doesn’t cancel anything already queued.',confirmLabel:'Start over'});
    if(!ok)return;
    localStorage.removeItem(storageKey);setPending(null);setError('');
  };
  const act=async(action:()=>Promise<void>)=>{setBusy(true);setError('');try{await action();await refresh();}catch(err){setError(officeMessage(err,'That didn’t save. Try again in a moment.'));}finally{setBusy(false);}};
  const proofCurrent=!bitmap || proof?.key===proofKey;
  const blockedByPrinter=!canPrint || !readiness.canSend;
  const cancelled=runStatus==='cancelled';
  const failedParts=summary.failed;
  const settled=nothingLeft && !reprintOf && !pending && !chooseAgain;
  const cancelledIdle=cancelled && !chooseAgain && !pending && !reprintOf;
  const showForm=!settled && !cancelledIdle;
  const disabled=busy || blockedByPrinter || !printAllowed || (!pending && (!rangeValid || plan.kind==='wait' || tooBig));
  const primaryLabel=busy
    ?(preparationProgress?'Checking labels…':'Sending to office printer…')
    :pending?'Send again'
    :shownRefusal?'Try again'
    :plan.kind==='wait'?'Waiting for office printer…'
    :!proofCurrent?(plan.kind==='reprint'?'Check labels & print again':`Check labels & send${sentThisVisit?' the next ones':''}`)
    :plan.kind==='reprint'?`Print ${plural(sendCount)} again`
    :sentThisVisit?`Send the next ${plural(sendCount)}`
    :`Send ${plural(sendCount)} to office printer`;
  const onPrimary=async()=>{
    if(!pending){
      if(plan.kind==='wait' || tooBig)return;
      // Ask once per range before anything long starts: printing labels the
      // office already got again, and a design that has layout problems.
      if(askedKey!==rangeKey){
        if(plan.kind==='reprint' && fixedRange.current!==`${fromNumber}-${toNumber}`){
          const one=fromNumber===toNumber;
          const ok=await confirmDialog({title:`Print ${range(fromNumber,toNumber)} again?`,body:`${Range(plan.overlap.from,plan.overlap.to)} went to the office printer before. ${one?'It prints':'They print'} again and ${one?'is':'are'} logged as a reprint. The run’s progress doesn’t change.`,confirmLabel:'Print again'});
          if(!ok)return;
        }
        if(layoutWarnings.length){
          const ok=await confirmDialog({title:'Send labels with layout problems?',body:<div className="space-y-2"><p>The preview shows items that cover each other or run off the label:</p><ul className="list-disc space-y-1 pl-5">{layoutWarnings.slice(0,4).map(w=><li key={w}>{w}</li>)}</ul>{layoutWarnings.length>4 && <p>And {layoutWarnings.length-4} more.</p>}<p>Check the preview first. Fix the design for next time with Edit design.</p></div>,confirmLabel:'Send anyway'});
          if(!ok)return;
        }
        setAskedKey(rangeKey);
      }
    }
    if(shownRefusal){const again=shownRefusal.reason==='labels-changed';clearRefusal();if(again||!proofCurrent){void prepareProof();return;}}
    if(!pending && !proofCurrent) void prepareProof(); else void submit();
  };
  const alreadyPrinted=!pending && plan.kind==='new' && rangeValid && fromNumber<=printedCount;
  const statusTone=readiness.tone==='ok'?'text-emerald-400':readiness.tone==='bad'?'text-red-400':'text-amber-300';
  const attention=failedParts.length>0 || !!printer?.needs_review;
  const connection=<div className="space-y-3">
    {printers.length>1
      ? <div className="space-y-1"><span id={`${uid}-printer`} className="field-label">Office printer</span><CustomSelect aria-labelledby={`${uid}-printer`} value={selected} onChange={setSelected} options={printers.map(p=>({value:`${p.station_id}/${p.id}`,label:p.name}))} /></div>
      : !printer && <p className="text-sm text-zinc-300">{stationsLoaded?'No office printer is set up for your account.':'Looking for the office printer…'}</p>}
    {printer && <div className="space-y-1 text-sm">
      {/* The printer and whether it can take jobs, on one line when all is well. */}
      <p className={`flex items-start gap-2 ${readiness.tone==='ok'?'text-zinc-300':statusTone}`}><span aria-hidden="true" className={`mt-1.5 size-2 shrink-0 rounded-full ${readiness.tone==='ok'?'bg-emerald-400':readiness.tone==='bad'?'bg-red-400':'bg-amber-300'}`} /><span>{printers.length>1?'':`${printer.name} · `}{readiness.tone==='ok'?<span className="text-emerald-400">Ready</span>:readiness.text}</span></p>
      {readiness.tone==='ok' && printer.dispatch_hold_reason && holdReasons[printer.dispatch_hold_reason] && <p className="text-amber-300">{holdReasons[printer.dispatch_hold_reason]}</p>}
    </div>}
    {printer && printer.dispatch_enabled && printer.paired_at!==null && <OfficePrinterControls attention={attention} />}
    {printer && <div>
      <FoldToggle open={detailsOpen} onToggle={()=>setDetailsOpen(v=>!v)} controls={`${uid}-details`}>Connection details</FoldToggle>
      <Fold open={detailsOpen} id={`${uid}-details`}><p className="pb-2 text-sm text-zinc-400">{lastSeen(printer.last_seen)} · prints at {printer.dpi} dots per inch</p></Fold>
    </div>}
  </div>;
  const pendingWords=uncertainSendWords(pending?.status,pending?.code);
  const openFix=(part:OfficeFailedPart)=>{setFixPart(part);setChecked(false);setReviewReason(part.didNotPrint||part.reason?`${capitalise(plainJobReason(part.reason))}.`:'');};
  const saveFix=()=>void act(async()=>{
    const part=fixPart;if(!part)return;
    // The server only reprints once each failed part is recorded as checked.
    // One record per part; nothing is sent here.
    for(const jobId of part.jobIds){
      try{await api('/api/office/review',{method:'POST',body:JSON.stringify({jobId,pendingCupsResolved:checked,reason:reviewReason})});}
      catch(err){if(!(err instanceof OfficeRequestError && err.status===409))throw err;}
    }
    setFixPart(null);
    fixedRange.current=`${part.from}-${Math.min(part.to,part.from+cap-1)}`;
    rangeEdited.current=true;setChooseAgain(false);setFrom(String(part.from));setTo(String(Math.min(part.to,part.from+cap-1)));
    if(part.requestId)setReprintOf(part.requestId);
    setNotice({text:`Saved. ${Range(part.from,part.to)} ${part.from===part.to?'is':'are'} ready to print again: check, then send.`,at:Date.now()});
  });
  return <div className="space-y-4">
    {connectionTarget && createPortal(connection,connectionTarget)}
    {!pending && failedParts.map(part=><div key={`${part.requestId}-${part.from}`} role="alert" className="space-y-1 text-sm">
      <p className="flex items-start gap-2 font-medium text-red-400"><AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{part.didNotPrint?`${Range(part.from,part.to)} didn’t print: ${plainJobReason(part.reason)}.`:`${Range(part.from,part.to)} may not have printed: ${part.reason?plainJobReason(part.reason):'the office computer didn’t confirm them in time'}. Check the printer.`}</p>
      {canPrint
        ? <button type="button" disabled={busy} onClick={()=>openFix(part)} className="btn btn-secondary btn-sm ml-6">Print {part.from===part.to?part.from:`${part.from}–${part.to}`} again…</button>
        : <p className="pl-6 text-zinc-400">Ask someone who can print to check the office printer.</p>}
    </div>)}
    {summary.onTheWay>0 && !settled && <p role="status" className="flex items-center gap-2 text-sm text-zinc-300 tabular-nums"><Loader2 className="size-4 animate-spin text-amber-400" aria-hidden="true" />{plural(summary.onTheWay)} on {summary.onTheWay===1?'its':'their'} way to the office printer</p>}
    {pending && <div role="status" className="space-y-1 text-sm text-amber-300">
      <p className="flex items-start gap-2 font-medium"><AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />We’re not sure the office got {range(pending.from,pending.to)}</p>
      <p className="pl-6">{pendingWords.message}</p>
      <button type="button" onClick={()=>void startOver()} disabled={busy} className="btn btn-ghost btn-sm ml-4 text-amber-300">Start over</button>
    </div>}
    {shownRefusal && !pending && <div role="alert" className="space-y-1 text-sm text-amber-300">
      <p className="flex items-start gap-2 font-medium"><AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{Range(shownRefusal.from,shownRefusal.to)} {shownRefusal.from===shownRefusal.to?'wasn’t':'weren’t'} sent</p>
      <p className="pl-6">{shownRefusal.message}</p>
    </div>}
    {settled ? <div className="space-y-3">
      {summary.onTheWay>0
        ? <p role="status" className="flex min-h-control items-center gap-2 text-sm text-zinc-300"><Loader2 className="size-4 animate-spin text-amber-400" aria-hidden="true" />Every label is on its way to the office printer.</p>
        : failedParts.length===0 && <p role="status" className="flex min-h-control items-center gap-2 text-sm font-medium text-emerald-400"><CheckCircle2 className="size-4 rounded-full animate-success" aria-hidden="true" />{printedCount>=total?`All ${total.toLocaleString()} labels printed`:`All ${total.toLocaleString()} labels sent to the office printer`}</p>}
      {printedCount<total && summary.onTheWay===0 && failedParts.length===0 && <p className="text-sm text-zinc-400">Sent isn’t proof of printing. Check the labels came out, then mark them printed under Progress.</p>}
      <button type="button" disabled={busy} onClick={()=>{rangeEdited.current=true;setChooseAgain(true);setReprintOf('');setFrom('1');setTo(String(Math.min(total,cap)));setNotice(null);}} className="btn btn-secondary btn-sm w-full"><RotateCcw className="size-4" aria-hidden="true" />Print some labels again…</button>
    </div> : cancelledIdle ? <div className="space-y-3">
      <p className="text-sm text-zinc-300">This run was cancelled after {printedCount.toLocaleString()} of {total.toLocaleString()} labels.</p>
      <button type="button" disabled={busy} onClick={()=>{rangeEdited.current=true;setChooseAgain(true);setReprintOf('');setNotice(null);}} className="btn btn-ghost btn-sm -ml-2 text-zinc-300">Print some labels anyway…</button>
    </div> : null}
    {showForm && <>
    {(chooseAgain || reprintOf) && !pending && <div className="flex items-center justify-between gap-2 text-sm text-zinc-300"><span>{reprintOf?'Print these labels again.':'Choose which labels to print.'}</span><button type="button" className="btn btn-ghost btn-sm" onClick={()=>{setChooseAgain(false);setReprintOf('');rangeEdited.current=false;}}>Cancel</button></div>}
    <div className="grid grid-cols-3 gap-2">
      <label className="text-xs font-medium text-zinc-400">From label<input className={inputClass+' mt-1'} inputMode="numeric" disabled={!!pending || busy} value={from} onChange={e=>{rangeEdited.current=true;setFrom(e.target.value);}} /></label>
      <label className="text-xs font-medium text-zinc-400">Stop after label<input className={inputClass+' mt-1'} inputMode="numeric" disabled={!!pending || busy} value={to} onChange={e=>{rangeEdited.current=true;setTo(e.target.value);}} /></label>
      <label className="text-xs font-medium text-zinc-400">How many<input type="number" inputMode="numeric" min={1} max={Math.max(1,total-Number(from)+1)} disabled={!!pending || busy} className={inputClass+' mt-1'} value={Math.max(0,Number(to)-Number(from)+1)} onChange={e=>{rangeEdited.current=true;setTo(String(Math.min(total,Number(from)+Math.max(1,Number(e.target.value))-1)));}} /></label>
    </div>
    {!pending && !rangeValid && <p role="alert" className="text-sm text-amber-300">Enter label numbers from 1 to {total.toLocaleString()}, with &ldquo;Stop after&rdquo; at or after &ldquo;From&rdquo;.</p>}
    {tooBig && <div className="space-y-1 text-sm text-amber-300"><p>The office printer takes up to {plural(cap)} of this design in one send.</p><button type="button" className="btn btn-ghost btn-sm -ml-2 text-amber-300" onClick={()=>{rangeEdited.current=true;setTo(String(fromNumber+cap-1));}}>Send {fromNumber.toLocaleString()}–{(fromNumber+cap-1).toLocaleString()} now</button></div>}
    {!pending && rangeValid && !tooBig && plan.kind==='new' && toNumber<total && total-fromNumber+1>cap && <p className="text-sm text-zinc-400">This run is too big for one send, so it goes {plural(cap)} at a time. After each send, tap Send the next {cap.toLocaleString()}.</p>}
    {!pending && rangeValid && plan.kind==='wait' && <p role="status" className="text-sm text-zinc-400">{plan.why==='needs-check'?`${Range(plan.overlap.from,plan.overlap.to)} need someone to check the office printer first (see above).`:`${Range(plan.overlap.from,plan.overlap.to)} ${plan.overlap.from===plan.overlap.to?'is':'are'} still on the way to the office printer. Send these once ${plan.overlap.from===plan.overlap.to?'it’s':'they’re'} sent.`}</p>}
    {!pending && rangeValid && plan.kind==='reprint' && !tooBig && <p className="text-sm text-amber-300">{Range(plan.overlap.from,plan.overlap.to)} went to the office printer before, so this is logged as a reprint.</p>}
    {alreadyPrinted && <div className="space-y-1 text-sm text-amber-300"><p>{Range(fromNumber,Math.min(toNumber,printedCount))} {fromNumber===Math.min(toNumber,printedCount)?'is':'are'} already counted as printed.</p>{printedCount<toNumber && <button type="button" className="btn btn-ghost btn-sm -ml-2 text-amber-300" onClick={()=>{rangeEdited.current=true;setFrom(String(printedCount+1));}}>Send {printedCount+1}–{toNumber} instead</button>}</div>}
    {!printAllowed && <p className="text-sm text-amber-300">Sending is off until every label has a value (see the list above).</p>}
    <button type="button" disabled={disabled} onClick={()=>void onPrimary()} className="btn btn-primary w-full">{busy?<Loader2 className="size-4 animate-spin" />:<PrinterIcon className="size-4" />}{primaryLabel}</button>
    {blockedByPrinter && !canPrint && !busy && printer && <p className="text-sm text-zinc-400">Your account can’t send labels to the office printer.</p>}
    </>}
    {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
    {requestsError && requestsError.status!==401 && requestsError.status!==403 && <p role="status" className="text-sm text-zinc-400">The office queue couldn’t be read just now. It tries again on its own.</p>}
    {notice && <p role="status" className="text-sm text-emerald-400 animate-enter">{notice.text}</p>}
    {bitmap && showForm && !pending && (preparationProgress || (proofCurrent && proof) ) && <div className="space-y-2 text-sm" aria-labelledby={`${uid}-check`}>
      <p id={`${uid}-check`} className="sr-only">Label check{rangeValid?` (${fromNumber}–${toNumber})`:''}</p>
      {preparationProgress && <div role="status" className="space-y-2">
        <p className="text-zinc-300 tabular-nums">Checked {preparationProgress.completed.toLocaleString()} of {preparationProgress.total.toLocaleString()} labels… nothing is sent yet.</p>
        <progress className="w-full accent-amber-500" max={preparationProgress.total} value={preparationProgress.completed} aria-label="Checking labels" />
        <button type="button" onClick={()=>preparationController.current?.abort()} className="btn btn-secondary btn-sm">Stop checking</button>
      </div>}
      {!preparationProgress && proofCurrent && proof && <div className="space-y-2">
        <p className="flex items-center gap-1.5 text-emerald-400"><CheckCircle2 className="size-4 rounded-full animate-success" aria-hidden="true" />{plural(proof.feeds.length)} checked</p>
        {proofImage ? <img src={proofImage} alt={`Checked label ${fromNumber+proofIndex}`} className="w-full rounded bg-white" style={{imageRendering:'pixelated'}} /> : <p className="text-zinc-400 flex items-center gap-1.5"><Loader2 className="size-3.5 animate-spin" aria-hidden="true" />Drawing preview…</p>}
        {proof.feeds.length>1 && <label className="flex items-center gap-2 text-zinc-400">Preview label<input type="number" min={1} max={proof.feeds.length} value={proofIndex+1} onChange={e=>setProofIndex(Math.max(0,Math.min(proof.feeds.length-1,Number(e.target.value)-1)))} className={inputClass+' field-sm w-20'} /><span className="tabular-nums">of {proof.feeds.length}</span></label>}
      </div>}
    </div>}
    {bitmap && showForm && !pending && !preparationProgress && !proofCurrent && !shownRefusal && plan.kind!=='wait' && <p className="text-sm text-zinc-400">Every label is drawn first. If one is missing a value or doesn&apos;t fit, nothing is sent.</p>}
    {requests.length>0 && <div>
      <FoldToggle open={queueOpen} onToggle={()=>setQueueOpen(v=>!v)} controls={`${uid}-queue`}>Office queue <span className="tabular-nums">· {summary.onTheWay.toLocaleString()} on the way · {summary.sent.toLocaleString()} sent{failedParts.length?` · ${failedParts.length} didn’t print`:''}</span></FoldToggle>
      <Fold open={queueOpen} id={`${uid}-queue`}>
      <ul className="max-h-96 overflow-y-auto space-y-4 pt-2 text-sm">
        {requests.map(r=><li key={r.id} className="space-y-1">
          <p className="font-medium text-zinc-100">Labels {r.range_from}–{r.range_to}{r.reprint_of?' · reprint':''}</p>
          <p className="text-zinc-400">{[formatWhen(r.created_at),r.username].filter(Boolean).join(' · ')}</p>
          <ul className="space-y-1">{r.jobs.map(j=><li key={j.id} className="text-zinc-300"><span className="tabular-nums">{j.from}–{j.to}</span>: {j.review && j.state!=='rejected'?'Check the printer before retrying':labels[j.state] ?? 'Unknown'}{j.reason && (j.review || ['rejected','needs_review'].includes(j.state)) && <span className="block text-zinc-400">{capitalise(plainJobReason(j.reason))}.</span>}
            {canPrint && (j.review || ['claimed','submitted','needs_review'].includes(j.state)) && j.state!=='rejected' && <button type="button" disabled={busy} className="btn btn-ghost btn-sm -ml-2 block text-amber-300" onClick={()=>{setReview(j);setChecked(false);setReviewReason('');}}>Record what happened</button>}
          </li>)}</ul>
          <div className="flex flex-wrap gap-1 -ml-2">
            {canPrint && r.jobs.some(j=>j.state==='queued') && <button type="button" disabled={busy} className="btn btn-ghost btn-sm text-amber-300" onClick={()=>void act(async()=>{const result=await api('/api/office/jobs/'+r.id,{method:'DELETE'});setNotice({text:`Cancelled ${result.cancelled} part${result.cancelled===1?'':'s'} that hadn't been picked up. ${result.requires_review ? `${result.requires_review} part${result.requires_review===1?' was':'s were'} already picked up and need someone to check the printer; nothing was stopped at the office.` : ''}`.trim(),at:Date.now()});})}>Cancel what hasn&apos;t been picked up</button>}
            {canPrint && r.jobs.every(j=>!j.review && !['queued','claimed','submitted','needs_review','rejected'].includes(j.state)) && <button type="button" className="btn btn-ghost btn-sm text-zinc-300" onClick={()=>{rangeEdited.current=true;setReprintOf(r.id);setChooseAgain(false);setFrom(String(r.range_from));setTo(String(Math.min(r.range_to,r.range_from+cap-1)));}}>Print again</button>}
          </div>
        </li>)}
      </ul>
      </Fold>
    </div>}
    <Dialog open={!!fixPart} onClose={()=>setFixPart(null)} title={fixPart?`Print ${range(fixPart.from,fixPart.to)} again?`:''} dismissible={!busy}>
      <p className="text-sm text-zinc-300">{fixPart?.didNotPrint?`The office computer said ${plainJobReason(fixPart.reason)}. Fix that first, for example by loading labels.`:'The office computer didn’t confirm these. Check what came out of the printer first, so nothing prints twice.'} Then make sure nothing from this print is still waiting in the office computer&apos;s print queue.</p>
      <label className="flex gap-2 text-sm text-zinc-300"><input type="checkbox" className="mt-1 accent-amber-500" checked={checked} onChange={e=>setChecked(e.target.checked)} />The printer is ready again, and nothing still waiting at the office can print these labels later.</label>
      <label className="block text-sm text-zinc-300">What happened (kept with the print history)
        <textarea className={inputClass+' mt-1 text-sm'} rows={2} value={reviewReason} onChange={e=>setReviewReason(e.target.value)} />
      </label>
      <p className="text-sm text-zinc-400">Next you check the labels, then send them again. Nothing prints until you do.</p>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" className="btn btn-secondary" onClick={()=>setFixPart(null)}>Cancel</button>
        <button type="button" disabled={busy || !checked || reviewReason.trim().length<3} className="btn btn-primary" onClick={saveFix}>Continue</button>
      </div>
    </Dialog>
    <Dialog open={!!review} onClose={()=>setReview(null)} title={review?`What happened to ${range(review.from,review.to)}?`:''} dismissible={!busy}>
      <p className="text-sm text-zinc-300">Check the printer and the office computer&apos;s print queue. Finish or cancel anything still waiting there first. Recording this can&apos;t stop the printer, and it doesn&apos;t reprint anything.</p>
      <label className="flex gap-2 text-sm text-zinc-300"><input type="checkbox" className="mt-1 accent-amber-500" checked={checked} onChange={e=>setChecked(e.target.checked)} />I checked the printer, and nothing still waiting at the office can print these labels later.</label>
      <label className="block text-sm text-zinc-300">What printed, what failed, and what you did
        <textarea className={inputClass+' mt-1 text-sm'} rows={3} value={reviewReason} onChange={e=>setReviewReason(e.target.value)} />
      </label>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" className="btn btn-secondary" onClick={()=>setReview(null)}>Cancel</button>
        <button type="button" disabled={busy || !checked || reviewReason.trim().length<3} className="btn btn-primary" onClick={()=>void act(async()=>{if(!review)return;await api('/api/office/review',{method:'POST',body:JSON.stringify({jobId:review.id,pendingCupsResolved:checked,reason:reviewReason})});setReview(null);setNotice({text:'Saved. Nothing was reprinted.',at:Date.now()});})}>Save what happened</button>
      </div>
    </Dialog>
  </div>;
}
