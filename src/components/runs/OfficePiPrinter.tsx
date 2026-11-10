'use client';
import type { Run, LabelTemplate, LabelFormat, RunStatus } from '@/lib/types';
import { generateLabelsForRunWithImages } from '@/lib/runBuilder';
import { OfficePrinterControls } from './OfficePrinterControls';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { Printer as PrinterIcon, RotateCcw, CheckCircle2, Loader2, AlertCircle } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { CustomSelect } from '@/components/ui/CustomSelect';
import { Fold, FoldToggle } from '@/components/ui/Fold';
import { confirmDialog } from '@/components/ui/feedback';
import { friendlyError, friendlyRenderError } from '@/lib/userMessages';
import { capAfterSizeError, firstUnsentLabel, isValidOfficeRange, officeProofKey, officeSendCap, officeSendParts, officeSendPlan, officeWaitingSpans, readPartsPlan, remainingParts, spanWords, suggestOfficeRange, OFFICE_BITMAP_LABELS_PER_SEND, OFFICE_MAX_LABELS, type OfficeDeliverySummary, type OfficeFailedPart, type OfficePartsPlan, type OfficeSendPlan, type OfficeSpan } from '@/lib/officeRange';
import { officeFailureKind, officeStatusLine, plainJobReason, plainOfficeRefusal, queuedNotice, readPendingMeta, readRefusal, refusalNeedsSomeoneElse, refusalStillApplies, sendKeepsRequest, uncertainSendWords, type OfficeRefusalRecord, type OfficeReviewHold } from '@/lib/officeSendOutcome';
import type { OfficeJobBrief, OfficeRequest } from './useOfficeRequests';
interface Printer { station_id:string; id:string; name:string; dpi:number; max_width_dots:number; last_seen:string|null; online:boolean; available:boolean; dispatch_enabled:boolean; paired_at:string|null; needs_review:boolean; dispatch_hold_reason?:string|null; review_holds?:OfficeReviewHold[] }
/** HTTP error that remembers its status, so a definite refusal reads differently from "not sure it arrived". */
class OfficeRequestError extends Error { constructor(message:string, public status:number, public code?:string){ super(message); } }
async function api(path:string,init?:RequestInit){
  const response=await fetch(path,{...init,headers:{'Content-Type':'application/json',...init?.headers},cache:'no-store'});
  const result=await response.json().catch(()=>({}));if(!response.ok)throw new OfficeRequestError(result.error || 'Request failed',response.status,typeof result.code==='string'?result.code:undefined);return result;
}
const labels:Record<string,string>={queued:'Waiting to be sent',claimed:'Picked up by the office',submitted:'In the office print queue',sent_to_printer:'Sent to the printer',rejected:'Didn’t print',needs_review:'Needs a check',cancelled:'Cancelled before sending',resolved:'Checked at the office'};
const inputClass='field tabular-nums';
const plural=(n:number)=>n===1?'1 label':`${n.toLocaleString()} labels`;
const nums=(a:number,b:number)=>a===b?a.toLocaleString():`${a.toLocaleString()}–${b.toLocaleString()}`;
const range=(a:number,b:number)=>a===b?`label ${a.toLocaleString()}`:`labels ${nums(a,b)}`;
const Range=(a:number,b:number)=>a===b?`Label ${a.toLocaleString()}`:`Labels ${nums(a,b)}`;
const capitalise=(text:string)=>text.charAt(0).toUpperCase()+text.slice(1);
const single=(spans:ReadonlyArray<OfficeSpan>)=>spans.length===1 && spans[0].from===spans[0].to;
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
type SendOutcome='sent'|'refused'|'uncertain'|'skipped';
type Series={total:number;index:number;part:OfficeSpan;phase:'checking'|'sending';progress?:{completed:number;total:number}};
/** The person's answer in the fix dialog. */
type Fix={part:OfficeFailedPart;choice:''|'printed'|'reprint';checked:boolean;note:string;order:'in-order'|'let-run'};
const tone={bad:'text-red-400',warn:'text-amber-300',ok:'text-emerald-400'} as const;
const dotTone={bad:'bg-red-400',warn:'bg-amber-300',ok:'bg-emerald-400'} as const;
export function OfficePiPrinter({runId,total,connectionTarget,run,template,format,printAllowed=true,printedCount=0,runStatus,requests,jobs,summary,requestsLoaded,requestsEverLoaded=requestsLoaded,requestsTruncated=false,requestsError,refreshRequests,printBlockedReason='',markRanges=[],onMarkPrinted,onRecordPrinted}:{runId:string;total:number;connectionTarget:HTMLDivElement|null;run?:Run;template?:LabelTemplate;format?:LabelFormat;printAllowed?:boolean;
  /** Labels already counted as printed for this run (on any printer). Office sends never change it. */
  printedCount?:number;
  runStatus?:RunStatus;
  /** The run's office requests (latest 100) and every job of the run, read by the run page. */
  requests:OfficeRequest[];
  jobs:ReadonlyArray<OfficeJobBrief>;
  summary:OfficeDeliverySummary;
  requestsLoaded:boolean;
  /** True once one read of the office queue succeeded: nothing new is sent before. */
  requestsEverLoaded?:boolean;
  requestsTruncated?:boolean;
  requestsError?:{status:number;message:string}|null;
  refreshRequests:()=>Promise<void>;
  /** Why sending is off when printAllowed is false (the run page's check above names the problem). */
  printBlockedReason?:string;
  /** Stretches the office reported sent that aren't counted as printed yet. */
  markRanges?:OfficeSpan[];
  /** Asks once, then counts every sent stretch as printed. */
  onMarkPrinted?:()=>Promise<void>;
  /** Counts labels a person saw come out (a part the office never confirmed) as printed. */
  onRecordPrinted?:(ranges:OfficeSpan[],note:string)=>Promise<boolean>}){
  const uid=useId();
  const [printers,setPrinters]=useState<Printer[]>([]);const [selected,setSelected]=useState('');
  const [stationsLoaded,setStationsLoaded]=useState(false);const [canPrint,setCanPrint]=useState(false);
  const [from,setFrom]=useState('1');const [to,setTo]=useState(String(total));
  const [error,setError]=useState('');
  const [notice,setNotice]=useState<{text:string;requestId?:string;at:number;queued?:boolean}|null>(null);
  const [busy,setBusy]=useState(false);
  const [pending,setPending]=useState<Pending|null>(null);
  // A send the server definitely refused. Kept on this device so a refresh
  // still says what happened, until live status says otherwise.
  const [refusal,setRefusal]=useState<OfficeRefusalRecord|null>(null);
  const [chooseAgain,setChooseAgain]=useState(false);
  const [sendOther,setSendOther]=useState(false);
  const [sentThisVisit,setSentThisVisit]=useState(false);
  const stationErrorRef=useRef('');
  const bitmap = template?.thermalRenderMode === 'bitmap-v1';
  const across = Math.max(1, format?.labelsAcross || 1);
  // Only things that change the printed labels invalidate the check; a
  // progress or status update on the run does not force a redo. The design
  // part is worked out once per design, not on every keystroke. The server
  // still verifies the digest against the saved run before queuing.
  const designKey=useMemo(()=>officeProofKey(run,template,format,'',''),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [run?.id,run?.sourceData,run?.fieldMappings,run?.staticValues,run?.mappedField,template,format]);
  const keyOf=useCallback((a:string|number,b:string|number)=>`${designKey}|${a}|${b}`,[designKey]);
  const proofKey = keyOf(from,to);
  const currentProofKey = useRef(proofKey);
  useEffect(()=>{currentProofKey.current=proofKey;},[proofKey]);
  const [proof,setProofState]=useState<{key:string;digest:string;count:number}|null>(null);
  // The latest check, read by a send that starts in the same tap.
  const proofRef=useRef<{key:string;digest:string;count:number}|null>(null);
  const setProof=(next:{key:string;digest:string;count:number}|null)=>{proofRef.current=next;setProofState(next);};
  const preparationController=useRef<AbortController|null>(null);
  const [preparationProgress,setPreparationProgress]=useState<{completed:number;total:number}|null>(null);
  const [series,setSeries]=useState<Series|null>(null);
  const seriesRunning=useRef(false);
  useEffect(()=>()=>{if(!seriesRunning.current)preparationController.current?.abort();},[proofKey]);
  const inFlight=useRef(false);
  const rangeEdited=useRef(false);
  /** The range someone just chose in the fix dialog: that dialog was the ask. */
  const fixedRange=useRef('');
  const fromNumber=Number(from),toNumber=Number(to);
  const rangeValid=isValidOfficeRange(from,to,total);
  const refusedKey=`lw:office-refused:${runId}`;
  const metaKey=`lw:office-pending-meta:${runId}`;
  const partsKey=`lw:office-parts:${runId}`;
  const clearRefusal=useCallback(()=>{setRefusal(null);try{localStorage.removeItem(refusedKey);}catch{/* nothing saved */}},[refusedKey]);

  // --- How many labels one send may hold -------------------------------------
  // The server refuses more than 10,000 labels or 32 MiB of printer data in
  // one send, and stops drawing bitmap labels after a few minutes. A few
  // sample labels give the size per label before any long check starts.
  const defaultCap=bitmap?OFFICE_BITMAP_LABELS_PER_SEND:OFFICE_MAX_LABELS;
  const [sizeCap,setSizeCap]=useState<{key:string;cap:number}|null>(null);
  const cap=Math.max(1,sizeCap?.key===designKey?sizeCap.cap:Math.floor(defaultCap/across)*across||defaultCap);
  const sampleFor=useRef('');
  useEffect(()=>{
    if(!run||!template||!format||total<=0||sampleFor.current===designKey)return;
    sampleFor.current=designKey;
    let active=true;const controller=new AbortController();
    const sampleTo=Math.min(total,Math.max(8,across*2));
    generateLabelsForRunWithImages(run,template,format,{from:1,to:sampleTo},{signal:controller.signal})
      .then(feeds=>{if(active&&feeds.length){const estimate=officeSendCap(feeds.map(f=>new TextEncoder().encode(f).length),across,bitmap);setSizeCap(current=>({key:designKey,cap:Math.min(current?.key===designKey?current.cap:Infinity,estimate)}));}})
      .catch(()=>{sampleFor.current='';/* the full check reports any problem */});
    return()=>{active=false;controller.abort();};
  },[run,template,format,total,across,bitmap,designKey]);

  /**
   * Draws every label of a range (bitmap designs) and keeps its digest: the
   * server queues only labels that match the check. Nothing is sent here.
   */
  const drawProof=async(target:OfficeSpan,onProgress?:(completed:number,total:number)=>void)=>{
    if(!run||!template||!format)return null;
    const key=keyOf(target.from,target.to);currentProofKey.current=key;
    const controller=new AbortController();preparationController.current=controller;
    try{
      const feeds=await generateLabelsForRunWithImages(run,template,format,{from:target.from,to:target.to},{signal:controller.signal,onProgress});
      if(!feeds.length)throw new Error('Choose a valid label range');
      const digests=feeds.map(z=>z.match(/\^FXLWBITMAP1:[a-f0-9]{64}:([a-f0-9]{64})\^FS/)?.[1]);
      const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(digests.join('\n')));
      const digest=Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
      if(controller.signal.aborted || currentProofKey.current!==key)return null;
      const checked={key,digest,count:feeds.length};setProof(checked);return checked;
    }catch(e){
      if(controller.signal.aborted)return null;
      // Too much printer data for one send: shrink the send size and say so
      // in plain words, instead of showing the size error.
      const smaller=capAfterSizeError(e instanceof Error?e.message:'',target.from,across);
      if(smaller){setSizeCap({key:designKey,cap:Math.min(cap,smaller)});setError(`That’s too much printer data for one send, so the office printer now takes up to ${plural(smaller)} of this design at a time.`);}
      else setError(friendlyRenderError(friendlyError(e,'Checking the labels failed.'),template.elements,format.labelsAcross||1));
      return null;
    }finally{preparationController.current=null;}
  };
  const prepareProof=async()=>{
    if(inFlight.current||!rangeValid||!printAllowed)return;
    inFlight.current=true;setBusy(true);setError('');setProof(null);clearRefusal();setNotice(null);
    try{await drawProof({from:fromNumber,to:toNumber},(completed,total)=>setPreparationProgress({completed,total}));}
    finally{setPreparationProgress(null);inFlight.current=false;setBusy(false);}
  };
  const [reprintOf,setReprintOf]=useState('');
  const [fix,setFix]=useState<Fix|null>(null);
  const [queueOpen,setQueueOpen]=useState(false);const [detailsOpen,setDetailsOpen]=useState(false);
  // Persist a submission identity before network I/O. An uncertain response,
  // reload or double-click retries this identity, never manufactures new jobs.
  const jobsRef=useRef(jobs);
  useEffect(()=>{jobsRef.current=jobs;},[jobs]);
  const storageKey=`lw:office-pending:${runId}`;
  const [partsPlan,setPartsPlan]=useState<OfficePartsPlan|null>(null);
  useEffect(()=>{
    let saved:string|null=null;try{saved=localStorage.getItem(storageKey);}catch{saved=null;}
    if(saved){try{const data=JSON.parse(saved);let meta:string|null=null;try{meta=localStorage.getItem(metaKey);}catch{meta=null;}setPending({from:data.from,to:data.to,reprintOf:data.reprintOf,...readPendingMeta(meta)});setFrom(String(data.from));setTo(String(data.to));setReprintOf(data.reprintOf || '');}catch{setError('The saved request on this device couldn’t be read. Check the office queue below before starting over.');}}
    else{let refused:string|null=null;try{refused=localStorage.getItem(refusedKey);}catch{refused=null;}setRefusal(readRefusal(refused));}
    let plan:string|null=null;try{plan=localStorage.getItem(partsKey);}catch{plan=null;}
    setPartsPlan(readPartsPlan(plan));
  },[storageKey,refusedKey,metaKey,partsKey]);
  const savePartsPlan=(plan:OfficePartsPlan|null)=>{
    setPartsPlan(plan);
    try{if(plan && plan.next<plan.parts.length)localStorage.setItem(partsKey,JSON.stringify(plan));else localStorage.removeItem(partsKey);}catch{/* the page still shows it */}
  };
  const refreshStations=useCallback(async()=>{
    const stationData=await api('/api/office/stations');
    setPrinters(stationData.printers);setCanPrint(stationData.canPrint);setStationsLoaded(true);
    setSelected(value=>value || (stationData.printers[0]?`${stationData.printers[0].station_id}/${stationData.printers[0].id}`:''));
  },[]);
  const printer=printers.find(p=>`${p.station_id}/${p.id}`===selected);
  const status=officeStatusLine(printer,runId);
  const moving=summary.onTheWay>0;
  const watchClosely=!!pending || moving || status.stopped || status.paused || !!series || busy;
  useEffect(()=>{
    let active=true;
    // A good answer clears an earlier "couldn't reach" line.
    const update=()=>{if(typeof document!=='undefined' && document.visibilityState==='hidden')return;void refreshStations().then(()=>{if(active)setError(e=>e && e===stationErrorRef.current?'':e);}).catch(err=>{if(active){const m=officeMessage(err);stationErrorRef.current=m;setError(m);}});};
    update();const timer=setInterval(update,watchClosely?5000:15000);
    const onVisible=()=>{if(document.visibilityState==='visible')update();};
    document.addEventListener('visibilitychange',onVisible);
    return()=>{active=false;clearInterval(timer);document.removeEventListener('visibilitychange',onVisible);};
  },[refreshStations,watchClosely]);
  const refresh=useCallback(async()=>{await Promise.all([refreshStations(),refreshRequests()]);},[refreshStations,refreshRequests]);
  const loaded=stationsLoaded && requestsLoaded;

  // The queued notice goes away as soon as the office picks the request up,
  // anything fails, or after a minute.
  useEffect(()=>{
    if(!notice)return;
    const request=notice.requestId?requests.find(r=>r.id===notice.requestId):undefined;
    if((summary.failed.length && notice.requestId) || (request && request.jobs.some(j=>j.state!=='queued'))){setNotice(null);return;}
    const timer=setTimeout(()=>setNotice(null),Math.max(0,60_000-(Date.now()-notice.at)));
    return()=>clearTimeout(timer);
  },[notice,requests,summary.failed.length]);

  const nothingLeft=firstUnsentLabel(jobs,total,printedCount)===null;
  // Suggest the next labels to send: after everything printed anywhere and
  // everything the office already has, never running into later office work.
  // A range bigger than one send goes as an explicit "Send all … in N parts".
  useEffect(()=>{
    if(!loaded || rangeEdited.current || pending || chooseAgain || seriesRunning.current)return;
    const next=suggestOfficeRange(jobs,total,printedCount,Infinity);
    if(next){setFrom(String(next.from));setTo(String(next.to));}
    else{setFrom('');setTo('');}
  },[loaded,jobs,total,printedCount,pending,chooseAgain]);
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
    if(automatic.kind==='reprint' && reprintOf && jobs.some(j=>j.requestId===reprintOf))return {...automatic,reprintOf};
    return automatic;
  },[pending,rangeValid,jobs,fromNumber,toNumber,reprintOf]);
  const sendCount=rangeValid?toNumber-fromNumber+1:0;
  const tooBig=!pending && rangeValid && sendCount>cap;
  const parts=useMemo(()=>tooBig && plan.kind==='new'?officeSendParts(fromNumber,toNumber,cap,across):[],[tooBig,plan.kind,fromNumber,toNumber,cap,across]);
  const [askedKey,setAskedKey]=useState('');
  const rangeKey=`${proofKey}|${plan.kind}`;

  /**
   * One send = one POST with one saved idempotency key. `target` is a part of
   * an explicit multi-part send; otherwise the range on screen.
   */
  const submit=async(target?:OfficeSpan):Promise<SendOutcome|undefined>=>{
    if(inFlight.current || !printer)return;inFlight.current=true;setBusy(true);setError('');setNotice(null);
    let outcome:SendOutcome='skipped';
    try{
      let payload;
      let saved:string|null=null;try{saved=localStorage.getItem(storageKey);}catch{saved=null;}
      const proof=proofRef.current;
      const want=target ?? {from:fromNumber,to:toNumber};
      if(saved){
        try{payload=JSON.parse(saved);}catch{setError('The saved request on this device couldn’t be read. Check the office queue below before starting over.');return;}
        // A part of "Send all in parts" only ever resends its own saved request.
        if(target && (payload.from!==target.from || payload.to!==target.to)){setError(`Finish sending ${range(payload.from,payload.to)} first.`);return;}
      }else{
        // A new request always needs a check of exactly this range first, and
        // is never one the server would refuse.
        if(bitmap && proof?.key!==currentProofKey.current)return;
        if(bitmap && proof?.key!==keyOf(want.from,want.to))return;
        if(!target){if(!printAllowed || plan.kind==='wait' || tooBig)return;}
        if(!printAllowed || !requestsEverLoaded)return;
        const reprint=target?'':plan.kind==='reprint'?plan.reprintOf:'';
        payload={runId,stationId:printer.station_id,printerId:printer.id,from:want.from,to:want.to,idempotencyKey:crypto.randomUUID(),...(reprint?{reprintOf:reprint}: {}),...(bitmap?{expectedBitmapDigest:proof?.digest}:{})};
        try{localStorage.setItem(storageKey,JSON.stringify(payload));}
        catch{setError('This device can’t save the request, so it wasn’t sent. Check that the browser allows saving site data.');return;}
        setPending({from:payload.from,to:payload.to,reprintOf:payload.reprintOf});
      }
      clearRefusal();
      try{
        const result=await api('/api/office/jobs',{method:'POST',body:JSON.stringify(payload)});
        try{localStorage.removeItem(storageKey);localStorage.removeItem(metaKey);}catch{/* nothing saved */}setPending(null);
        if(!target)setNotice({text:queuedNotice(Range(payload.from,payload.to),payload.from===payload.to,status),requestId:typeof result?.requestId==='string'?result.requestId:undefined,at:Date.now(),queued:true});
        setReprintOf('');setChooseAgain(false);setSendOther(false);rangeEdited.current=false;setSentThisVisit(true);
        outcome='sent';
      }catch(err){
        // A definite refusal (400/404/409/413) means nothing new was queued,
        // so the saved request is cleared and never offered for resend.
        // Anything else (offline, timeout, 5xx, busy, or signed out / no
        // access on a resend) might mean an earlier try arrived, so the same
        // request is kept and "Send again" reuses its idempotency key.
        const code=err instanceof OfficeRequestError?err.status:undefined;
        if(!sendKeepsRequest(code,err instanceof OfficeRequestError?err.code:undefined,!!saved)){
          try{localStorage.removeItem(storageKey);localStorage.removeItem(metaKey);}catch{/* nothing saved */}setPending(null);
          const plain=plainOfficeRefusal(err instanceof Error?err.message:'',code);
          const record:OfficeRefusalRecord={from:payload.from,to:payload.to,reason:plain.reason,message:plain.message,at:new Date().toISOString()};
          try{localStorage.setItem(refusedKey,JSON.stringify(record));}catch{/* shown on this page anyway */}
          setRefusal(record);
          if(plain.reason==='labels-changed')setProof(null);
          outcome='refused';
        }else{
          const meta={status:code,code:err instanceof OfficeRequestError?err.code:undefined};
          // Kept beside the request, so a refresh gives the same reason.
          try{localStorage.setItem(metaKey,JSON.stringify(meta));}catch{/* shown on this page anyway */}
          setPending({from:payload.from,to:payload.to,reprintOf:payload.reprintOf,...meta});
          outcome='uncertain';
        }
      }
      await refresh().catch(()=>{});
      return outcome;
    }
    finally{inFlight.current=false;setBusy(false);}
  };

  // --- One explicit "Send all N in K parts" ----------------------------------
  // Each part is checked, then sent with its own saved key, one after another.
  // It stops at the first part that isn't clearly queued, and the plan is
  // kept on this device so a closed page can send the rest later.
  const stopSeries=useRef(false);
  const runSeries=async(start:OfficePartsPlan)=>{
    if(seriesRunning.current || !printer)return;
    seriesRunning.current=true;stopSeries.current=false;clearRefusal();setNotice(null);setError('');
    let current=start;savePartsPlan(current);
    try{
      for(let i=current.next;i<current.parts.length;i++){
        if(stopSeries.current)break;
        const part=current.parts[i];
        // A part this device already tried resends its saved request (same
        // key). A part the office already has is skipped, never sent twice.
        let saved:string|null=null;try{saved=localStorage.getItem(storageKey);}catch{saved=null;}
        let resend=false;if(saved){try{const s=JSON.parse(saved);resend=s.from===part.from && s.to===part.to;}catch{resend=false;}}
        if(!resend && officeSendPlan(jobsRef.current,part.from,part.to).kind!=='new'){current={...current,next:i+1};savePartsPlan(current);continue;}
        setSeries({total:current.parts.length,index:i,part,phase:bitmap && !resend?'checking':'sending'});
        if(bitmap && !resend){
          setBusy(true);
          const checked=await drawProof(part,(completed,count)=>setSeries(s=>s?{...s,progress:{completed,total:count}}:s));
          setBusy(false);
          if(!checked)break;
          setSeries(s=>s?{...s,phase:'sending',progress:undefined}:s);
        }
        const outcome=await submit(part);
        if(outcome!=='sent')break;
        current={...current,next:i+1};savePartsPlan(current);
      }
      if(current.next>=current.parts.length){
        const first=current.parts[0],last=current.parts[current.parts.length-1];
        setNotice({text:queuedNotice(Range(first.from,last.to),first.from===last.to,status),at:Date.now(),queued:true});
      }
    }finally{seriesRunning.current=false;setSeries(null);setBusy(false);currentProofKey.current=proofKey;rangeEdited.current=false;}
  };
  const startSeries=()=>{
    if(!printer || parts.length<2)return;
    void runSeries({stationId:printer.station_id,printerId:printer.id,parts,next:0,at:new Date().toISOString()});
  };
  // A saved plan is offered again only while its parts are still unsent.
  const leftParts=useMemo(()=>{
    const left=remainingParts(partsPlan);
    if(!left.length || !requestsEverLoaded)return [];
    // Parts the office already has (a resend that did arrive) drop out.
    return left.filter(p=>officeSendPlan(jobs,p.from,p.to).kind==='new');
  },[partsPlan,jobs,requestsEverLoaded]);
  useEffect(()=>{if(partsPlan && requestsEverLoaded && !seriesRunning.current && remainingParts(partsPlan).length && !leftParts.length){setPartsPlan(null);try{localStorage.removeItem(partsKey);}catch{/* nothing saved */}}},[partsPlan,leftParts.length,requestsEverLoaded,partsKey]);
  const planPrinterHere=!!partsPlan && !!printer && partsPlan.stationId===printer.station_id && partsPlan.printerId===printer.id;
  // The unsure send is the next part of a saved plan: "Send again" resends it
  // (same key) and then carries on with the other parts.
  const planNext=partsPlan?partsPlan.parts[partsPlan.next]:undefined;
  const pendingInPlan=!!pending && planPrinterHere && !!planNext && planNext.from===pending.from && planNext.to===pending.to;
  const partsAfterPending=pendingInPlan?leftParts.filter(p=>!(p.from===pending?.from && p.to===pending?.to)):[];

  const startOver=async()=>{
    const ok=await confirmDialog({title:'Start over?',body:'Check the office queue below first. The office may already have these labels, and starting over doesn’t cancel anything.',confirmLabel:'Start over'});
    if(!ok)return;
    try{localStorage.removeItem(storageKey);localStorage.removeItem(metaKey);}catch{/* nothing saved */}setPending(null);setError('');
  };
  const act=async(action:()=>Promise<void>)=>{setBusy(true);setError('');try{await action();await refresh();}catch(err){setError(officeMessage(err,'That didn’t save. Try again in a moment.'));}finally{setBusy(false);}};
  const proofCurrent=!bitmap || proof?.key===proofKey;
  const cancelled=runStatus==='cancelled';
  // Parts the person already chose to print again sit in the form, not in the list.
  const failedParts=summary.failed.filter(p=>!(p.kind==='print-again' && reprintOf && rangeValid && p.from>=fromNumber && p.to<=toNumber));
  const holdsStation=failedParts.some(p=>p.kind!=='print-again');
  const waiting=officeWaitingSpans(jobs,total);
  const settled=nothingLeft && !reprintOf && !pending && !chooseAgain && failedParts.length===0;
  const cancelledIdle=cancelled && !chooseAgain && !pending && !reprintOf;
  const noAccess=!!shownRefusal && refusalNeedsSomeoneElse(shownRefusal.reason);
  const formAllowed=!settled && !cancelledIdle && !series && !leftParts.length && !noAccess && canPrint && !!printer && status.canSend && !status.stopped;
  const showForm=!!pending || (formAllowed && (!failedParts.length || sendOther || !!reprintOf));
  const formReady=requestsEverLoaded;
  const chooseEmpty=chooseAgain && !rangeValid;
  const disabled=pending?busy:(busy || !printAllowed || !formReady || !rangeValid || plan.kind==='wait' || (tooBig && parts.length<2));
  // One primary button on screen: the first problem's fix, else the main action.
  const owner:'problem'|'pending'|'refusal'|'parts'|'mark'|'form'|'none'=
    pending?'pending'
    :showForm && (sendOther || reprintOf || chooseAgain)?'form'
    :failedParts.length && canPrint?'problem'
    :shownRefusal && !noAccess?'refusal'
    :leftParts.length && planPrinterHere?'parts'
    :markRanges.length && !moving?'mark'
    :showForm?'form':'none';
  const primaryLabel=busy
    ?(preparationProgress?'Checking labels…':'Sending to office printer…')
    :pending?'Send again'
    :chooseEmpty?'Choose labels'
    :plan.kind==='wait'?'Waiting for office printer…'
    :tooBig && parts.length>1?`Send all ${sendCount.toLocaleString()} in ${parts.length} parts`
    :!proofCurrent?(plan.kind==='reprint'?'Check labels & print again':'Check labels & send')
    :plan.kind==='reprint'?`Print ${plural(sendCount)} again`
    :sentThisVisit?`Send the next ${plural(sendCount)}`
    :`Send ${plural(sendCount)} to office printer`;
  const onPrimary=async()=>{
    if(pending && pendingInPlan && partsPlan){void runSeries(partsPlan);return;}
    if(!pending){
      if(plan.kind==='wait' || !rangeValid)return;
      // Ask once per range before anything long starts: printing labels the
      // office already got again. Barcode and layout problems are checked on
      // the run page first (printAllowed), with the same words as the wizard.
      if(askedKey!==rangeKey){
        if(plan.kind==='reprint' && fixedRange.current!==`${fromNumber}-${toNumber}`){
          const one=fromNumber===toNumber;
          const ok=await confirmDialog({title:`Print ${range(fromNumber,toNumber)} again?`,body:`${Range(plan.overlap.from,plan.overlap.to)} went to the office printer before. ${one?'It prints':'They print'} again. The run’s progress doesn’t change.`,confirmLabel:'Print again'});
          if(!ok)return;
        }
        setAskedKey(rangeKey);
      }
      if(tooBig){if(parts.length>1)startSeries();return;}
    }
    if(!pending && !proofCurrent) void prepareProof(); else void submit();
  };
  const alreadyPrinted=!pending && plan.kind==='new' && rangeValid && fromNumber<=printedCount;

  // --- The printer: one status line ------------------------------------------
  const ownHold=!!status.hold && status.hold.run_id===runId;
  const lineTone:keyof typeof tone=ownHold?(failedParts.some(p=>p.kind==='did-not-print')?'bad':'warn'):status.tone;
  const lineText=ownHold?'Stopped until the labels below are checked.':status.text;
  const connection=<div className="space-y-3">
    {printers.length>1
      ? <div className="space-y-1"><span id={`${uid}-printer`} className="field-label">Office printer</span><CustomSelect aria-labelledby={`${uid}-printer`} value={selected} onChange={setSelected} options={printers.map(p=>({value:`${p.station_id}/${p.id}`,label:p.name}))} /></div>
      : !printer && <p className="text-sm text-zinc-300">{stationsLoaded?'No office printer is set up for your account.':'Looking for the office printer…'}</p>}
    {printer && <div className="flex min-h-control flex-wrap items-center justify-between gap-x-3 gap-y-2 text-sm">
      <div role="status" className="min-w-0 space-y-0.5">
        <p className={`flex items-start gap-2 ${tone[lineTone]}`}><span aria-hidden="true" className={`mt-1.5 size-2 shrink-0 rounded-full ${dotTone[lineTone]}`} /><span>{printers.length>1?'':<span className="text-zinc-300">{printer.name} · </span>}{lineText}</span></p>
        {status.hold && !ownHold && <p className="pl-4"><Link href={`/runs/${encodeURIComponent(status.hold.run_id)}`} className="font-medium text-zinc-100 underline underline-offset-2">Open that run</Link><span className="text-zinc-400"> to check {status.hold.from===status.hold.to?'it':'them'}.</span></p>}
      </div>
      {printer.dispatch_enabled && printer.paired_at!==null && <OfficePrinterControls onChange={()=>void refreshStations().catch(()=>{})} />}
    </div>}
    {printer && <div>
      <FoldToggle open={detailsOpen} onToggle={()=>setDetailsOpen(v=>!v)} controls={`${uid}-details`}>Connection details</FoldToggle>
      <Fold open={detailsOpen} id={`${uid}-details`}><p className="pb-2 text-sm text-zinc-400">{lastSeen(printer.last_seen)} · prints at {printer.dpi} dots per inch</p></Fold>
    </div>}
  </div>;

  // --- Fixing a part ----------------------------------------------------------
  const laterQueued=(part:OfficeFailedPart)=>{
    const cancellable=requests.filter(r=>r.jobs.some(j=>j.state==='queued' && j.from>part.to));
    const spans=jobs.filter(j=>j.state==='queued' && j.from>part.to).map(j=>({from:j.from,to:j.to}));
    const atOffice=jobs.filter(j=>['claimed','submitted'].includes(j.state) && !j.review && j.from>part.to).map(j=>({from:j.from,to:j.to}));
    return {cancellable,spans,atOffice};
  };
  /** Puts a part in the form as a reprint, already confirmed by the dialog. */
  const chooseReprint=(part:OfficeFailedPart,words:string)=>{
    const end=Math.min(part.to,part.from+cap-1);
    fixedRange.current=`${part.from}-${end}`;
    rangeEdited.current=true;setChooseAgain(false);setSendOther(false);setFrom(String(part.from));setTo(String(end));
    if(part.requestId)setReprintOf(part.requestId);
    if(words)setNotice({text:words,at:Date.now()});
  };
  const openFix=(part:OfficeFailedPart)=>{
    if(part.kind==='print-again'){chooseReprint(part,'');return;}
    setFix({part,choice:part.kind==='did-not-print'?'reprint':'',checked:false,note:'',order:'in-order'});
  };
  const fixWhy=(part:OfficeFailedPart)=>part.reason?plainJobReason(part.reason):part.kind==='did-not-print'?plainJobReason(null):'the office computer didn’t confirm them';
  const saveFix=()=>void act(async()=>{
    const current=fix;if(!current || !current.choice)return;
    const {part}=current;
    const later=laterQueued(part);
    const one=part.from===part.to;
    // 1. Hold later parts of this run first, before the check lets the office
    //    carry on, so the reprint comes out in order.
    let held:OfficeSpan[]=[];
    if(current.choice==='reprint' && current.order==='in-order' && later.cancellable.length){
      for(const r of later.cancellable)await api('/api/office/jobs/'+r.id,{method:'DELETE'});
      held=later.spans;
    }
    // 2. Record the check for each job that still needs one. A fresh read
    //    skips jobs already checked (by someone else, or by an earlier try).
    const fresh=await api('/api/office/jobs?runId='+encodeURIComponent(runId));
    const freshJobs:Array<{id:string;state:string;review:boolean}>=Array.isArray(fresh.jobs)?fresh.jobs:(Array.isArray(fresh.requests)?fresh.requests.flatMap((r:OfficeRequest)=>r.jobs):[]);
    const note=current.note.trim();
    const reason=(current.choice==='printed'
      ?`They printed: ${range(part.from,part.to)} counted as printed.`
      :`${capitalise(fixWhy(part))}. ${capitalise(range(part.from,part.to))} ${one?'is':'are'} printed again.`)+(note?` ${note}`:'');
    for(const jobId of part.jobIds){
      const job=freshJobs.find(j=>j.id===jobId);
      if(job && !job.review && ['resolved','cancelled','sent_to_printer'].includes(job.state))continue;
      try{await api('/api/office/review',{method:'POST',body:JSON.stringify({jobId,pendingCupsResolved:current.checked,reason:reason.slice(0,500)})});}
      catch(err){if(!(err instanceof OfficeRequestError && err.status===409))throw err;}
    }
    setFix(null);
    // 3. What the person chose.
    if(current.choice==='printed'){
      const ok=await onRecordPrinted?.([{from:part.from,to:part.to}],note) ?? false;
      setNotice({text:ok?`${Range(part.from,part.to)} counted as printed.${printedCount+1<part.from?` Progress catches up once ${range(printedCount+1,part.from-1)} ${printedCount+2===part.from?'is':'are'} counted too.`:''}`:`Saved at the office, but the run’s progress didn’t change. Use “Yes, mark printed” to count ${one?'it':'them'}.`,at:Date.now()});
      return;
    }
    chooseReprint(part,held.length
      ?`${capitalise(spanWords(held))} ${single(held)?'is':'are'} held. Send ${range(part.from,part.to)} now; ${spanWords(held)} come${single(held)?'s':''} next.`
      :`Saved. Now send ${range(part.from,part.to)} again.`);
  });

  const pendingWords=uncertainSendWords(pending?.status,pending?.code);
  const waitingWords=waiting.length?spanWords(waiting):'';
  const ownBlocking=failedParts.find(p=>p.kind!=='print-again');
  const movingLine=moving && !ownBlocking && !series
    ?(status.stopped?`${capitalise(waitingWords)} wait until the office printer’s check is done.`
      :status.paused?`${capitalise(waitingWords)} ${single(waiting)?'is':'are'} queued. The printer is paused, so nothing prints until someone taps Resume.`
      :printer && !printer.online?`${capitalise(waitingWords)} wait for the office computer to reconnect.`
      :null)
    :null;
  const fixLater=fix?laterQueued(fix.part):null;
  const markWords=spanWords(markRanges);
  return <div className="space-y-4">
    {connectionTarget && createPortal(connection,connectionTarget)}

    {/* Problems first: each part with its own state and its own fix. */}
    {!pending && failedParts.length>0 && <div role="alert" className="space-y-3 text-sm">
      {failedParts.map((part,i)=>{
        const bad=part.kind==='did-not-print';
        const text=bad?`${Range(part.from,part.to)} didn’t print: ${plainJobReason(part.reason)}.`
          :part.kind==='needs-check'?`${Range(part.from,part.to)} need${part.from===part.to?'s':''} a check: ${part.reason?plainJobReason(part.reason):'the office computer didn’t confirm them'}.`
          :`${Range(part.from,part.to)} ${part.from===part.to?'was':'were'} checked at the office but not printed again.`;
        const action=part.kind==='needs-check'?`Check ${nums(part.from,part.to)}…`:part.kind==='did-not-print'?`Print ${nums(part.from,part.to)} again…`:`Print ${nums(part.from,part.to)} again`;
        return <div key={`${part.requestId}-${part.from}-${part.kind}`} className="space-y-2">
          <p className={`flex items-start gap-2 font-medium ${bad?'text-red-400':'text-amber-300'}`}><AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{text}</p>
          {canPrint && <button type="button" disabled={busy} onClick={()=>openFix(part)} className={`btn ml-6 ${owner==='problem' && i===0?'btn-primary':'btn-secondary btn-sm'}`}>{action}</button>}
        </div>;
      })}
      {ownBlocking && waiting.length>0 && <p className="text-zinc-400">{capitalise(waitingWords)} {single(waiting)?'is':'are'} waiting until {range(ownBlocking.from,ownBlocking.to)} {ownBlocking.from===ownBlocking.to?'is':'are'} sorted.</p>}
      {!canPrint && stationsLoaded && <p className="text-zinc-400">Ask someone who can print to check the office printer.</p>}
      {canPrint && !holdsStation && formAllowed && !sendOther && !reprintOf && <button type="button" className="btn btn-ghost btn-sm -ml-2 text-zinc-300" onClick={()=>{setSendOther(true);rangeEdited.current=false;}}>Send other labels instead…</button>}
    </div>}

    {pending && <div role="status" className="space-y-1 text-sm text-amber-300">
      <p className="flex items-start gap-2 font-medium"><AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />We’re not sure the office got {range(pending.from,pending.to)}</p>
      <p className="pl-6">{pendingWords.message}</p>
    </div>}
    {shownRefusal && !pending && <div role="alert" className="space-y-2 text-sm text-amber-300">
      <p className="flex items-start gap-2 font-medium"><AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{Range(shownRefusal.from,shownRefusal.to)} {shownRefusal.from===shownRefusal.to?'wasn’t':'weren’t'} sent</p>
      <p className="pl-6">{noAccess?'Ask your admin for print access.':shownRefusal.message}</p>
      {owner==='refusal' && <button type="button" disabled={busy} className="btn btn-primary ml-6" onClick={()=>{const again=shownRefusal;clearRefusal();setFrom(String(again.from));setTo(String(again.to));rangeEdited.current=true;if(again.reason==='labels-changed')setProof(null);}}>Try again</button>}
    </div>}

    {series && <div role="status" className="space-y-2 text-sm">
      <p className="flex items-center gap-2 text-zinc-100 tabular-nums"><Loader2 className="size-4 animate-spin text-amber-400" aria-hidden="true" />Part {series.index+1} of {series.total}: {series.phase==='checking'?`checking ${range(series.part.from,series.part.to)}…`:`sending ${range(series.part.from,series.part.to)}…`}</p>
      {series.progress && <progress className="w-full accent-amber-500" max={series.progress.total} value={series.progress.completed} aria-label={`Checking part ${series.index+1}`} />}
      <p className="text-zinc-400">Keep this page open until the last part is queued.</p>
      <button type="button" onClick={()=>{stopSeries.current=true;}} className="btn btn-secondary btn-sm">Stop after this part</button>
    </div>}
    {!series && leftParts.length>0 && <div className="space-y-2 text-sm">
      {!pending && <p className="text-amber-300">{leftParts.length===1?`The last part (${range(leftParts[0].from,leftParts[0].to)}) wasn’t sent yet.`:`${leftParts.length} parts (${range(leftParts[0].from,leftParts[leftParts.length-1].to)}) weren’t sent yet.`}</p>}
      {pending
        ? <p className="text-zinc-400">{pendingInPlan?(partsAfterPending.length?`“Send again” then sends the other ${partsAfterPending.length===1?'part':`${partsAfterPending.length} parts`} (${range(partsAfterPending[0].from,partsAfterPending[partsAfterPending.length-1].to)}), one after another.`:'“Send again” finishes the last part.'):'Sort out the send above first, then send these.'}</p>
        : planPrinterHere
        ? <div className="flex flex-wrap items-center gap-2"><button type="button" disabled={busy || !canPrint || !status.canSend || !formReady || !printAllowed} onClick={()=>partsPlan && void runSeries(partsPlan)} className={`btn ${owner==='parts'?'btn-primary':'btn-secondary'}`}><PrinterIcon className="size-4" aria-hidden="true" />{leftParts.length===1?'Send the last part':`Send the remaining ${leftParts.length} parts`}</button><button type="button" className="btn btn-ghost btn-sm text-zinc-300" onClick={()=>savePartsPlan(null)}>Don’t send them</button></div>
        : <p className="text-zinc-400">They were planned for another office printer. <button type="button" className="font-medium underline underline-offset-2" onClick={()=>savePartsPlan(null)}>Forget them</button></p>}
    </div>}

    {movingLine && <p role="status" className="text-sm text-amber-300">{movingLine}</p>}
    {moving && !movingLine && !ownBlocking && !series && <p role="status" className="flex items-center gap-2 text-sm text-zinc-300 tabular-nums"><Loader2 className="size-4 animate-spin text-amber-400" aria-hidden="true" />{capitalise(waitingWords || plural(summary.onTheWay))} on {summary.onTheWay===1?'its':'their'} way to the office printer</p>}

    {/* Sent isn't printed: one question, one answer. */}
    {markRanges.length>0 && !series && onMarkPrinted && <div className="space-y-2 text-sm">
      <p className="text-zinc-100">Sent to the office printer: {markWords}. Did {single(markRanges)?'it':'they all'} come out?</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={()=>void onMarkPrinted()} className={`btn ${owner==='mark'?'btn-primary':'btn-secondary btn-sm'}`}><CheckCircle2 className="size-4" aria-hidden="true" />Yes, mark printed</button>
        {canPrint && status.canSend && <button type="button" disabled={busy || !printer} onClick={()=>{rangeEdited.current=true;setChooseAgain(true);setReprintOf('');setFrom('');setTo('');setNotice(null);}} className="btn btn-ghost btn-sm text-zinc-300">Some didn’t…</button>}
      </div>
    </div>}

    {settled && !series && !leftParts.length && <div className="space-y-3">
      {printedCount>=total
        ? <p role="status" className="flex min-h-control items-center gap-2 text-sm font-medium text-emerald-400"><CheckCircle2 className="size-4 rounded-full animate-success" aria-hidden="true" />All {total.toLocaleString()} labels printed</p>
        : !moving && !markRanges.length && <p role="status" className="text-sm text-zinc-300">Every label has gone to the office printer.</p>}
      {canPrint && printedCount>0 && <button type="button" disabled={busy} onClick={()=>{rangeEdited.current=true;setChooseAgain(true);setReprintOf('');setFrom('');setTo('');setNotice(null);}} className="btn btn-ghost btn-sm -ml-2 text-zinc-300"><RotateCcw className="size-4" aria-hidden="true" />Print some labels again…</button>}
    </div>}
    {cancelledIdle && !settled && <div className="space-y-2">
      <p className="text-sm text-zinc-300">This run was cancelled after {printedCount.toLocaleString()} of {total.toLocaleString()} labels.</p>
      {canPrint && <button type="button" disabled={busy} onClick={()=>{rangeEdited.current=true;setChooseAgain(true);setReprintOf('');setFrom('');setTo('');setNotice(null);}} className="btn btn-ghost btn-sm -ml-2 text-zinc-300">Print some labels anyway…</button>}
    </div>}
    {status.stopped && !ownHold && !pending && !settled && <p className="text-sm text-zinc-400">Sending waits until that check is done.</p>}
    {printer && !canPrint && stationsLoaded && <p className="text-sm text-zinc-400">Your account can’t send labels to the office printer. Ask your admin for print access.</p>}

    {showForm && <>
    {(chooseAgain || reprintOf || sendOther) && !pending && <div className="flex items-center justify-between gap-2 text-sm text-zinc-300"><span>{reprintOf?'Print these labels again.':chooseAgain?'Which labels? Type the first and last label number.':'Choose which labels to send.'}</span><button type="button" className="btn btn-ghost btn-sm" onClick={()=>{setChooseAgain(false);setReprintOf('');setSendOther(false);rangeEdited.current=false;}}>Cancel</button></div>}
    {/* "Send again" resends the saved request, so the range boxes step aside. */}
    {!pending && <div className="grid grid-cols-3 gap-2">
      <label className="text-xs font-medium text-zinc-400">From label<input className={inputClass+' mt-1'} inputMode="numeric" autoFocus={chooseAgain} disabled={!!pending || busy} value={from} onChange={e=>{rangeEdited.current=true;setFrom(e.target.value);}} /></label>
      <label className="text-xs font-medium text-zinc-400">Stop after label<input className={inputClass+' mt-1'} inputMode="numeric" disabled={!!pending || busy} value={to} onChange={e=>{rangeEdited.current=true;setTo(e.target.value);}} /></label>
      <label className="text-xs font-medium text-zinc-400">How many<input type="number" inputMode="numeric" min={1} max={Math.max(1,total-Number(from)+1)} disabled={!!pending || busy} className={inputClass+' mt-1'} value={rangeValid?sendCount:''} onChange={e=>{rangeEdited.current=true;const n=Number(e.target.value);if(Number(from)>=1 && n>=1)setTo(String(Math.min(total,Number(from)+Math.floor(n)-1)));}} /></label>
    </div>}
    {!pending && !rangeValid && from.trim()!=='' && to.trim()!=='' && <p role="alert" className="text-sm text-amber-300">Enter label numbers from 1 to {total.toLocaleString()}, with &ldquo;Stop after&rdquo; at or after &ldquo;From&rdquo;.</p>}
    {!pending && tooBig && parts.length>1 && <p className="text-sm text-zinc-400">The office printer takes up to {plural(cap)} of this design at a time. Each part is {bitmap?'checked, then ':''}queued, one after another.</p>}
    {!pending && tooBig && parts.length<2 && <div className="space-y-1 text-sm text-amber-300"><p>The office printer takes up to {plural(cap)} of this design in one send.</p><button type="button" className="btn btn-ghost btn-sm -ml-2 text-amber-300" onClick={()=>{rangeEdited.current=true;setTo(String(fromNumber+cap-1));}}>Send {nums(fromNumber,fromNumber+cap-1)} now</button></div>}
    {!pending && rangeValid && plan.kind==='wait' && <p role="status" className="text-sm text-zinc-400">{plan.why==='needs-check'?`${Range(plan.overlap.from,plan.overlap.to)} need a check first (see above).`:`${Range(plan.overlap.from,plan.overlap.to)} ${plan.overlap.from===plan.overlap.to?'is':'are'} still on the way to the office printer. Send these once ${plan.overlap.from===plan.overlap.to?'it’s':'they’re'} sent.`}</p>}
    {!pending && rangeValid && plan.kind==='reprint' && !tooBig && fixedRange.current!==`${fromNumber}-${toNumber}` && <p className="text-sm text-amber-300">{Range(plan.overlap.from,plan.overlap.to)} went to the office printer before, so this prints {plan.overlap.from===plan.overlap.to?'it':'them'} again.</p>}
    {!pending && alreadyPrinted && <div className="space-y-1 text-sm text-amber-300"><p>{Range(fromNumber,Math.min(toNumber,printedCount))} {fromNumber===Math.min(toNumber,printedCount)?'is':'are'} already counted as printed.</p>{printedCount<toNumber && <button type="button" className="btn btn-ghost btn-sm -ml-2 text-amber-300" onClick={()=>{rangeEdited.current=true;setFrom(String(printedCount+1));}}>Send {nums(printedCount+1,toNumber)} instead</button>}</div>}
    {!printAllowed && <p className="text-sm text-amber-300">{printBlockedReason || 'Sending is off until the problems above are fixed.'}</p>}
    {!formReady && !pending && <p role="status" className="text-sm text-zinc-400">Reading the office queue first…</p>}
    <button type="button" disabled={disabled} onClick={()=>void onPrimary()} className={`btn w-full ${owner==='form'||owner==='pending'?'btn-primary':'btn-secondary'}`}>{busy?<Loader2 className="size-4 animate-spin" />:<PrinterIcon className="size-4" />}{primaryLabel}</button>
    {pending && <button type="button" onClick={()=>void startOver()} disabled={busy} className="btn btn-ghost btn-sm -ml-2 text-zinc-300">Start over</button>}
    </>}
    {bitmap && showForm && !pending && preparationProgress && <div role="status" className="space-y-2 text-sm">
      <p className="text-zinc-300 tabular-nums">Checked {preparationProgress.completed.toLocaleString()} of {preparationProgress.total.toLocaleString()} labels… nothing is sent yet.</p>
      <progress className="w-full accent-amber-500" max={preparationProgress.total} value={preparationProgress.completed} aria-label="Checking labels" />
      <button type="button" onClick={()=>preparationController.current?.abort()} className="btn btn-secondary btn-sm">Stop checking</button>
    </div>}
    {bitmap && showForm && !pending && !preparationProgress && proofCurrent && proof && <p className="flex items-center gap-1.5 text-sm text-emerald-400"><CheckCircle2 className="size-4 rounded-full animate-success" aria-hidden="true" />{plural(proof.count)} checked. Nothing is sent until you tap Send.</p>}
    {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
    {requestsError && requestsError.status!==401 && requestsError.status!==403 && <p role="status" className="text-sm text-zinc-400">The office queue couldn’t be read just now. It tries again on its own.</p>}
    {/* The amber waiting line already says why queued labels aren't printing. */}
    {notice && !(notice.queued && movingLine) && <p role="status" className="text-sm text-emerald-400 animate-enter">{notice.text}</p>}
    {requests.length>0 && <div>
      <FoldToggle open={queueOpen} onToggle={()=>setQueueOpen(v=>!v)} controls={`${uid}-queue`}>Office queue <span className="tabular-nums">· {plural(summary.sent)} sent{summary.failedLabels?` · ${plural(summary.failedLabels)} need${summary.failedLabels===1?'s':''} attention`:''}</span></FoldToggle>
      <Fold open={queueOpen} id={`${uid}-queue`}>
      {requestsTruncated && <p className="pt-2 text-sm text-zinc-400">Showing the latest 100 sends.</p>}
      <ul className="max-h-96 overflow-y-auto space-y-4 pt-2 text-sm">
        {requests.map(r=><li key={r.id} className="space-y-1">
          <p className="font-medium text-zinc-100">Labels {nums(r.range_from,r.range_to)}{r.reprint_of?' · printed again':''}</p>
          <p className="text-zinc-400">{[formatWhen(r.created_at),r.username].filter(Boolean).join(' · ')}</p>
          <ul className="space-y-1">{r.jobs.map(j=><li key={j.id} className="text-zinc-300"><span className="tabular-nums">{nums(j.from,j.to)}</span>: {j.review && j.state!=='rejected'?'Needs a check':labels[j.state] ?? 'Unknown'}{j.reason && (j.review || ['rejected','needs_review'].includes(j.state)) && <span className="block text-zinc-400">{capitalise(plainJobReason(j.reason))}.</span>}
            {canPrint && (j.review || j.state==='needs_review') && <button type="button" disabled={busy} className="btn btn-ghost btn-sm -ml-2 block text-amber-300" onClick={()=>openFix({from:j.from,to:j.to,reason:j.reason,requestId:r.id,jobIds:[j.id],didNotPrint:j.state==='rejected',kind:j.state==='rejected'?'did-not-print':'needs-check'})}>Record what happened</button>}
          </li>)}</ul>
          <div className="flex flex-wrap gap-1 -ml-2">
            {canPrint && r.jobs.some(j=>j.state==='queued') && <button type="button" disabled={busy} className="btn btn-ghost btn-sm text-amber-300" onClick={()=>void act(async()=>{const result=await api('/api/office/jobs/'+r.id,{method:'DELETE'});setNotice({text:`Cancelled ${result.cancelled} part${result.cancelled===1?'':'s'} that hadn’t been picked up. ${result.requires_review ? `${result.requires_review} part${result.requires_review===1?' was':'s were'} already picked up and need someone to check the printer; nothing was stopped at the office.` : ''}`.trim(),at:Date.now()});})}>Cancel what hasn&apos;t been picked up</button>}
            {canPrint && r.jobs.every(j=>!j.review && !['queued','claimed','submitted','needs_review','rejected'].includes(j.state)) && <button type="button" className="btn btn-ghost btn-sm text-zinc-300" onClick={()=>{rangeEdited.current=true;setReprintOf(r.id);setChooseAgain(false);setFrom(String(r.range_from));setTo(String(Math.min(r.range_to,r.range_from+cap-1)));}}>Print again</button>}
          </div>
        </li>)}
      </ul>
      </Fold>
    </div>}
    <Dialog open={!!fix} onClose={()=>setFix(null)} title={fix?(fix.part.kind==='did-not-print'?`Print ${range(fix.part.from,fix.part.to)} again?`:`What happened to ${range(fix.part.from,fix.part.to)}?`):''} dismissible={!busy}>
      {fix && <>
        <p className="text-sm text-zinc-300">{fix.part.kind==='did-not-print'?`The office computer said ${plainJobReason(fix.part.reason)}. Fix that first, for example by loading labels.`:'The office computer didn’t confirm these. Look at what came out of the printer.'}</p>
        {fix.part.kind==='needs-check' && <fieldset className="space-y-1">
          <legend className="sr-only">What happened</legend>
          {([['printed',`They printed. Count ${range(fix.part.from,fix.part.to)} as printed.`],['reprint','They didn’t print. Print them again.']] as const).map(([value,text],i)=>(
            <label key={value} className="flex min-h-control cursor-pointer items-center gap-3 rounded-lg px-2 text-sm text-zinc-100 hover:bg-zinc-800">
              <input type="radio" name={`${uid}-fix`} value={value} checked={fix.choice===value} data-autofocus={i===0?true:undefined} onChange={()=>setFix(f=>f?{...f,choice:value}:f)} className="size-4 accent-amber-500" />{text}
            </label>))}
        </fieldset>}
        {fix.choice==='reprint' && fixLater && (fixLater.spans.length>0 || fixLater.atOffice.length>0) && <div className="space-y-1 text-sm">
          {fixLater.atOffice.length>0 && <p className="text-zinc-300">{capitalise(spanWords(fixLater.atOffice))} {single(fixLater.atOffice)?'is':'are'} already at the office and print{single(fixLater.atOffice)?'s':''} first.</p>}
          {fixLater.spans.length>0 && <fieldset className="space-y-1">
            <legend className="text-zinc-300">{capitalise(spanWords(fixLater.spans))} {single(fixLater.spans)?'is':'are'} waiting behind this part.</legend>
            {([['in-order',`Print in order: hold ${spanWords(fixLater.spans)}, print ${range(fix.part.from,fix.part.to)} again, then send the rest.`],['let-run',`Let ${spanWords(fixLater.spans)} print first. ${capitalise(range(fix.part.from,fix.part.to))} come${fix.part.from===fix.part.to?'s':''} out after.`]] as const).map(([value,text])=>(
              <label key={value} className="flex min-h-control cursor-pointer items-center gap-3 rounded-lg px-2 text-zinc-100 hover:bg-zinc-800">
                <input type="radio" name={`${uid}-order`} value={value} checked={fix.order===value} data-autofocus={fix.part.kind==='did-not-print' && value==='in-order'?true:undefined} onChange={()=>setFix(f=>f?{...f,order:value}:f)} className="size-4 accent-amber-500" />{text}
              </label>))}
          </fieldset>}
        </div>}
        <label className="flex min-h-control cursor-pointer items-center gap-3 rounded-lg px-2 text-sm text-zinc-100 hover:bg-zinc-800"><input type="checkbox" className="size-4 shrink-0 accent-amber-500" checked={fix.checked} data-autofocus={fix.part.kind==='did-not-print' && !(fixLater && fixLater.spans.length)?true:undefined} onChange={e=>setFix(f=>f?{...f,checked:e.target.checked}:f)} />I checked: nothing for {range(fix.part.from,fix.part.to)} is still waiting to print at the office.</label>
        <label className="block text-sm text-zinc-300">Note for the print history (optional)
          <textarea className={inputClass+' mt-1 text-sm'} rows={2} maxLength={300} value={fix.note} onChange={e=>setFix(f=>f?{...f,note:e.target.value}:f)} />
        </label>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn btn-secondary" onClick={()=>setFix(null)}>Cancel</button>
          <button type="button" disabled={busy || !fix.checked || !fix.choice} className="btn btn-primary" onClick={saveFix}>Continue</button>
        </div>
      </>}
    </Dialog>
  </div>;
}
