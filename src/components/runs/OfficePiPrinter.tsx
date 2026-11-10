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
import { choiceDialog, confirmDialog } from '@/components/ui/feedback';
import { setOfficeSeriesRunning } from '@/lib/printNavigation';
import { labelListWords, scannedSkipPlan } from '@/lib/scannedLabels';
import { friendlyError, friendlyRenderError } from '@/lib/userMessages';
import { drawFailureWords } from '@/lib/officeSendOutcome';
import { parseLabelList, OFFICE_IN_PROGRESS, officeQueuedRequestIds, capAfterSizeError, firstUnsentLabel, isValidOfficeRange, officeProofKey, officeSendCap, officeSendParts, officeSendPlan, officeUnsentSpans, officeWaitingSpans, partsAfterPrinted, partCarriesEndBlank, readPartsPlan, readHeldSpans, heldStillUnsent, remainingParts, spanWords, suggestOfficeRange, OFFICE_BITMAP_LABELS_PER_SEND, OFFICE_MAX_LABELS, type OfficeDeliverySummary, type OfficeFailedPart, type OfficePartsPlan, type OfficeSendPlan, type OfficeSpan } from '@/lib/officeRange';
import { officeFailureKind, officeStatusLine, plainJobReason, plainOfficeRefusal, queuedNotice, readPendingMeta, readRefusal, readSavedOfficeRequest, refusalNeedsSomeoneElse, refusalNextStep, refusalStillApplies, sendKeepsRequest, unconfirmedSendWords, type OfficeRefusalRecord, type OfficeReviewHold } from '@/lib/officeSendOutcome';
import { officeProblemWords } from '@/lib/officeProblem';
import { intersectSpans } from '@/lib/runProgress';
import type { OfficeJobBrief, OfficeRequest } from './useOfficeRequests';
import { readOfficeJobs } from './officeCancel';
import { useRunStore } from '@/lib/runStore';
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
// Word joiners keep "41–60" on one line on a phone.
const nums=(a:number,b:number)=>a===b?a.toLocaleString():`${a.toLocaleString()}\u2060–\u2060${b.toLocaleString()}`;
const range=(a:number,b:number)=>a===b?`label ${a.toLocaleString()}`:`labels ${nums(a,b)}`;
const Range=(a:number,b:number)=>a===b?`Label ${a.toLocaleString()}`:`Labels ${nums(a,b)}`;
const capitalise=(text:string)=>text.charAt(0).toUpperCase()+text.slice(1);
const single=(spans:ReadonlyArray<OfficeSpan>)=>spans.length===1 && spans[0].from===spans[0].to;
/** Touching parts in the same state read as one line ("1–1,900: Sent to the printer"); parts that need someone stay on their own. */
function foldJobs<J extends {id:string;from:number;to:number;state:string;review?:boolean;reason?:string|null}>(jobs:ReadonlyArray<J>,attention:(j:J)=>boolean):J[]{
  const out:J[]=[];
  for(const job of [...jobs].sort((a,b)=>a.from-b.from)){
    const last=out[out.length-1];
    if(last && !attention(last) && !attention(job) && last.state===job.state && job.from===last.to+1)out[out.length-1]={...last,to:job.to};
    else out.push(job);
  }
  return out;
}
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
/** endBlank: the saved request ends with one blank label (as saved, never changed on a resend). */
type Pending={from:number;to:number;reprintOf?:string;endBlank?:boolean;status?:number;code?:string};
type SendOutcome='sent'|'refused'|'uncertain'|'skipped';
type Series={total:number;index:number;part:OfficeSpan;phase:'checking'|'sending';progress?:{completed:number;total:number}};
/** The person's answer in the fix dialog. */
/**
 * seen: what the person saw come out after fixing the printer.
 * againText: with "some", the labels that didn't come out, typed like every other "which labels" box.
 */
type Fix={part:OfficeFailedPart;seen:''|'all'|'some'|'none';againText:string;note:string;order:'in-order'|'let-run';
  /** "Feed one blank label" for this fix only: off until ticked here, and fed only after the plan's last label. */
  blank:boolean};
/**
 * The one "which labels?" box: labels that didn't come out ("Some didn’t…"),
 * labels to print again (a finished run, or one send in the office queue).
 * queue: labels still to send from the person's list, one tap each.
 */
type Again={mode:'missing'|'again';text:string;queue:OfficeSpan[];requestId?:string;sent?:OfficeSpan;
  /** "Feed one blank label" for these labels only: off until ticked, and fed only after the last stretch. */
  blank:boolean};
const tone={bad:'text-red-400',warn:'text-amber-300',ok:'text-emerald-400'} as const;
/** Runs with a "Send all in parts" series going in this tab: one series per run at a time. */
const seriesLocks=new Set<string>();
const dotTone={bad:'bg-red-400',warn:'bg-amber-300',ok:'bg-emerald-400'} as const;
/**
 * "A send is on its way from this tab right now", for other tabs and for the
 * next page in this tab after a reload: its own key (lw:office-sending:<run>),
 * never a field in the saved request, so main and older builds read the saved
 * request exactly as before. The sending tab renews `until` while it waits.
 */
const SENDING_MARK_MS=12_000;
type SendingMark={key:string;from:number;to:number;tab:string;until:number};
function readSendingMark(raw:string|null):SendingMark|null{
  try{const m=raw?JSON.parse(raw):null;return m && typeof m.key==='string' && typeof m.tab==='string' && Number.isFinite(m.until)?m as SendingMark:null;}catch{return null;}
}
/** This browser tab's id: the same after a reload of this tab, different in another tab. */
function browserTabId(){
  try{let id=sessionStorage.getItem('lw:tab-id');if(!id){id=crypto.randomUUID();sessionStorage.setItem('lw:tab-id',id);}return id;}
  catch{return 'tab-'+Math.random().toString(36).slice(2);}
}
/** How long a page that finds a saved send (and didn't make the POST) looks it up before saying "not sure" (when the lookup can't answer). */
const CHECK_MS=10_000;
/** The send's POST gives up a little after the route's maxDuration (300 s). */
const OFFICE_POST_TIMEOUT_MS=310_000;
/**
 * Runs `fn` under a Web Lock shared by every tab of this run, so checking for
 * a saved send and saving a new one happen as one step. Without Web Locks (or
 * if the browser refuses the lock) it runs `fn` as before, never twice.
 */
async function withOfficeSendLock<T>(runId:string,fn:()=>T):Promise<T>{
  let ran=false;
  try{
    if(typeof navigator!=='undefined' && navigator.locks?.request)return await navigator.locks.request(`lw-office-send:${runId}`,()=>{ran=true;return fn();}) as T;
  }catch(error){if(ran)throw error;}
  return fn();
}
/** Is the send saved under this key at the office? The request id, null when not, undefined when it couldn't be read. */
async function lookUpSend(runId:string,key:string):Promise<string|null|undefined>{
  try{
    const response=await fetch(`/api/office/jobs?runId=${encodeURIComponent(runId)}&key=${encodeURIComponent(key)}`,{cache:'no-store'});
    if(!response.ok)return undefined;
    const data=await response.json().catch(()=>null) as {keyRequestId?:unknown}|null;
    if(!data || !('keyRequestId' in data))return undefined;
    return typeof data.keyRequestId==='string'?data.keyRequestId:null;
  }catch{return undefined;}
}
/**
 * "Feed one blank label after label N", for one send only. It sits under a
 * small "More options" fold below the send button, so it is never the thing
 * ticked by accident on the way to Send, and a ticked box says so on the
 * fold's own line even when the fold is shut.
 */
function BlankOption({id,checked,disabled,onChange,after,inParts=false,firstHadBlank=false}:{id:string;checked:boolean;disabled?:boolean;onChange:(value:boolean)=>void;
  /** The label the blank follows, when known. */
  after?:number;
  /** The send goes in parts: the blank follows the last part only. */
  inParts?:boolean;
  /** The send being fixed ended with a blank label: said in one visible line (still unticked), never folded away. */
  firstHadBlank?:boolean}){
  const [open,setOpen]=useState(false);
  const where=after?`after label ${after.toLocaleString()}`:'after the last one';
  if(firstHadBlank)return <label className="flex cursor-pointer items-start gap-3 text-sm text-zinc-100">
    <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-amber-500" checked={checked} disabled={disabled} onChange={e=>onChange(e.target.checked)} />
    <span>Your first send ended with a blank label. Add one {where}?</span>
  </label>;
  return <div className="-mt-1">
    <FoldToggle open={open} onToggle={()=>setOpen(v=>!v)} controls={`${id}-more`}>{checked && !open?<>More options<span className="text-zinc-300"> · one blank label {where}</span></>:'More options'}</FoldToggle>
    <Fold open={open} id={`${id}-more`}>
      <label className="flex cursor-pointer items-start gap-3 pb-1 text-sm text-zinc-100">
        <input type="checkbox" aria-describedby={`${id}-help`} className="mt-0.5 size-4 shrink-0 accent-amber-500" checked={checked} disabled={disabled} onChange={e=>onChange(e.target.checked)} />
        <span>Feed one blank label {where}<span id={`${id}-help`} className="block text-zinc-400">Useful for tearing off.{inParts?' Only after the last part.':''} Counts don’t change.</span></span>
      </label>
    </Fold>
  </div>;
}
export function OfficePiPrinter({runId,total,connectionTarget,run,template,format,printAllowed=true,printedCount=0,runStatus,requests,jobs,summary,requestsLoaded,requestsEverLoaded=requestsLoaded,requestsTruncated=false,requestsError,refreshRequests,printBlockedReason='',markRanges=[],onMarkPrinted,onRecordPrinted,onHeldChange,scannedLabels=[],openChooser=0,toGo,toGoShown=false,onPanelState,onRangeChange}:{runId:string;total:number;connectionTarget:HTMLDivElement|null;run?:Run;template?:LabelTemplate;format?:LabelFormat;printAllowed?:boolean;
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
  /**
   * Why sending is off when printAllowed is false, when the page doesn't
   * already say it right above (empty: the barcode or layout check above
   * says it once, with its own tick, so nothing is repeated here).
   */
  printBlockedReason?:string;
  /** Stretches the office reported sent that aren't counted as printed yet. */
  markRanges?:OfficeSpan[];
  /** Asks once, then counts every sent stretch as printed. */
  onMarkPrinted?:()=>Promise<void>;
  /** Counts labels a person saw come out (a part the office never confirmed) as printed. */
  onRecordPrinted?:(ranges:OfficeSpan[],note:string)=>Promise<boolean>;
  /** Tells the run header when the chosen office printer is paused or stopped (and by which other run), so it never says "Sending". */
  onHeldChange?:(held:boolean,heldBy?:{runId:string;runName:string}|null)=>void;
  /** Labels already printed by scanning (scan mode), so a send can leave them out. */
  scannedLabels?:ReadonlyArray<number>;
  /** Goes up when the run page's "Print some labels again…" asks this panel to start choosing labels. */
  openChooser?:number;
  /** Labels not counted as printed yet (progress and print history). */
  toGo?:ReadonlyArray<OfficeSpan>;
  /** The progress line above already names what is still to go: not said again here. */
  toGoShown?:boolean;
  /** Tells the run header what this panel says (a send it isn't sure arrived, a refused send, a paused printer), so both say the same. */
  onPanelState?:(state:{unsure:OfficeSpan|null;refused:OfficeSpan|null;paused:boolean;sending:string|null;held?:OfficeSpan|null})=>void;
  /** The labels the main button sends next (null when none), so the run page's "Print anyway" ticks name the same range. */
  onRangeChange?:(span:OfficeSpan|null)=>void}){
  const uid=useId();
  const [printers,setPrinters]=useState<Printer[]>([]);const [selected,setSelected]=useState('');
  const [stationsLoaded,setStationsLoaded]=useState(false);const [canPrint,setCanPrint]=useState(false);
  const [from,setFrom]=useState('1');const [to,setTo]=useState(String(total));
  const [error,setError]=useState('');
  // tone 'next' is an instruction (what to do now), not a success.
  const [notice,setNotice]=useState<{text:string;requestId?:string;at:number;queued?:boolean;tone?:'next'}|null>(null);
  const [busy,setBusy]=useState(false);
  const [pending,setPending]=useState<Pending|null>(null);
  // "Feed one blank label at the end": off until the person ticks it, and off
  // again after every send that went through, so a blank never lands between
  // two sends of the same roll. A saved request keeps the choice it was sent
  // with for its own resend, whatever the box says, and never changes the box.
  const [endBlank,setEndBlank]=useState(false);
  // The single POST is on its way from this tab right now. Its saved request
  // (and key) exist already, but it isn't "not sure" until the answer is lost.
  const [posting,setPosting]=useState(false);
  // A saved send this page didn't POST (a reload, a second tab): 'other' while
  // another tab is still sending it, 'checking' while this page looks it up
  // at the office, 'unsure' only once nothing is on its way and the office
  // doesn't show it.
  const [pendingPhase,setPendingPhase]=useState<'checking'|'other'|'unsure'>('checking');
  const unsure=!!pending && !posting && pendingPhase==='unsure';
  /** Keys whose try this page saw fail: only then may the words blame the connection. */
  const seenFail=useRef<Set<string>>(new Set());
  const tabId=useRef('');
  useEffect(()=>{tabId.current=browserTabId();},[]);
  // A send the server definitely refused. Kept on this device so a refresh
  // still says what happened, until live status says otherwise.
  const [refusal,setRefusal]=useState<OfficeRefusalRecord|null>(null);
  const [again,setAgain]=useState<Again|null>(null);
  // The panel's own box (not a queue row's) stands in for the panel's other actions.
  const chooseAgain=!!again && !again.requestId;
  const [sendOther,setSendOther]=useState(false);
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
  const stopSeries=useRef(false);
  // "Stop" was pressed during this series: the button says it registered.
  const [stopAsked,setStopAsked]=useState<string|null>(null);
  // A one-tap send (resend after a refusal, a reprint from the fix dialog or a
  // queue row) sets the range and checks it in the same tap: don't cancel that check.
  const directRunning=useRef(false);
  useEffect(()=>()=>{if(!seriesRunning.current && !directRunning.current)preparationController.current?.abort();},[proofKey]);
  const inFlight=useRef(false);
  const rangeEdited=useRef(false);
  /** The range someone just chose in the fix dialog: that dialog was the ask. */
  const fixedRange=useRef('');
  const fromNumber=Number(from),toNumber=Number(to);
  const rangeValid=isValidOfficeRange(from,to,total);
  const refusedKey=`lw:office-refused:${runId}`;
  const metaKey=`lw:office-pending-meta:${runId}`;
  const partsKey=`lw:office-parts:${runId}`;
  const heldKey=`lw:office-held:${runId}`;
  // The last label of a "Print in order" fix's held labels, when the person
  // asked for one blank label at the end of that fix: the held send carries it.
  const heldBlankKey=`lw:office-held-blank:${runId}`;
  // Sends from this device that ended with a blank label (request ids), so a
  // fix of one of them can say so. This build's own key; nothing else reads it.
  const blankSendsKey=`lw:office-blank-sends:${runId}`;
  const sentWithBlank=(requestId?:string|null)=>{
    if(!requestId)return false;
    try{const list=JSON.parse(localStorage.getItem(blankSendsKey) || '[]');return Array.isArray(list) && list.includes(requestId);}catch{return false;}
  };
  const rememberBlankSend=(requestId:string)=>{
    try{const list=JSON.parse(localStorage.getItem(blankSendsKey) || '[]');const next=[...(Array.isArray(list)?list:[]).filter((id:unknown)=>id!==requestId),requestId].slice(-50);localStorage.setItem(blankSendsKey,JSON.stringify(next));}catch{/* only the reminder is lost */}
  };
  const printedRef=useRef(printedCount);
  useEffect(()=>{printedRef.current=printedCount;},[printedCount]);
  // The run's status as this page last read it: a "Send all in parts" never starts another part once it is cancelled.
  const runStatusRef=useRef(runStatus);
  useEffect(()=>{
    runStatusRef.current=runStatus;
    // Cancelled or finished while parts are going (here or on another device): stop after the part on its way now.
    if((runStatus==='cancelled' || runStatus==='completed') && seriesRunning.current){stopSeries.current=true;preparationController.current?.abort();}
  },[runStatus]);
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
      else setError(drawFailureWords(e,target) ?? friendlyRenderError(friendlyError(e,'Checking the labels failed.'),template.elements,format.labelsAcross||1));
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
  const [queueOpen,setQueueOpen]=useState(false);
  // The printer's own pause state, from Pause/Resume: shown at once, before the next stations read.
  const [controlPaused,setControlPaused]=useState<boolean|null>(null);
  // Sends whose parts are listed one by one (a big send folds to one line).
  const [openSends,setOpenSends]=useState<ReadonlySet<string>>(()=>new Set());
  // Persist a submission identity before network I/O. An uncertain response,
  // reload or double-click retries this identity, never manufactures new jobs.
  const jobsRef=useRef(jobs);
  useEffect(()=>{jobsRef.current=jobs;},[jobs]);
  const storageKey=`lw:office-pending:${runId}`;
  const sendingKey=`lw:office-sending:${runId}`;
  const [partsPlan,setPartsPlan]=useState<OfficePartsPlan|null>(null);
  // Labels a "Print in order" fix cancelled for now, offered again after the reprint.
  const [heldSpans,setHeldSpans]=useState<OfficeSpan[]>([]);
  const [heldBlankAt,setHeldBlankAt]=useState<number|null>(null);
  useEffect(()=>{
    let saved:string|null=null;try{saved=localStorage.getItem(storageKey);}catch{saved=null;}
    if(saved){
      // Also a request saved by main's panel (same key and fields): it resumes as itself.
      const data=readSavedOfficeRequest(saved);
      if(data && data!=='unreadable'){let meta:string|null=null;try{meta=localStorage.getItem(metaKey);}catch{meta=null;}setPending({...data,...readPendingMeta(meta)});setFrom(String(data.from));setTo(String(data.to));setReprintOf(data.reprintOf || '');}
      else setError('The saved request on this device couldn’t be read. Check the office queue below before starting over.');
    }
    else{let refused:string|null=null;try{refused=localStorage.getItem(refusedKey);}catch{refused=null;}setRefusal(readRefusal(refused));}
    let plan:string|null=null;try{plan=localStorage.getItem(partsKey);}catch{plan=null;}
    setPartsPlan(readPartsPlan(plan));
    let held:string|null=null;try{held=localStorage.getItem(heldKey);}catch{held=null;}
    setHeldSpans(readHeldSpans(held,total));
    let heldBlank:string|null=null;try{heldBlank=localStorage.getItem(heldBlankKey);}catch{heldBlank=null;}
    const at=Number(heldBlank);setHeldBlankAt(heldBlank && Number.isInteger(at) && at>=1 && at<=total?at:null);
  },[storageKey,refusedKey,metaKey,partsKey,heldKey,heldBlankKey,total]);
  const saveHeldBlank=(at:number|null)=>{
    setHeldBlankAt(at);
    try{if(at)localStorage.setItem(heldBlankKey,String(at));else localStorage.removeItem(heldBlankKey);}catch{/* the page still shows it */}
  };
  const saveHeld=(spans:OfficeSpan[])=>{
    setHeldSpans(spans);
    try{if(spans.length)localStorage.setItem(heldKey,JSON.stringify(spans));else localStorage.removeItem(heldKey);}catch{/* the page still shows it */}
    if(!spans.length)saveHeldBlank(null);
  };
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
  const liveStatus=officeStatusLine(printer,runId);
  // Pause/Resume confirmed by the printer reads "Paused" right away.
  const status=controlPaused && !liveStatus.paused && !liveStatus.stopped && printer?.online && printer.dispatch_enabled && printer.paired_at
    ?{...liveStatus,paused:true,tone:'warn' as const,text:'Paused: nothing new prints until someone resumes it.'}:liveStatus;
  const moving=summary.onTheWay>0;
  const printerHeld=!!printer && (status.stopped || status.paused);
  const heldByRun=status.stopped && status.hold && status.hold.run_id!==runId?status.hold:null;
  const heldById=heldByRun?.run_id ?? '',heldByName=heldByRun?.run_name ?? '';
  useEffect(()=>{onHeldChange?.(printerHeld,heldById?{runId:heldById,runName:heldByName}:null);},[printerHeld,heldById,heldByName,onHeldChange]);
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

  // --- A saved send this page didn't make ---------------------------------
  // Another tab starts, finishes or clears a send: this page follows it,
  // instead of keeping what it read when it opened.
  const [markSeen,setMarkSeen]=useState(0);
  useEffect(()=>{
    const onStorage=(event:StorageEvent)=>{
      if(event.key===sendingKey){setMarkSeen(n=>n+1);return;}
      if(event.key!==storageKey || inFlight.current)return;
      const data=readSavedOfficeRequest(event.newValue);
      if(!data){setPending(null);setPendingPhase('checking');void refresh().catch(()=>{});return;}
      if(data==='unreadable')return;
      let meta:string|null=null;try{meta=localStorage.getItem(metaKey);}catch{meta=null;}
      setPending({...data,...readPendingMeta(meta)});setFrom(String(data.from));setTo(String(data.to));setReprintOf(data.reprintOf || '');
    };
    window.addEventListener('storage',onStorage);
    return()=>window.removeEventListener('storage',onStorage);
  },[storageKey,sendingKey,metaKey,refresh]);
  /** The saved send's key, or '' when none (or unreadable). */
  const savedKey=useCallback(()=>{
    try{const raw=localStorage.getItem(storageKey);const key=raw?JSON.parse(raw)?.idempotencyKey:'';return typeof key==='string'?key:'';}catch{return '';}
  },[storageKey]);
  const pendingFrom=pending?.from,pendingTo=pending?.to;
  // The key lookup couldn't answer (an older server that ignores `key`, or no
  // connection): then this page can't say the office doesn't have the send.
  const [lookupMissing,setLookupMissing]=useState(false);
  // A send in the office queue with exactly the saved send's labels: what the
  // page can tell when the key lookup can't answer.
  const pendingReprintOf=pending?.reprintOf ?? '';
  const queueHasPending=pendingFrom!==undefined && requests.some(r=>r.range_from===pendingFrom && r.range_to===pendingTo && (r.reprint_of ?? '')===pendingReprintOf);
  const queueHasPendingRef=useRef(queueHasPending);
  useEffect(()=>{queueHasPendingRef.current=queueHasPending;},[queueHasPending]);
  useEffect(()=>{
    if(pendingFrom===undefined || pendingTo===undefined || posting)return;
    const key=savedKey();
    if(!key){setPendingPhase('unsure');return;}
    let active=true;let timer:ReturnType<typeof setTimeout>|undefined;
    const started=Date.now();
    // This page saw the try fail: say so now, and still look it up now and
    // then, so a send that did arrive clears on its own.
    let phase:'checking'|'other'|'unsure'=seenFail.current.has(key)?'unsure':'checking';
    setPendingPhase(phase);
    const tick=async()=>{
      if(typeof document!=='undefined' && document.visibilityState==='hidden'){timer=setTimeout(()=>void tick(),3000);return;}
      let mark:SendingMark|null=null;try{mark=readSendingMark(localStorage.getItem(sendingKey));}catch{mark=null;}
      const live=!!mark && mark.key===key && mark.until>Date.now();
      // A mark from this same tab is the page before a reload: that try may
      // still reach the office, so this page keeps checking until it lapses.
      const otherTab=live && mark!.tab!==tabId.current;
      const found=await lookUpSend(runId,key);
      if(!active)return;
      // Found at the office: settled, even while another tab still waits for
      // its answer (the POST landed; that tab gets the same request back).
      if(found){
        // At the office: the same as a good answer. Cleared only while it is
        // still the same saved send.
        if(savedKey()===key){try{localStorage.removeItem(storageKey);localStorage.removeItem(metaKey);}catch{/* nothing saved */}}
        setPending(null);setPendingPhase('checking');
        setNotice({text:`${Range(pendingFrom,pendingTo)} ${pendingFrom===pendingTo?'is':'are'} at the office.`,requestId:found,at:Date.now(),queued:true});
        void refresh().catch(()=>{});
        return;
      }
      setLookupMissing(found===undefined);
      if(phase!=='unsure' || otherTab){
        // Another tab's send: shown as such until it answers, its mark lapses,
        // or (when the lookup can't answer) the queue lists those labels.
        if(otherTab && !(found===undefined && queueHasPendingRef.current))phase='other';
        // This tab's own mark from before a reload: that try may still arrive.
        else if(live && !otherTab)phase='checking';
        // The office answered that it doesn't have it, and nothing is on its way.
        else if(found===null)phase='unsure';
        // The lookup couldn't answer: look again for a little while first.
        else phase=Date.now()-started<CHECK_MS && !queueHasPendingRef.current?'checking':'unsure';
      }
      setPendingPhase(phase);
      timer=setTimeout(()=>void tick(),phase==='unsure'?15_000:3000);
    };
    void tick();
    return()=>{active=false;if(timer)clearTimeout(timer);};
  },[pendingFrom,pendingTo,posting,markSeen,savedKey,sendingKey,storageKey,metaKey,runId,refresh]);

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
  // "Print some labels again…" on the run's summary: start with an empty range.
  // Only one "which labels?" box is ever open: opening it closes the others.
  const openAgain=(mode:Again['mode'],requestId?:string)=>{setAgain({mode,text:'',queue:[],requestId,blank:false});setReprintOf('');setSendOther(false);setNotice(null);setError('');};
  useEffect(()=>{if(openChooser>0)openAgain('again');},
    [openChooser]);
  // Held labels still to send (not printed, not on their way again).
  const heldUnsent=useMemo(()=>requestsEverLoaded?heldStillUnsent(heldSpans,jobs,printedCount,total):[],[requestsEverLoaded,heldSpans,jobs,printedCount,total]);
  // Held labels sent again and still on their way: the next send waits for
  // them, so nothing new is started (or marked) ahead of them.
  const heldMoving=useMemo(()=>requestsEverLoaded && heldSpans.length
    ?officeWaitingSpans(jobs.filter(j=>OFFICE_IN_PROGRESS.includes(j.state) && !j.review && heldSpans.some(h=>j.from<=h.to && j.to>=h.from)),total):[],[requestsEverLoaded,heldSpans,jobs,total]);
  useEffect(()=>{if(heldSpans.length && requestsEverLoaded && !busy && !heldUnsent.length && !heldMoving.length)saveHeld([]);},
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [heldSpans.length,requestsEverLoaded,busy,heldUnsent.length,heldMoving.length]);
  const heldNext=heldUnsent[0];
  // The whole held stretch: bigger than one send, it goes as "Send all … in N parts".
  const heldOffer=heldNext?{from:heldNext.from,to:heldNext.to}:null;
  const heldFrom=heldOffer?.from,heldTo=heldOffer?.to;
  // Suggest the next labels to send: the labels a "Print in order" fix held
  // back come first; otherwise after everything printed anywhere and
  // everything the office already has, never running into later office work.
  // A range bigger than one send goes as an explicit "Send all … in N parts".
  useEffect(()=>{
    if(!loaded || rangeEdited.current || pending || chooseAgain || seriesRunning.current)return;
    const next=heldFrom!==undefined && heldTo!==undefined?{from:heldFrom,to:heldTo}:suggestOfficeRange(jobs,total,printedCount,Infinity);
    if(next){setFrom(String(next.from));setTo(String(next.to));}
    else{setFrom('');setTo('');}
  },[loaded,jobs,total,printedCount,pending,chooseAgain,heldFrom,heldTo]);
  // A remembered refusal never outlives what live status says.
  const shownRefusal=refusalStillApplies(refusal,printer)?refusal:null;
  useEffect(()=>{if(refusal && printer && !refusalStillApplies(refusal,printer))clearRefusal();},[refusal,printer,clearRefusal]);
  // Re-read before saying "weren't sent": labels the office has now (sent
  // from another device, or a resend that arrived) are no longer offered.
  const refusalCovered=!!shownRefusal && requestsEverLoaded && officeSendPlan(jobs,shownRefusal.from,shownRefusal.to).kind!=='new';
  useEffect(()=>{
    if(!refusalCovered || !refusal)return;
    clearRefusal();
    setNotice({text:`${Range(refusal.from,refusal.to)} ${refusal.from===refusal.to?'is':'are'} at the office now, so nothing needs sending again. The office queue below shows where ${refusal.from===refusal.to?'it is':'they are'}.`,at:Date.now(),tone:'next'});
  },[refusalCovered,refusal,clearRefusal]);

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

  /** A request saved on this device that hasn't been answered yet, or null. */
  const savedRequest=()=>{
    let saved:string|null=null;try{saved=localStorage.getItem(storageKey);}catch{saved=null;}
    return readSavedOfficeRequest(saved);
  };
  const finishFirstWords=(saved:{from:number;to:number})=>`Nothing new was sent: we’re still not sure the office got ${range(saved.from,saved.to)}. Press “Send again” to finish that first (it can’t print twice), or “Start over” if the office queue shows it arrived.`;
  /** True (and says why) when a saved request has to be sorted out before anything else is sent. */
  const blockedBySaved=():boolean=>{
    const saved=savedRequest();
    if(!saved)return false;
    if(saved==='unreadable'){setError('The saved request on this device couldn’t be read. Check the office queue below before starting over.');return true;}
    setPending(p=>p ?? saved);
    setError(finishFirstWords(saved));return true;
  };

  /**
   * One send = one POST with one saved idempotency key. `target` is a part of
   * an explicit multi-part send; `direct` is a one-tap send whose range was
   * just chosen (a resend after a refusal, or a reprint the person confirmed);
   * otherwise the range on screen. `partBlank` is true only for the part that
   * end; a one-tap send carries the blank only when its own box asked for it
   * (`direct.endBlank`); the form's send uses the form's box.
   */
  const submit=async(target?:OfficeSpan,direct?:{span:OfficeSpan;reprintOf?:string;endBlank?:boolean},partBlank=false):Promise<SendOutcome|undefined>=>{
    if(inFlight.current || !printer)return;inFlight.current=true;setBusy(true);setError('');setNotice(null);
    let outcome:SendOutcome='skipped';
    const onScreen={plan,tooBig};
    try{
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let payload:any;
      let saved:string|null=null;
      // "A send is on its way from this tab", beside the saved request (see SendingMark).
      const markSending=()=>{try{localStorage.setItem(sendingKey,JSON.stringify({key:String(payload.idempotencyKey),from:payload.from,to:payload.to,tab:tabId.current,until:Date.now()+SENDING_MARK_MS}));}catch{/* other tabs look it up instead */}};
      const proof=proofRef.current;
      const want=target ?? direct?.span ?? {from:fromNumber,to:toNumber};
      // Read, decide and save under one lock shared by this run's tabs, so two
      // tabs starting a send at the same moment never overwrite each other's
      // saved request: the second one finds the first one's and waits for it.
      const claimed=await withOfficeSendLock(runId,()=>{
        try{saved=localStorage.getItem(storageKey);}catch{saved=null;}
        if(saved){
          try{payload=JSON.parse(saved);}catch{setError('The saved request on this device couldn’t be read. Check the office queue below before starting over.');return false;}
          // A saved request is only ever resent as itself, never in place of
          // other labels: a one-tap send (a reprint from the fix dialog or a
          // queue row, a resend after a refusal) waits until it is sorted out,
          // and a part or the form resends it only for exactly its range.
          if(direct || payload.from!==want.from || payload.to!==want.to){
            const kept={from:Number(payload.from),to:Number(payload.to),reprintOf:typeof payload.reprintOf==='string'?payload.reprintOf:undefined,endBlank:payload.endBlank===true};
            setPending(p=>p ?? kept);
            setError(finishFirstWords(kept));return false;
          }
        }else{
          // A new request always needs a check of exactly this range first, and
          // is never one the server would refuse.
          if(bitmap && proof?.key!==currentProofKey.current)return false;
          if(bitmap && proof?.key!==keyOf(want.from,want.to))return false;
          // A one-tap send is planned from the latest office queue, like the form.
          const auto=direct?officeSendPlan(jobsRef.current,want.from,want.to):null;
          const plan:OfficeSendPlan=!direct || !auto?onScreen.plan
            :auto.kind==='new' && direct.reprintOf?{kind:'reprint',reprintOf:direct.reprintOf,overlap:{from:want.from,to:want.to}}
            :auto.kind==='reprint' && direct.reprintOf && jobsRef.current.some(j=>j.requestId===direct.reprintOf)?{...auto,reprintOf:direct.reprintOf}
            :auto;
          const tooBig=direct?want.to-want.from+1>cap:onScreen.tooBig;
          if(!target){if(!printAllowed || plan.kind==='wait' || tooBig)return false;}
          if(!printAllowed || !requestsEverLoaded)return false;
          const reprint=target?'':plan.kind==='reprint'?plan.reprintOf:'';
          // Saved with the request (and its key) before the POST, so a resend
          // after a dropped answer or a refresh sends exactly the same thing.
          const blank=target?partBlank:direct?direct.endBlank===true:endBlank;
          payload={runId,stationId:printer.station_id,printerId:printer.id,from:want.from,to:want.to,idempotencyKey:crypto.randomUUID(),...(blank?{endBlank:true}:{}),...(reprint?{reprintOf:reprint}: {}),...(bitmap?{expectedBitmapDigest:proof?.digest}:{})};
          try{localStorage.setItem(storageKey,JSON.stringify(payload));}
          catch{setError('This device can’t save the request, so it wasn’t sent. Check that the browser allows saving site data.');return false;}
          setPending({from:payload.from,to:payload.to,reprintOf:payload.reprintOf,endBlank:payload.endBlank===true});
        }
        markSending();
        return true;
      });
      if(!claimed)return;
      clearRefusal();
      // While this tab waits for the answer the panel says "Sending…", not
      // "not sure": the saved request only matters if the answer is lost.
      // Other tabs (and this tab after a reload) learn the same from a mark
      // kept beside the saved request, renewed while the answer is awaited.
      const sendKey=String(payload.idempotencyKey);
      const unmark=()=>{try{if(readSendingMark(localStorage.getItem(sendingKey))?.key===sendKey)localStorage.removeItem(sendingKey);}catch{/* nothing saved */}};
      markSending();const beat=setInterval(markSending,4000);
      setPosting(true);
      try{
        let result;
        // A stalled connection ends a little after the server's own limit
        // (300 s), as "no answer": the saved request and key stay for Send again.
        try{result=await api('/api/office/jobs',{method:'POST',body:JSON.stringify(payload),...(typeof AbortSignal!=='undefined' && typeof AbortSignal.timeout==='function'?{signal:AbortSignal.timeout(OFFICE_POST_TIMEOUT_MS)}:{})});}
        finally{clearInterval(beat);unmark();}
        try{localStorage.removeItem(storageKey);localStorage.removeItem(metaKey);}catch{/* nothing saved */}setPending(null);setPosting(false);
        // Every send starts with the blank off: the choice was for this send only.
        setEndBlank(false);
        if(payload.endBlank===true && typeof result?.requestId==='string')rememberBlankSend(result.requestId);
        if(heldBlankAt!==null && payload.to===heldBlankAt)saveHeldBlank(null);
        if(!target)setNotice({text:queuedNotice(Range(payload.from,payload.to),payload.from===payload.to,status,payload.endBlank===true?payload.to:undefined),requestId:typeof result?.requestId==='string'?result.requestId:undefined,at:Date.now(),queued:true});
        setReprintOf('');if(!direct)setAgain(null);setSendOther(false);rangeEdited.current=false;
        outcome='sent';
      }catch(err){
        setPosting(false);
        // A definite refusal (400/404/409/413) means nothing new was queued,
        // so the saved request is cleared and never offered for resend.
        // Anything else (offline, timeout, 5xx, busy, or signed out / no
        // access on a resend) might mean an earlier try arrived, so the same
        // request is kept and "Send again" reuses its idempotency key.
        const code=err instanceof OfficeRequestError?err.status:undefined;
        if(!sendKeepsRequest(code,err instanceof OfficeRequestError?err.code:undefined,!!saved)){
          try{localStorage.removeItem(storageKey);localStorage.removeItem(metaKey);}catch{/* nothing saved */}setPending(null);
          const plain=plainOfficeRefusal(err instanceof Error?err.message:'',code);
          const record:OfficeRefusalRecord={from:payload.from,to:payload.to,reason:plain.reason,message:plain.message,at:new Date().toISOString(),...(payload.endBlank===true?{endBlank:true}:{})};
          try{localStorage.setItem(refusedKey,JSON.stringify(record));}catch{/* shown on this page anyway */}
          setRefusal(record);
          if(plain.reason==='labels-changed')setProof(null);
          outcome='refused';
        }else{
          // Another tab may have seen this send arrive meanwhile and cleared
          // it: then it is at the office, and nothing is "not sure" here.
          let still:string|null=null;try{still=localStorage.getItem(storageKey);}catch{still=saved ?? JSON.stringify(payload);}
          let stillKey='';try{stillKey=still?String(JSON.parse(still).idempotencyKey):'';}catch{stillKey='';}
          if(stillKey!==sendKey){setPending(null);outcome='skipped';}
          else{
            seenFail.current.add(sendKey);
            const meta={status:code,code:err instanceof OfficeRequestError?err.code:undefined};
            // Kept beside the request, so a refresh gives the same reason.
            try{localStorage.setItem(metaKey,JSON.stringify(meta));}catch{/* shown on this page anyway */}
            setPending({from:payload.from,to:payload.to,reprintOf:payload.reprintOf,endBlank:payload.endBlank===true,...meta});
            outcome='uncertain';
          }
        }
      }
      await refresh().catch(()=>{});
      return outcome;
    }
    finally{inFlight.current=false;setBusy(false);setPosting(false);}
  };

  /**
   * A one-tap send of labels the person just chose (and confirmed where that
   * was needed): checks the labels, then sends them through the same single
   * POST with a new saved key. Never more than one request.
   */
  const [directCheck,setDirectCheck]=useState<{span:OfficeSpan;progress?:{completed:number;total:number}}|null>(null);
  /** `blank`: this one send ends with a blank label (its own box asked for it). Off unless said. */
  const sendNow=async(span:OfficeSpan,reprintOf?:string,keepAgain=false,blank=false):Promise<SendOutcome|undefined>=>{
    if(!printer || inFlight.current || directRunning.current || seriesRunning.current)return;
    if(blockedBySaved())return 'skipped';
    directRunning.current=true;
    rangeEdited.current=true;fixedRange.current=`${span.from}-${span.to}`;
    setFrom(String(span.from));setTo(String(span.to));setReprintOf(reprintOf ?? '');if(!keepAgain)setAgain(null);setSendOther(false);
    clearRefusal();setError('');setNotice(null);
    try{
      if(bitmap){
        setBusy(true);setDirectCheck({span});
        const checked=await drawProof(span,(completed,count)=>setDirectCheck({span,progress:{completed,total:count}}));
        setDirectCheck(null);setBusy(false);
        if(!checked)return 'skipped';
      }
      return await submit(undefined,{span,reprintOf,endBlank:blank});
    }finally{directRunning.current=false;setDirectCheck(null);}
  };

  // --- One explicit "Send all N in K parts" ----------------------------------
  // Each part is checked, then sent with its own saved key, one after another.
  // It stops at the first part that isn't clearly queued, and the plan is
  // kept on this device so a closed page can send the rest later.
  /** Why the next part mustn't go (the run is cancelled or done, or couldn't be read), or null when it may. */
  const runEndedWords=async(index:number,count:number):Promise<string|null>=>{
    const where=`Stopped before part ${index+1} of ${count}`;
    const ended=(state:string|undefined)=>state==='cancelled'?`${where}: this run was cancelled, so nothing more was sent.`:state==='completed'?`${where}: this run is marked done, so nothing more was sent.`:null;
    const known=ended(runStatusRef.current);if(known)return known;
    try{
      const response=await fetch(`/api/runs/${encodeURIComponent(runId)}`,{cache:'no-store'});
      if(!response.ok)throw new Error(String(response.status));
      const fresh=await response.json().catch(()=>null) as {status?:string}|null;
      if(fresh?.status){runStatusRef.current=fresh.status as RunStatus;}
      const words=ended(fresh?.status);
      // The page shows what happened on the other device.
      if(words)void useRunStore.getState().fetchRun(runId).catch(()=>null);
      return words;
    }catch{
      return `${where}: couldn’t check the run just now. The rest are kept on this device: send the remaining parts when the connection is back.`;
    }
  };
  const runSeries=async(start:OfficePartsPlan)=>{
    if(seriesRunning.current || !printer || seriesLocks.has(runId))return;
    seriesRunning.current=true;seriesLocks.add(runId);stopSeries.current=false;setStopAsked(null);clearRefusal();setNotice(null);setError('');
    let current=start;savePartsPlan(current);
    const leftOut:{span:OfficeSpan|null}={span:null};
    let blankSent=false;
    // The part that should end with the blank label, when it isn't sent after all (and why).
    let blankSkipped:{span:OfficeSpan;why:'printed'|'office'}|null=null;
    // Resuming a plan whose last part the office already has: that part is gone from the list.
    const blankAt=current.endBlankAt;
    if(blankAt!==undefined && !current.parts.slice(current.next).some(p=>p.to===blankAt)){
      const last=current.parts[current.parts.length-1];
      if(last && last.to<blankAt)blankSkipped={span:{from:last.to+1,to:blankAt},why:'office'};
    }
    try{
      for(let i=current.next;i<current.parts.length;i++){
        if(stopSeries.current)break;
        // The run may have been cancelled or finished meanwhile (here, on the
        // Runs list or on another device): read it again before every part,
        // and never send another part for a run that isn't printing any more.
        const ended=await runEndedWords(i,current.parts.length);
        if(ended){setError(ended);break;}
        if(stopSeries.current)break;
        let part=current.parts[i];
        // A part this device already tried resends its saved request (same
        // key). A part the office already has is skipped, never sent twice.
        let saved:string|null=null;try{saved=localStorage.getItem(storageKey);}catch{saved=null;}
        let resend=false;if(saved){try{const s=JSON.parse(saved);resend=s.from===part.from && s.to===part.to;}catch{resend=false;}}
        // Labels counted as printed meanwhile (on any device) are left out of
        // a new part; an unsure part still resends exactly what it saved.
        if(!resend){
          const after=partsAfterPrinted([part],printedRef.current);
          if(after.trimmed)leftOut.span={from:Math.min(leftOut.span?.from ?? Infinity,after.trimmed.from),to:Math.max(leftOut.span?.to ?? 0,after.trimmed.to)};
          if(!after.parts.length){if(partCarriesEndBlank(current,part))blankSkipped={span:part,why:'printed'};current={...current,next:i+1};savePartsPlan(current);continue;}
          if(after.parts[0].from!==part.from){part=after.parts[0];current={...current,parts:current.parts.map((p,j)=>j===i?part:p)};savePartsPlan(current);}
        }
        if(!resend && officeSendPlan(jobsRef.current,part.from,part.to).kind!=='new'){if(partCarriesEndBlank(current,part))blankSkipped={span:part,why:'office'};current={...current,next:i+1};savePartsPlan(current);continue;}
        setSeries({total:current.parts.length,index:i,part,phase:bitmap && !resend?'checking':'sending'});
        if(bitmap && !resend){
          setBusy(true);
          const checked=await drawProof(part,(completed,count)=>setSeries(s=>s?{...s,progress:{completed,total:count}}:s));
          setBusy(false);
          // Never a silent stop: unless the check already said what went
          // wrong, say why the parts stopped and what to do.
          if(!checked){setError(e=>e || `Stopped before part ${i+1} of ${current.parts.length}: the labels changed while sending. Check the preview, then send the remaining parts.`);break;}
          setSeries(s=>s?{...s,phase:'sending',progress:undefined}:s);
        }
        if(stopSeries.current)break;
        // Read again right before the send: checking a part can take a while.
        if(!resend){const late=await runEndedWords(i,current.parts.length);if(late){setError(late);break;}}
        if(stopSeries.current)break;
        // Only the part that ends the whole range carries the blank label.
        const blankHere=partCarriesEndBlank(current,part);
        const outcome=await submit(part,undefined,blankHere);
        if(outcome!=='sent')break;
        if(blankHere)blankSent=true;
        current={...current,next:i+1};savePartsPlan(current);
      }
      const out=leftOut.span;
      const skippedWords=out?` ${Range(out.from,out.to)} ${out.from===out.to?'was':'were'} already counted as printed, so ${out.from===out.to?'it was':'they were'} left out.`:'';
      // Said plainly: the blank the person asked for didn't come out with this send.
      const noBlankWords=blankSkipped && !blankSent?` No blank label was fed at the end: ${range(blankSkipped.span.from,blankSkipped.span.to)} ${blankSkipped.span.from===blankSkipped.span.to?'was':'were'} already ${blankSkipped.why==='printed'?'counted as printed':'at the office'}.`:'';
      if(current.next>=current.parts.length){
        const first=current.parts[0],last=current.parts[current.parts.length-1];
        setNotice({text:queuedNotice(Range(first.from,last.to),first.from===last.to,status,blankSent?last.to:undefined)+skippedWords+noBlankWords,at:Date.now(),queued:true});
      }else if(skippedWords)setNotice({text:skippedWords.trim(),at:Date.now(),tone:'next'});
    }finally{seriesRunning.current=false;seriesLocks.delete(runId);setSeries(null);setBusy(false);currentProofKey.current=proofKey;rangeEdited.current=false;}
  };
  const startSeries=async()=>{
    if(!printer || parts.length<2)return;
    const ok=await confirmDialog({title:`Send ${plural(sendCount)} in ${parts.length} parts?`,body:`The office printer takes up to ${plural(cap)} of this design at a time, so each part is ${bitmap?'checked, then ':''}queued, one after another.${endBlank?` One blank label comes out after label ${toNumber.toLocaleString()} only, with the last part.`:''} Keep this page open until the last part is queued. You can stop after any part.`,confirmLabel:`Send ${parts.length} parts`});
    if(!ok)return;
    // The blank choice is kept with the plan, so sending the rest later (after
    // closing the page) still ends with it, and an earlier part never does.
    // The box itself goes back to off: the choice was for this send.
    const plan={stationId:printer.station_id,printerId:printer.id,parts,next:0,at:new Date().toISOString(),...(endBlank?{endBlankAt:toNumber}:{})};
    setEndBlank(false);if(heldBlankAt!==null && toNumber===heldBlankAt)saveHeldBlank(null);
    void runSeries(plan);
  };
  // Leaving the page mid-series would stop it: say so before the tab closes.
  const seriesOn=!!series;
  useEffect(()=>{
    if(!seriesOn)return;
    setOfficeSeriesRunning(true,()=>{stopSeries.current=true;});
    const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};
    window.addEventListener('beforeunload',warn);
    return()=>{setOfficeSeriesRunning(false);window.removeEventListener('beforeunload',warn);};
  },[seriesOn]);
  // A saved plan is offered again only while its parts are still unsent, and
  // without labels counted as printed since (on any device).
  const {leftParts,leftTrimmed}=useMemo(()=>{
    const left=remainingParts(partsPlan);
    if(!left.length || !requestsEverLoaded)return {leftParts:[] as OfficeSpan[],leftTrimmed:null};
    const after=partsAfterPrinted(left,printedCount);
    // Parts the office already has (a resend that did arrive) drop out.
    return {leftParts:after.parts.filter(p=>officeSendPlan(jobs,p.from,p.to).kind==='new'),leftTrimmed:after.trimmed};
  },[partsPlan,jobs,requestsEverLoaded,printedCount]);
  // A cancelled run never offers its unsent parts again.
  useEffect(()=>{if(partsPlan && runStatus==='cancelled' && !seriesOn){setPartsPlan(null);try{localStorage.removeItem(partsKey);}catch{/* nothing saved */}}},[partsPlan,runStatus,seriesOn,partsKey]);
  useEffect(()=>{if(partsPlan && requestsEverLoaded && !seriesRunning.current && remainingParts(partsPlan).length && !leftParts.length){setPartsPlan(null);try{localStorage.removeItem(partsKey);}catch{/* nothing saved */}}},[partsPlan,leftParts.length,requestsEverLoaded,partsKey]);
  const planPrinterHere=!!partsPlan && !!printer && partsPlan.stationId===printer.station_id && partsPlan.printerId===printer.id;
  // The unsure send is the next part of a saved plan: "Send again" resends it
  // (same key) and then carries on with the other parts.
  const planNext=partsPlan?partsPlan.parts[partsPlan.next]:undefined;
  const pendingInPlan=!!pending && planPrinterHere && !!planNext && planNext.from===pending.from && planNext.to===pending.to;
  const partsAfterPending=pendingInPlan?leftParts.filter(p=>!(p.from===pending?.from && p.to===pending?.to)):[];

  const startOver=async()=>{
    const ok=await confirmDialog({title:'Start over?',body:`Check the office queue below first. The office may already have these labels, and starting over doesn’t cancel anything.${pendingInPlan?' This part is taken out of the remaining parts, so it is never sent a second time; if the office doesn’t have it, it shows as not sent yet.':''}`,confirmLabel:'Start over'});
    if(!ok)return;
    // The unsure part of a saved plan is dropped from it, so "Send the
    // remaining parts" can't send it again with a new key.
    if(pendingInPlan && partsPlan)savePartsPlan({...partsPlan,next:partsPlan.next+1});
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
  const refusalStep=shownRefusal?refusalNextStep(shownRefusal.reason):'none';
  const formAllowed=!settled && !cancelledIdle && !series && !leftParts.length && !noAccess && canPrint && !!printer && status.canSend && !status.stopped;
  // Another run's part stops the shared printer: one line and a way to that run.
  const heldBlock=!!heldByRun && !pending && !settled && !cancelledIdle;
  // Only one range editor at a time: the "which labels?" box hides the form.
  const showForm=!!pending || (!again && formAllowed && (!failedParts.length || sendOther || !!reprintOf));
  const formReady=requestsEverLoaded;
  const sendingHeld=!!heldOffer && rangeValid && fromNumber===heldOffer.from && toNumber===heldOffer.to;
  // The held labels of a "Print in order" fix carry the blank label asked for
  // in that fix (shown ticked); any other range starts with the box off.
  const heldCarriesBlank=sendingHeld && heldBlankAt===toNumber && !pending;
  const blankPreset=useRef(false);
  useEffect(()=>{
    if(heldCarriesBlank){blankPreset.current=true;setEndBlank(true);}
    else if(blankPreset.current){blankPreset.current=false;setEndBlank(false);}
  },[heldCarriesBlank]);
  // Labels after the progress that no office send covers, read from the
  // office's own records: what a stopped series left, seen on every device.
  // Only labels not counted as printed (a scanned label is printed), so this
  // never names a range the progress line contradicts.
  const unsentSpans=requestsEverLoaded && jobs.length?intersectSpans(officeUnsentSpans(jobs,total,printedCount),toGo ?? [{from:1,to:total}]):[];
  // Held labels of a "Print in order" fix still on their way: the next send waits for them.
  const heldWait=heldMoving.length>0 && !heldUnsent.length && !pending && !chooseAgain && !reprintOf && !sendOther;
  // Another tab is sending this very request: nothing to press here until it answers.
  const disabled=pending?(busy || (!posting && pendingPhase!=='unsure')):(busy || heldWait || !printAllowed || !formReady || !rangeValid || plan.kind==='wait' || (tooBig && parts.length<2));
  // One primary button on screen: the first problem's fix, else the main action.
  // The "which labels?" box is the main action while it is open.
  const againOpen=!!again && !series && !pending && canPrint && !!printer;
  // Resume is the main action while the printer is paused and nothing else needs someone.
  // "Did they print?" shows only when nothing else is asking the person something.
  // It stays until every sent label is confirmed (or cancelled), also while
  // held labels or a reprint wait: those have their own button.
  const markShown=markRanges.length>0 && !series && !!onMarkPrinted && !fix && !pending && !chooseAgain && !directCheck;
  const owner:'problem'|'pending'|'refusal'|'parts'|'mark'|'form'|'again'|'held'|'resume'|'none'=
    pending?'pending'
    :againOpen?'again'
    :showForm && (sendOther || reprintOf)?'form'
    :failedParts.length && canPrint?'problem'
    :shownRefusal && !noAccess?'refusal'
    :heldBlock?'held'
    :status.paused && !status.stopped?'resume'
    // Labels a fix held back come next: sending them (or waiting for them) is the main step, not "mark printed".
    :showForm && (!!heldOffer || heldWait)?'form'
    :leftParts.length && planPrinterHere?'parts'
    :markShown && !moving?'mark'
    :showForm?'form':'none';
  // A refusal with its own "Send … again" button: the form steps aside, so there is one send button.
  const refusalOwnsSend=owner==='refusal' && (refusalStep==='resend' || refusalStep==='smaller' || refusalStep==='without-blank');
  const primaryLabel=busy
    ?(preparationProgress?'Checking labels…':'Sending to office printer…')
    :pending && pendingPhase==='other'?'Sending from another tab…'
    :pending && !posting && pendingPhase==='checking'?'Checking…'
    :pending?'Send again'
    :heldWait?`Waiting for ${nums(heldMoving[0].from,heldMoving[heldMoving.length-1].to)}…`
    :plan.kind==='wait'?'Waiting for office printer…'
    :tooBig && parts.length>1?`Send all ${sendCount.toLocaleString()} in ${parts.length} parts`
    // Labels a "Print in order" fix held back: the button names them, so the plan's last step is plainly this press.
    :sendingHeld && plan.kind!=='reprint'?`${proofCurrent?'Send':'Check & send'} ${fromNumber===toNumber?`label ${fromNumber.toLocaleString()}`:nums(fromNumber,toNumber)}`
    // Never a count of 0: until the boxes hold a real range, the button names no number.
    :!sendCount?'Send to office printer'
    :!proofCurrent?(plan.kind==='reprint'?'Check labels to print again':`Check ${plural(sendCount)}`)
    :plan.kind==='reprint'?`Print ${plural(sendCount)} again`
    // One wording for the same state, before and after a reload, in every tab.
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
        // Labels printed one by one in scan mode would come out twice.
        const scanned=scannedSkipPlan(fromNumber,toNumber,scannedLabels);
        if(scanned.skipped.length){
          const words=labelListWords(scanned.skipped);
          const one=scanned.skipped.length===1;
          const keep=scanned.keep[0];
          const answer=await choiceDialog({title:`${capitalise(words)} ${one?'was':'were'} already printed by scanning`,
            body:keep?`Sending ${range(fromNumber,toNumber)} prints ${one?'it':'them'} a second time.${scanned.keep.length>1?` Leaving ${one?'it':'them'} out sends ${range(keep.from,keep.to)} first; the rest is offered after.`:''}`:`Every label in this range was printed by scanning. Sending ${one?'it':'them'} prints ${one?'it':'them'} a second time.`,
            confirmLabel:keep?`Send ${nums(keep.from,keep.to)} only`:'Don’t send',altLabel:'Send them anyway'});
          if(answer===null)return;
          if(answer==='confirm'){
            if(keep){rangeEdited.current=true;setFrom(String(keep.from));setTo(String(keep.to));setNotice({text:`${capitalise(words)} left out. Check the range, then send.`,at:Date.now(),tone:'next'});}
            return;
          }
        }
        setAskedKey(rangeKey);
      }
      if(tooBig){if(parts.length>1)void startSeries();return;}
    }
    if(!pending && !proofCurrent) void prepareProof(); else void submit();
  };
  const alreadyPrinted=!pending && plan.kind==='new' && rangeValid && fromNumber<=printedCount;

  // --- The printer: one status line ------------------------------------------
  const ownHold=!!status.hold && status.hold.run_id===runId;
  // A send just refused as offline wins over a "Ready" the last station read still shows.
  const offlineRefused=!!shownRefusal && shownRefusal.reason==='printer-offline' && !status.stopped && !status.paused;
  const lineTone:keyof typeof tone=ownHold?(failedParts.some(p=>p.kind==='did-not-print')?'bad':'warn'):offlineRefused?'warn':status.tone;
  const lineText=ownHold?'Stopped until the labels below are checked.':offlineRefused?'Offline: the office printer didn’t take the last send.':status.text;
  const connection=<div className="space-y-3">
    {printers.length>1
      ? <div className="space-y-1"><span id={`${uid}-printer`} className="field-label">Office printer</span><CustomSelect aria-labelledby={`${uid}-printer`} value={selected} onChange={setSelected} options={printers.map(p=>({value:`${p.station_id}/${p.id}`,label:p.name}))} /></div>
      : !printer && <p className="text-sm text-zinc-300">{stationsLoaded?'No office printer is set up for your account.':'Looking for the office printer…'}</p>}
    {printer && <div className="flex min-h-control flex-wrap items-center justify-between gap-x-3 gap-y-2 text-sm">
      <div role="status" className="min-w-0 space-y-0.5">
        <p className={`flex items-start gap-2 ${tone[lineTone]}`}><span aria-hidden="true" className={`status-dot mt-1.5 size-2 shrink-0 rounded-full ${status.paused && !status.stopped?'border-2 border-amber-300 bg-transparent':dotTone[lineTone]}`} /><span key={lineText} className="status-swap">{printers.length>1?'':<span className="text-zinc-300">{printer.name}: </span>}{lineText}</span></p>
        {!printer.online && printer.last_seen && <p className="pl-4 text-zinc-400">{lastSeen(printer.last_seen)}</p>}
        {status.hold && !ownHold && !heldBlock && <p className="pl-4"><Link href={`/runs/${encodeURIComponent(status.hold.run_id)}`} className="link">Open that run</Link><span className="text-zinc-400"> to check {status.hold.from===status.hold.to?'it':'them'}.</span></p>}
      </div>
      {printer.dispatch_enabled && printer.paired_at!==null && <OfficePrinterControls stopped={!!status.stopped} primaryResume={owner==='resume'} onPausedChange={setControlPaused} onChange={()=>void refreshStations().catch(()=>{})} />}
    </div>}
  </div>;

  // --- Fixing a part ----------------------------------------------------------
  const laterQueued=(part:OfficeFailedPart)=>{
    // Grouped from every job of the run (not the latest 100 sends), so older sends are held too.
    const cancellable=officeQueuedRequestIds(jobs.filter(j=>j.state==='queued' && j.from>part.to));
    const spans=jobs.filter(j=>j.state==='queued' && j.from>part.to).map(j=>({from:j.from,to:j.to}));
    const atOffice=jobs.filter(j=>['claimed','submitted'].includes(j.state) && !j.review && j.from>part.to).map(j=>({from:j.from,to:j.to}));
    return {cancellable,spans,atOffice};
  };
  /** Puts a part in the form as a reprint, already confirmed by the dialog. */
  const chooseReprint=(part:OfficeFailedPart,words:string)=>{
    const end=Math.min(part.to,part.from+cap-1);
    fixedRange.current=`${part.from}-${end}`;
    rangeEdited.current=true;setAgain(null);setSendOther(false);setFrom(String(part.from));setTo(String(end));setEndBlank(false);
    if(part.requestId)setReprintOf(part.requestId);
    if(words)setNotice({text:words,at:Date.now(),tone:'next'});
  };
  const openFix=(part:OfficeFailedPart)=>{
    // A part already checked at the office goes straight to its reprint, after one confirm.
    if(part.kind==='print-again'){void printAgainNow(part);return;}
    setFix({part,seen:'',againText:'',note:'',order:'in-order',blank:false});
  };
  /** "Print 51–100 again": one confirm, then the check and the send in the same tap. */
  const printAgainNow=async(part:OfficeFailedPart)=>{
    const end=Math.min(part.to,part.from+cap-1);
    const ok=await confirmDialog({title:`Print ${range(part.from,end)} again?`,body:`${end-part.from===0?'It prints':'They print'} once more on the office printer. The run’s progress doesn’t change.`,confirmLabel:`Print ${nums(part.from,end)} again`});
    if(!ok)return;
    if(end<part.to)chooseReprint(part,`The office printer takes up to ${plural(cap)} of this design at a time. Send ${range(part.from,end)} first.`);
    else void sendNow({from:part.from,to:end},part.requestId ?? undefined);
  };
  const fixWhy=(part:OfficeFailedPart)=>part.reason?plainJobReason(part.reason):part.kind==='did-not-print'?plainJobReason(null):'the office computer didn’t confirm them';
  /** The labels to print again for the person's answer, or null when the answer isn't complete. */
  const fixAgain=(current:Fix|null):OfficeSpan|null=>{
    if(!current || !current.seen || current.seen==='all')return null;
    if(current.seen==='none')return {from:current.part.from,to:current.part.to};
    return fixSome(current).span;
  };
  /** The "Some of them" box: one stretch inside the part, or what to fix (empty box: neither). */
  const fixSome=(current:Fix):{span:OfficeSpan|null;error:string}=>{
    const {part}=current;
    const parsed=parseLabelList(current.againText,total);
    if(parsed.error)return {span:null,error:parsed.error};
    if(!parsed.spans.length)return {span:null,error:''};
    const outside=parsed.spans.some(s=>s.from<part.from || s.to>part.to);
    if(outside)return {span:null,error:`Use label numbers from ${nums(part.from,part.to)}.`};
    if(parsed.spans.length>1)return {span:null,error:'Type one stretch, like the first and last label that didn’t come out. Print others again afterwards.'};
    return {span:parsed.spans[0],error:''};
  };
  const saveFix=()=>void act(async()=>{
    const current=fix;if(!current || !current.seen)return;
    const {part}=current;
    const again=fixAgain(current);
    if(current.seen!=='all' && !again)return;
    // An unanswered send must be sorted out first: nothing is recorded or
    // cancelled at the office, and the panel says what to do.
    if(again && blockedBySaved()){setFix(null);return;}
    const later=laterQueued(part);
    // 1. Hold later parts of this run first, before the check lets the office
    //    carry on, so the reprint comes out in order.
    // Read fresh from the office (every send, not only the latest 100), and
    // remembered after each send taken out, so a cancel that fails partway
    // never loses labels that were already taken out of the queue.
    let held:OfficeSpan[]=[];
    const cancelledIds=new Set<string>();
    if(again && current.order==='in-order' && later.cancellable.length){
      const all=await readOfficeJobs(runId);
      if(!all){setError('Couldn’t read the office queue, so nothing was changed. Try again in a moment.');return;}
      for(const requestId of officeQueuedRequestIds(all.filter(j=>j.state==='queued' && j.from>part.to))){
        try{await api('/api/office/jobs/'+encodeURIComponent(requestId),{method:'DELETE'});}
        catch(err){
          if(!held.length)throw err;
          setFix(null);
          setError(`${capitalise(spanWords(held))} ${single(held)?'was':'were'} taken out of the office queue so the reprint comes out first, but the labels after ${single(held)?'it':'them'} couldn’t be (${officeMessage(err,'the office printer didn’t answer').replace(/\.$/,'')}). Nothing was printed again yet. The office queue below shows what is still waiting; press “${part.kind==='needs-check'?`Check ${nums(part.from,part.to)}…`:`Print ${nums(part.from,part.to)} again…`}” to try again.`);
          return;
        }
        const these=all.filter(j=>j.state==='queued' && j.requestId===requestId);
        for(const j of these)cancelledIds.add(j.id);
        held=[...held,...these.map(j=>({from:j.from,to:j.to}))].sort((a,b)=>a.from-b.from);
        // Remembered on this device so "Send labels 76–150 now" follows the reprint.
        saveHeld([...heldSpans,...held]);
      }
    }
    // 2. Record the check for each job that still needs one. A fresh read
    //    skips jobs already checked (by someone else, or by an earlier try).
    //    The person looked after the printer stopped, so nothing is still waiting there.
    const fresh=await api('/api/office/jobs?runId='+encodeURIComponent(runId));
    const freshJobs:Array<{id:string;state:string;review:boolean}>=Array.isArray(fresh.jobs)?fresh.jobs:(Array.isArray(fresh.requests)?fresh.requests.flatMap((r:OfficeRequest)=>r.jobs):[]);
    const note=current.note.trim();
    const cameOut=again?[{from:part.from,to:again.from-1},{from:again.to+1,to:part.to}].filter(s=>s.from<=s.to):[{from:part.from,to:part.to}];
    const reason=(current.seen==='all'
      ?`They printed: ${range(part.from,part.to)} counted as printed.`
      :`${capitalise(fixWhy(part))}. ${capitalise(range(again!.from,again!.to))} sent to print again${cameOut.length?`; ${spanWords(cameOut)} came out`:''}.`)+(note?` ${note}`:'');
    try{
      for(const jobId of part.jobIds){
        const job=freshJobs.find(j=>j.id===jobId);
        if(job && !job.review && ['resolved','cancelled','sent_to_printer'].includes(job.state))continue;
        try{await api('/api/office/review',{method:'POST',body:JSON.stringify({jobId,pendingCupsResolved:true,reason:reason.slice(0,500)})});}
        catch(err){if(!(err instanceof OfficeRequestError && err.status===409))throw err;}
      }
    }catch(err){
      // The later parts are already out of the queue: say so plainly, so
      // nobody thinks they are still on their way. The office queue (on
      // every device) shows them as cancelled, and this panel offers them
      // again after the reprint.
      if(!held.length)throw err;
      setFix(null);
      setError(`${capitalise(spanWords(held))} ${single(held)?'was':'were'} taken out of the office queue so the reprint comes out first, but your answer for ${range(part.from,part.to)} didn’t save (${officeMessage(err,'the office printer didn’t answer').replace(/\.$/,'')}). Press “${part.kind==='needs-check'?`Check ${nums(part.from,part.to)}…`:`Print ${nums(part.from,part.to)} again…`}” to answer again. Nothing was printed again yet.`);
      return;
    }
    // The reprint below plans from the queue, and the screen's copy still
    // shows these jobs waiting for this check (and the later parts queued).
    // Bring it up to date with what the server just accepted; the refresh
    // after this tap replaces it with the real queue.
    const checkedIds=new Set(part.jobIds);
    jobsRef.current=jobsRef.current.map(j=>checkedIds.has(j.id)?{...j,state:'resolved',review:false}:cancelledIds.has(j.id)?{...j,state:'cancelled'}:j);
    setFix(null);
    // 3. Labels the person saw come out are counted, only on this answer.
    const counted=cameOut.length?(await onRecordPrinted?.(cameOut,note) ?? false):true;
    if(!again){
      setNotice({text:counted?`${Range(part.from,part.to)} counted as printed.`:`Saved at the office, but the run’s progress didn’t change. Use “Yes, mark printed” to count ${part.from===part.to?'it':'them'}.`,at:Date.now()});
      return;
    }
    // 4. Print the rest again in the same tap: the dialog was the ask.
    //    A blank label asked for in this fix comes out once, after the plan's
    //    last label: after the held labels when they follow the reprint
    //    (their send carries it), otherwise after the reprint itself.
    const heldLast=held.length?Math.max(...held.map(h=>h.to)):null;
    if(current.blank && heldLast!==null)saveHeldBlank(heldLast);
    const blankOnReprint=current.blank && heldLast===null;
    if(again.to-again.from+1>cap){chooseReprint({...part,from:again.from,to:again.to},`The office printer takes up to ${plural(cap)} of this design at a time. Send ${range(again.from,again.from+cap-1)} first.`);return;}
    await sendNow(again,part.requestId ?? undefined,false,blankOnReprint);
  });

  /** A queue row's "Cancel what hasn't been picked up": asks first, naming the labels, then one DELETE. */
  const cancelWaiting=async(r:OfficeRequest)=>{
    const waitingHere=r.jobs.filter(j=>j.state==='queued').map(j=>({from:j.from,to:j.to})).sort((a,b)=>a.from-b.from);
    if(!waitingHere.length)return;
    const n=waitingHere.reduce((c,s)=>c+s.to-s.from+1,0);
    const one=n===1;
    const ok=await confirmDialog({title:`Cancel ${spanWords(waitingHere)}?`,body:`${one?'It hasn’t':`These ${n.toLocaleString()} labels haven’t`} been picked up by the office yet, so ${one?'it doesn’t':'they don’t'} print. Labels already picked up still print. You can send ${one?'it':'them'} again later.`,confirmLabel:one?'Cancel it':`Cancel ${n.toLocaleString()} labels`,cancelLabel:'Keep them',danger:true});
    if(!ok)return;
    await act(async()=>{
      const result=await api('/api/office/jobs/'+encodeURIComponent(r.id),{method:'DELETE'});
      setNotice({text:`${result.cancelled?`Cancelled ${spanWords(waitingHere)}.`:'Nothing was waiting any more, so nothing was cancelled.'} ${result.requires_review?`${result.requires_review} batch${result.requires_review===1?' was':'es were'} already picked up and need someone to check the printer.`:''}`.trim(),at:Date.now()});
    });
  };
  // Who saw what happen to the saved send decides the words: only a try this
  // page saw fail may blame the connection.
  const pendingSeen:'here'|'earlier'|'none'=(()=>{
    if(!pending)return 'none';
    if(seenFail.current.has(savedKey()))return 'here';
    let meta:string|null=null;try{meta=localStorage.getItem(metaKey);}catch{meta=null;}
    return meta?'earlier':'none';
  })();
  const pendingOne=!!pending && pending.from===pending.to;
  // The lookup can't answer (for example after a change back to an earlier
  // version of Label Wrangler): never say the queue doesn't show them.
  const pendingWords=!pending?''
    :pendingSeen==='none' && lookupMissing?(queueHasPending
      ?`${Range(pending.from,pending.to)} look${pendingOne?'s':''} like ${pendingOne?'it':'they'} reached the office (see the queue below). If ${pendingOne?'it’s':'they’re'} listed, press “Start over”.`
      :'Check the office queue below before sending again. “Send again” can’t print twice.')
    :unconfirmedSendWords(pending.status,pending.code,pendingSeen,pendingOne);
  const waitingWords=waiting.length?spanWords(waiting):'';
  const ownBlocking=failedParts.find(p=>p.kind!=='print-again');
  const movingLine=moving && !ownBlocking && !series
    ?(status.stopped?`${capitalise(waitingWords)} wait until the office printer’s check is done.`
      // Paused: the printer's line says why and the progress line says how many wait, so nothing more here.
      :status.paused?''
      :printer && !printer.online?`${capitalise(waitingWords)} wait for the office computer to reconnect.`
      :null)
    :null;
  const fixLater=fix?laterQueued(fix.part):null;
  const markWords=spanWords(markRanges);
  // The queue's one-line summary: parts to check apart from parts to print again.
  const queueCounts=summary.failed.reduce((c,p)=>{const n=p.to-p.from+1;if(p.kind==='print-again')c.again+=n;else if(p.kind==='did-not-print')c.failed+=n;else c.check+=n;return c;},{check:0,again:0,failed:0});
  // The same words as the progress line: "sent to the printer" is only what the office reported sent; labels it has but hasn't sent are "waiting".
  const queueWords=[summary.sent?`${summary.sent.toLocaleString()} sent to the printer`:'',summary.onTheWay?`${summary.onTheWay.toLocaleString()} waiting`:'',queueCounts.failed?`${plural(queueCounts.failed)} didn’t print`:'',queueCounts.check?`${plural(queueCounts.check)} to check`:'',queueCounts.again?`${plural(queueCounts.again)} to print again`:''].filter(Boolean).join(' · ');
  // --- The "which labels?" box ------------------------------------------------
  // One box for every "print these again": the labels that didn't come out,
  // a finished run's reprint, or one send in the office queue. It takes
  // "5–8, 12", and one tap checks the first stretch and sends it; any other
  // stretch is then one more tap each (never more than one send per tap).
  const againParsed=again && !again.queue.length?parseLabelList(again.text,total,cap):{spans:again?.queue ?? [],error:''};
  const againSpans=againParsed.spans;
  const againNext=againSpans[0] as OfficeSpan|undefined;
  const againPlan:OfficeSendPlan|null=againNext && requestsEverLoaded?officeSendPlan(jobs,againNext.from,againNext.to):null;
  const againWait=againPlan?.kind==='wait'?againPlan:null;
  const againCheck=!!directCheck && !!againNext && directCheck.span.from===againNext.from && directCheck.span.to===againNext.to;
  const againLabel=!againNext?(again?.mode==='missing'?'Print them again':'Print again')
    :againCheck?'Checking labels…'
    :busy?'Sending to office printer…'
    :againPlan?.kind==='new' && !again?.requestId?`Send ${nums(againNext.from,againNext.to)}`
    :`Print ${nums(againNext.from,againNext.to)} again`;
  const sendAgainNext=async()=>{
    const current=again;
    if(!current || !againNext || againWait || !printAllowed || !requestsEverLoaded || busy)return;
    const rest=againSpans.slice(1);
    // Only the last stretch can end with the blank label.
    const outcome=await sendNow(againNext,current.requestId,true,current.blank && rest.length===0);
    if(outcome!=='sent')return;
    if(rest.length)setAgain({...current,queue:rest,sent:againNext});
    else setAgain(null);
  };
  // The run header says what this panel says.
  const unsureFrom=unsure?pending?.from:undefined,unsureTo=unsure?pending?.to:undefined;
  const refusedFrom=shownRefusal && !refusalCovered?shownRefusal.from:undefined,refusedTo=shownRefusal && !refusalCovered?shownRefusal.to:undefined;
  const panelPaused=!!printer && status.paused && !status.stopped;
  // What the panel is doing right now, in the header's few words.
  const sendingWords=series?`Sending part ${(series.index+1).toLocaleString()} of ${series.total.toLocaleString()}`
    :posting && pending?`Sending ${range(pending.from,pending.to)}`
    :pending && pendingPhase==='other'?'Sending from another tab'
    :pending && pendingPhase==='checking'?`Checking ${range(pending.from,pending.to)} at the office`
    :directCheck?`Checking ${range(directCheck.span.from,directCheck.span.to)}`
    :null;
  // Labels a "Print in order" fix held back wait for a press: the header says so.
  const heldShownFrom=heldOffer && !pending && !series?heldUnsent[0].from:undefined;
  const heldShownTo=heldOffer && !pending && !series?heldUnsent[heldUnsent.length-1].to:undefined;
  useEffect(()=>{onPanelState?.({
    unsure:unsureFrom!==undefined && unsureTo!==undefined?{from:unsureFrom,to:unsureTo}:null,
    refused:refusedFrom!==undefined && refusedTo!==undefined?{from:refusedFrom,to:refusedTo}:null,
    paused:panelPaused,sending:sendingWords,
    held:heldShownFrom!==undefined && heldShownTo!==undefined?{from:heldShownFrom,to:heldShownTo}:null});},[unsureFrom,unsureTo,refusedFrom,refusedTo,panelPaused,sendingWords,heldShownFrom,heldShownTo,onPanelState]);
  // The labels the main button sends next, for the run page's "Print anyway" words.
  // A part that needs fixing comes first: the preview shows the labels the problem is about.
  const fixFirst=owner==='problem' && !pending?failedParts[0]:undefined;
  const nextFrom=againOpen && againNext?againNext.from:fixFirst?fixFirst.from:showForm && !pending && rangeValid?fromNumber:pending?pending.from:undefined;
  const nextTo=againOpen && againNext?againNext.to:fixFirst?fixFirst.to:showForm && !pending && rangeValid?toNumber:pending?pending.to:undefined;
  useEffect(()=>{onRangeChange?.(nextFrom!==undefined && nextTo!==undefined?{from:nextFrom,to:nextTo}:null);},[nextFrom,nextTo,onRangeChange]);
  // A saved "Send all in parts" that asked for the blank: it still comes after the last part.
  const leftEndsBlank=!!partsPlan && leftParts.length>0 && partCarriesEndBlank(partsPlan,leftParts[leftParts.length-1]);
  const againEditor=again && againOpen ? (()=>{
    const scoped=again.requestId?requests.find(r=>r.id===again.requestId):undefined;
    const question=again.queue.length?null:again.mode==='missing'?'Which labels didn’t come out?':scoped?`Which of ${range(scoped.range_from,scoped.range_to)} do you want to print again?`:'Which labels do you want to print again?';
    const one=!!againNext && againNext.from===againNext.to;
    return <div className="reveal space-y-2 text-sm">
      {question
        ? <><div className="flex items-center justify-between gap-2"><label htmlFor={`${uid}-again`} className="font-medium text-zinc-100">{question}</label><button type="button" className="btn btn-ghost btn-sm -mr-2 text-zinc-300" onClick={()=>setAgain(null)}>Cancel</button></div>
          <input id={`${uid}-again`} className={inputClass} inputMode="text" autoComplete="off" autoFocus placeholder="For example 5–8, 12" aria-describedby={`${uid}-again-help`} disabled={busy} value={again.text} onChange={e=>{const text=e.target.value;setAgain(a=>a?{...a,text}:a);}} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();void sendAgainNext();}}} />
          <p id={`${uid}-again-help`} className="text-zinc-400">Type label numbers. A dash means every label in between.</p></>
        : <p className="text-zinc-100">{again.sent?`${Range(again.sent.from,again.sent.to)} ${again.sent.from===again.sent.to?'is':'are'} queued. `:''}Next: {spanWords(again.queue)}.</p>}
      {againParsed.error && <p role="alert" className="text-amber-300">{againParsed.error}</p>}
      {!again.queue.length && againNext && againSpans.length>1 && <p className="text-zinc-300">{capitalise(range(againNext.from,againNext.to))} go{one?'es':''} first, then {spanWords(againSpans.slice(1))}: one more press each.</p>}
      {againWait && <p role="status" className="text-zinc-400">{againWait.why==='needs-check'?`${Range(againWait.overlap.from,againWait.overlap.to)} need${againWait.overlap.from===againWait.overlap.to?'s':''} a check first (see above).`:`${Range(againWait.overlap.from,againWait.overlap.to)} ${againWait.overlap.from===againWait.overlap.to?'is':'are'} still on the way to the office printer. Print ${againWait.overlap.from===againWait.overlap.to?'it':'them'} again once ${againWait.overlap.from===againWait.overlap.to?'it’s':'they’re'} done.`}</p>}
      {!printAllowed && printBlockedReason && <p className="text-amber-300">{printBlockedReason}</p>}
      {againNext && !againWait && printAllowed && <p className="text-zinc-400">One press checks {one?'it':'them'} and sends {one?'it':'them'}. The run’s progress doesn’t change.</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy || !againNext || !!againWait || !printAllowed || !requestsEverLoaded} onClick={()=>void sendAgainNext()} className="btn btn-primary">{busy?<Loader2 className="size-4 animate-spin" aria-hidden="true" />:<PrinterIcon className="size-4" aria-hidden="true" />}{againLabel}</button>
        {again.queue.length>0 && <button type="button" disabled={busy} className="btn btn-ghost btn-sm text-zinc-300" onClick={()=>setAgain(null)}>Don’t send {spanWords(again.queue)}</button>}
      </div>
      {/* Only the last stretch can end with the blank label: the box shows for that send. */}
      {againNext && againSpans.length===1 && !againWait && printAllowed && <BlankOption id={`${uid}-again-blank`} checked={again.blank} disabled={busy} after={againNext.to} onChange={value=>setAgain(a=>a?{...a,blank:value}:a)} />}
    </div>;
  })() : null;
  return <div className="space-y-4">
    {connectionTarget && createPortal(connection,connectionTarget)}

    {/* Problems first: each part with its own state and its own fix. */}
    {!pending && failedParts.length>0 && <div role="alert" className="space-y-3 text-sm">
      {failedParts.map((part,i)=>{
        const bad=part.kind==='did-not-print';
        // Same words as the Runs list row, the printer bar and the run header.
        const words=officeProblemWords(part);
        const action=part.kind==='needs-check'?`Check ${nums(part.from,part.to)}…`:part.kind==='did-not-print'?`Print ${nums(part.from,part.to)} again…`:`Print ${nums(part.from,part.to)} again`;
        return <div key={`${part.requestId}-${part.from}-${part.kind}`} className="reveal arc-in space-y-1">
          <p className={`flex items-start gap-2 font-medium ${bad?'text-red-400':'text-amber-300'}`}><AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{words.title}: {nums(part.from,part.to)}</p>
          <p className="pl-6 text-zinc-300">{words.action}</p>
          {canPrint && <button type="button" disabled={busy} onClick={()=>openFix(part)} className={`btn ml-6 mt-1 ${owner==='problem' && i===0?'btn-primary':'btn-secondary btn-sm'}`}>{action}</button>}
        </div>;
      })}
      {ownBlocking && waiting.length>0 && <p className="text-zinc-400">{capitalise(waitingWords)} {single(waiting)?'is':'are'} waiting until {range(ownBlocking.from,ownBlocking.to)} {ownBlocking.from===ownBlocking.to?'is':'are'} sorted.</p>}
      {!canPrint && stationsLoaded && <p className="text-zinc-400">Ask someone who can print to check the office printer.</p>}
      {canPrint && !holdsStation && formAllowed && !sendOther && !reprintOf && <button type="button" className="btn btn-ghost btn-sm -ml-2 text-zinc-300" onClick={()=>{setSendOther(true);rangeEdited.current=false;}}>Send other labels instead…</button>}
    </div>}

    {pending && !posting && pendingPhase!=='unsure' && <p role="status" className="flex items-center gap-2 text-sm text-zinc-300 tabular-nums"><Loader2 className="size-4 animate-spin text-amber-400" aria-hidden="true" />{pendingPhase==='other'?`Sending ${range(pending.from,pending.to)} from another tab or window…`:`Checking whether the office got ${range(pending.from,pending.to)}…`}</p>}
    {unsure && pending && <div role="status" className="space-y-1 text-sm">
      <p className="flex items-start gap-2 font-medium text-amber-300"><AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />We’re not sure the office got {range(pending.from,pending.to)}</p>
      <p className="pl-6 text-zinc-300">{pendingWords}</p>
    </div>}
    {shownRefusal && !pending && <div role="alert" className="space-y-2 text-sm">
      {/* Same tone as the run header ("Needs you"): the icon and title carry it, the words stay plain. */}
      <p className="flex items-start gap-2 font-medium text-red-400"><AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{Range(shownRefusal.from,shownRefusal.to)} {shownRefusal.from===shownRefusal.to?'wasn’t':'weren’t'} sent</p>
      <p className="pl-6 text-zinc-300">{noAccess?'Ask your admin for print access.':shownRefusal.message}</p>
      {/* The button does the next useful thing; nothing here only hides the message. */}
      {owner==='refusal' && refusalStep==='resend' && <button type="button" disabled={busy || !printAllowed || !requestsEverLoaded || !canPrint} className="btn btn-primary ml-6" onClick={()=>{const again=shownRefusal;if(again.reason==='labels-changed')setProof(null);const end=Math.min(again.to,again.from+cap-1);void sendNow({from:again.from,to:end},undefined,false,again.endBlank===true && end===again.to);}}><PrinterIcon className="size-4" aria-hidden="true" />Send {nums(shownRefusal.from,Math.min(shownRefusal.to,shownRefusal.from+cap-1))} again</button>}
      {owner==='refusal' && refusalStep==='smaller' && <button type="button" disabled={busy || !printAllowed || !requestsEverLoaded || !canPrint} className="btn btn-primary ml-6" onClick={()=>{const again=shownRefusal;const end=Math.min(again.to,again.from+cap-1);void sendNow({from:again.from,to:end},undefined,false,again.endBlank===true && end===again.to);}}><PrinterIcon className="size-4" aria-hidden="true" />Send {nums(shownRefusal.from,Math.min(shownRefusal.to,shownRefusal.from+cap-1))} now</button>}
      {/* No room for the blank: a new request without it (never the refused one again), or back to the form. */}
      {owner==='refusal' && refusalStep==='without-blank' && <div className="ml-6 flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy || !printAllowed || !requestsEverLoaded || !canPrint} className="btn btn-primary" onClick={()=>{const again=shownRefusal;void sendNow({from:again.from,to:Math.min(again.to,again.from+cap-1)},undefined,false,false);}}><PrinterIcon className="size-4" aria-hidden="true" />Send {nums(shownRefusal.from,Math.min(shownRefusal.to,shownRefusal.from+cap-1))} without the blank label</button>
        <button type="button" disabled={busy} className="btn btn-ghost btn-sm text-zinc-300" onClick={()=>{const again=shownRefusal;clearRefusal();setEndBlank(false);rangeEdited.current=true;setFrom(String(again.from));setTo(String(again.to));setSendOther(true);}}>Choose other labels</button>
      </div>}
      {owner==='refusal' && refusalStep==='queue' && <button type="button" className="btn btn-primary ml-6" onClick={()=>{clearRefusal();setQueueOpen(true);requestAnimationFrame(()=>document.getElementById(`${uid}-queue`)?.scrollIntoView({block:'nearest',behavior:'smooth'}));}}>Show the office queue</button>}
      {owner==='refusal' && refusalStep==='sign-in' && <a className="btn btn-primary ml-6" href={`/login?next=${encodeURIComponent(`/runs/${runId}`)}`}>Sign in again</a>}
    </div>}

    {series && <div role="status" className="space-y-2 text-sm">
      <p className="flex items-center gap-2 text-zinc-100 tabular-nums"><Loader2 className="size-4 animate-spin text-amber-400" aria-hidden="true" />Part {series.index+1} of {series.total}: {series.phase==='checking'?`checking ${range(series.part.from,series.part.to)}${series.progress?` (${series.progress.completed.toLocaleString()} of ${series.progress.total.toLocaleString()})`:''}…`:`sending ${range(series.part.from,series.part.to)}…`}</p>
      <p className="text-zinc-400">Keep this page open until the last part is queued.</p>
      {/* A part still being checked isn't sent once stop is pressed, so the button says so; a part being sent finishes. */}
      {!stopAsked
        ?<button type="button" onClick={()=>{stopSeries.current=true;setStopAsked(series.phase==='checking'?(series.index>0?`Stopping after part ${series.index}…`:'Stopping…'):`Stopping after part ${series.index+1}…`);}} className="btn btn-secondary btn-sm">{series.phase==='checking'?`Don’t send part ${series.index+1}`:'Stop after this part'}</button>
        :<p className="flex flex-wrap items-center gap-x-3 gap-y-1"><button type="button" disabled className="btn btn-secondary btn-sm">{stopAsked}</button><button type="button" className="link" onClick={()=>{stopSeries.current=false;setStopAsked(null);}}>Keep going</button></p>}
    </div>}
    {!series && leftParts.length>0 && !cancelled && <div className="space-y-2 text-sm">
      {!pending && <p className="text-amber-300">{leftParts.length===1?`The last part (${range(leftParts[0].from,leftParts[0].to)}) wasn’t sent yet.`:`${leftParts.length} parts (${range(leftParts[0].from,leftParts[leftParts.length-1].to)}) weren’t sent yet.`}</p>}
      {!pending && <p className="text-zinc-400">{leftTrimmed?`${Range(leftTrimmed.from,leftTrimmed.to)} ${leftTrimmed.from===leftTrimmed.to?'is':'are'} already counted as printed, so ${leftTrimmed.from===leftTrimmed.to?'it’s':'they’re'} left out.`:''}</p>}
      {leftEndsBlank && <p className="text-zinc-400">The last part ends with one blank label, as chosen when the parts started.</p>}
      {pending
        ? <p className="text-zinc-400">{pendingInPlan?(partsAfterPending.length?`“Send again” then sends the other ${partsAfterPending.length===1?'part':`${partsAfterPending.length} parts`} (${range(partsAfterPending[0].from,partsAfterPending[partsAfterPending.length-1].to)}), one after another.`:'“Send again” finishes the last part.'):'Sort out the send above first, then send these.'}</p>
        : planPrinterHere
        ? <div className="flex flex-wrap items-center gap-2"><button type="button" disabled={busy || !canPrint || !status.canSend || !formReady || !printAllowed} onClick={()=>partsPlan && void runSeries({...partsPlan,parts:leftParts,next:0})} className={`btn ${owner==='parts'?'btn-primary':'btn-secondary'}`}><PrinterIcon className="size-4" aria-hidden="true" />{leftParts.length===1?'Send the last part':`Send the remaining ${leftParts.length} parts`}</button><button type="button" className="btn btn-ghost btn-sm text-zinc-300" onClick={()=>savePartsPlan(null)}>Don’t send them</button></div>
        : <p className="text-zinc-400">They were planned for another office printer. <button type="button" className="link" onClick={()=>savePartsPlan(null)}>Forget them</button></p>}
    </div>}

    {movingLine && <p role="status" className="text-sm text-amber-300">{movingLine}</p>}
    {moving && movingLine===null && !ownBlocking && !series && !heldWait && <p role="status" className="flex items-center gap-2 text-sm text-zinc-300 tabular-nums"><Loader2 className="size-4 animate-spin text-amber-400" aria-hidden="true" />{capitalise(waitingWords || plural(summary.onTheWay))} on {summary.onTheWay===1?'its':'their'} way to the office printer</p>}

    {/* Sent isn't printed: one question, one answer. */}
    {markShown && <div className="space-y-2 text-sm">
      <p className="text-zinc-100">Did {markWords} {single(markRanges)?'':'all '}come out?</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={()=>void onMarkPrinted()} className={`btn ${owner==='mark'?'btn-primary':'btn-secondary btn-sm'}`}><CheckCircle2 className="size-4" aria-hidden="true" />Yes, mark printed</button>
        {canPrint && status.canSend && <button type="button" disabled={busy || !printer} onClick={()=>openAgain('missing')} className="btn btn-ghost btn-sm text-zinc-300">Some didn’t…</button>}
      </div>
    </div>}

    {settled && !series && !leftParts.length && <div className="space-y-3">
      {printedCount>=total
        ? <p role="status" className="flex min-h-control items-center gap-2 text-sm font-medium text-emerald-400"><CheckCircle2 className="size-4 rounded-full animate-success" aria-hidden="true" />All {total.toLocaleString()} labels printed</p>
        : !moving && !markRanges.length && <p role="status" className="text-sm text-zinc-300">Every label has gone to the office printer.</p>}
      {canPrint && printedCount>0 && <button type="button" disabled={busy} onClick={()=>openAgain('again')} className="btn btn-ghost btn-sm -ml-2 text-zinc-300"><RotateCcw className="size-4" aria-hidden="true" />Print some labels again…</button>}
    </div>}
    {cancelledIdle && !settled && <div className="space-y-2">
      <p className="text-sm text-zinc-300">This run was cancelled after {printedCount.toLocaleString()} of {total.toLocaleString()} labels.</p>
      {canPrint && <button type="button" disabled={busy} onClick={()=>openAgain('again')} className="btn btn-ghost btn-sm -ml-2 text-zinc-300">Print some labels anyway…</button>}
    </div>}
    {/* The printer's line above names the run that stops it: said once, so here only the way there. */}
    {heldBlock && heldByRun && <div className="space-y-2 text-sm">
      <Link href={`/runs/${encodeURIComponent(heldByRun.run_id)}`} className={`btn ${owner==='held'?'btn-primary':'btn-secondary'}`}>Open “{heldByRun.run_name || 'that run'}”</Link>
    </div>}
    {status.stopped && !heldByRun && !ownHold && !pending && !settled && !movingLine && runStatus!=='draft' && <p className="text-sm text-zinc-400">You can’t send yet: the office printer is stopped until someone checks it.</p>}
    {printer && !canPrint && stationsLoaded && <p className="text-sm text-zinc-400">Your account can’t send labels to the office printer. Ask your admin for print access.</p>}

    {again && !again.requestId && againEditor}
    {showForm && !refusalOwnsSend && <>
    {(reprintOf || sendOther) && !pending && <div className="flex items-center justify-between gap-2 text-sm text-zinc-300"><span>{reprintOf?'Print these labels again.':'Choose which labels to send.'}</span><button type="button" className="btn btn-ghost btn-sm" onClick={()=>{setReprintOf('');setSendOther(false);rangeEdited.current=false;}}>Cancel</button></div>}
    {heldWait && <p role="status" className="text-sm text-zinc-300">{capitalise(spanWords(heldMoving))} {single(heldMoving)?'is':'are'} on {single(heldMoving)?'its':'their'} way to the office printer, after the reprint. Send more once {single(heldMoving)?'it’s':'they’re'} sent.</p>}
    {!pending && !chooseAgain && !reprintOf && !sendOther && heldOffer && <p className="text-sm text-zinc-300"><span className="font-medium text-zinc-100">Next: send {spanWords(heldUnsent)}.</span> {single(heldUnsent)?'It was':'They were'} held back so the reprint came out first.{heldCarriesBlank && endBlank?` Ends with one blank label after ${heldOffer.to.toLocaleString()}.`:''}</p>}
    {!pending && !chooseAgain && !reprintOf && !sendOther && !heldOffer && unsentSpans.length>0 && !(unsentSpans.length===1 && rangeValid && unsentSpans[0].from===fromNumber && unsentSpans[0].to===toNumber) && !toGoShown && <p className="text-sm text-zinc-300">{capitalise(spanWords(unsentSpans))} {single(unsentSpans)?'hasn’t':'haven’t'} gone to the office printer yet.</p>}
    {/* "Send again" resends the saved request, so the range boxes step aside. */}
    {!pending && <div className="grid grid-cols-3 gap-2">
      <label className="text-xs font-medium text-zinc-400">From label<input className={inputClass+' mt-1'} inputMode="numeric" disabled={!!pending || busy} value={from} onChange={e=>{rangeEdited.current=true;setFrom(e.target.value);}} /></label>
      <label className="text-xs font-medium text-zinc-400">Stop after label<input className={inputClass+' mt-1'} inputMode="numeric" disabled={!!pending || busy} value={to} onChange={e=>{rangeEdited.current=true;setTo(e.target.value);}} /></label>
      <label className="text-xs font-medium text-zinc-400">How many<input type="number" inputMode="numeric" min={1} max={Math.max(1,total-Number(from)+1)} disabled={!!pending || busy} className={inputClass+' mt-1'} value={rangeValid?sendCount:''} onChange={e=>{rangeEdited.current=true;const n=Number(e.target.value);if(Number(from)>=1 && n>=1)setTo(String(Math.min(total,Number(from)+Math.floor(n)-1)));}} /></label>
    </div>}
    {!pending && !rangeValid && (from.trim()!=='' || to.trim()!=='') && (!/^\d*$/.test(from.trim()) || !/^\d*$/.test(to.trim())) && <p role="alert" className="text-sm text-amber-300">Type one label number in each box, like 5.{/[-–,]/.test(from+to)?' For a list like 5–8, 12, use “Print some labels again…”.':''}</p>}
    {!pending && !rangeValid && from.trim()!=='' && to.trim()!=='' && /^\d*$/.test(from.trim()) && /^\d*$/.test(to.trim()) && <p role="alert" className="text-sm text-amber-300">Enter label numbers from 1 to {total.toLocaleString()}, with &ldquo;Stop after&rdquo; at or after &ldquo;From&rdquo;.</p>}
    {!pending && tooBig && parts.length>1 && <p className="text-sm text-zinc-400">Goes in parts of up to {plural(cap)}, one after another.</p>}
    {!pending && tooBig && parts.length<2 && <div className="space-y-1 text-sm text-amber-300"><p>The office printer takes up to {plural(cap)} of this design in one send.</p><button type="button" className="btn btn-ghost btn-sm -ml-2 text-zinc-100" onClick={()=>{rangeEdited.current=true;setTo(String(fromNumber+cap-1));}}>Send {nums(fromNumber,fromNumber+cap-1)} now</button></div>}
    {!pending && rangeValid && plan.kind==='wait' && <p role="status" className="text-sm text-zinc-400">{plan.why==='needs-check'?`${Range(plan.overlap.from,plan.overlap.to)} need a check first (see above).`:`${Range(plan.overlap.from,plan.overlap.to)} ${plan.overlap.from===plan.overlap.to?'is':'are'} still on the way to the office printer. Send these once ${plan.overlap.from===plan.overlap.to?'it’s':'they’re'} sent.`}</p>}
    {!pending && rangeValid && plan.kind==='reprint' && !tooBig && fixedRange.current!==`${fromNumber}-${toNumber}` && <p className="text-sm text-amber-300">{Range(plan.overlap.from,plan.overlap.to)} went to the office printer before, so this prints {plan.overlap.from===plan.overlap.to?'it':'them'} again.</p>}
    {!pending && alreadyPrinted && <div className="space-y-1 text-sm text-amber-300"><p>{Range(fromNumber,Math.min(toNumber,printedCount))} {fromNumber===Math.min(toNumber,printedCount)?'is':'are'} already counted as printed.</p>{printedCount<toNumber && <button type="button" className="btn btn-ghost btn-sm -ml-2 text-zinc-100" onClick={()=>{rangeEdited.current=true;setFrom(String(printedCount+1));}}>Send {nums(printedCount+1,toNumber)} instead</button>}</div>}
    {!printAllowed && printBlockedReason && <p className="text-sm text-amber-300">{printBlockedReason}</p>}
    {!formReady && !pending && <p role="status" className="text-sm text-zinc-400">Reading the office queue first…</p>}
    {/* A saved request is resent exactly as it was first sent, blank label included. */}
    {pending && pending.endBlank && !posting && <p className="text-sm text-zinc-400">It ends with one blank label after {range(pending.to,pending.to)}, as first sent.</p>}
    <button type="button" disabled={disabled} onClick={()=>void onPrimary()} className={`btn w-full ${owner==='form'||(owner==='pending' && (posting || pendingPhase==='unsure'))?'btn-primary':'btn-secondary'}`}>{busy?<Loader2 className="size-4 animate-spin" />:<PrinterIcon className="size-4" />}{primaryLabel}</button>
    {pending && unsure && <button type="button" onClick={()=>void startOver()} disabled={busy} className="btn btn-ghost btn-sm -ml-2 text-zinc-300">Start over</button>}
    {!pending && rangeValid && <BlankOption id={`${uid}-form-blank`} checked={endBlank} disabled={busy || !!series} after={toNumber} inParts={tooBig && parts.length>1} onChange={setEndBlank} />}
    </>}
    {directCheck && <div role="status" className="space-y-2 text-sm">
      <p className="flex items-center gap-2 text-zinc-300 tabular-nums"><Loader2 className="size-4 animate-spin text-amber-400" aria-hidden="true" />{directCheck.progress?`Checking ${range(directCheck.span.from,directCheck.span.to)}: ${directCheck.progress.completed.toLocaleString()} of ${directCheck.progress.total.toLocaleString()}… then it sends.`:`Checking ${range(directCheck.span.from,directCheck.span.to)}… then it sends.`}</p>
      <button type="button" onClick={()=>preparationController.current?.abort()} className="btn btn-secondary btn-sm">Stop</button>
    </div>}
    {bitmap && showForm && !pending && preparationProgress && !directCheck && <div role="status" className="space-y-2 text-sm">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-zinc-300 tabular-nums"><Loader2 className="size-4 animate-spin text-amber-400" aria-hidden="true" />Checked {preparationProgress.completed.toLocaleString()} of {preparationProgress.total.toLocaleString()} labels… nothing is sent yet.</p>
      <button type="button" onClick={()=>preparationController.current?.abort()} className="btn btn-secondary btn-sm">Stop checking</button>
    </div>}
    {bitmap && showForm && !pending && !preparationProgress && proofCurrent && proof && <p className="flex items-center gap-1.5 text-sm text-emerald-400"><CheckCircle2 className="size-4 rounded-full animate-success" aria-hidden="true" />{plural(proof.count)} checked. Nothing is sent until you press Send.</p>}
    {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
    {requestsError && requestsError.status!==401 && requestsError.status!==403 && <p role="status" className="text-sm text-zinc-400">The office queue couldn’t be read just now. It tries again on its own.</p>}
    {/* The amber waiting line already says why queued labels aren't printing. */}
    {notice && !(notice.queued && (movingLine || (markShown && !moving))) && <p role="status" className={`text-sm ${notice.tone==='next'?'reveal text-zinc-100':'animate-enter text-emerald-400'}`}>{notice.text}</p>}
    {requests.length>0 && <div>
      <FoldToggle open={queueOpen} onToggle={()=>setQueueOpen(v=>!v)} controls={`${uid}-queue`}>Office queue{queueWords && <span className="tabular-nums"> · {queueWords}</span>}</FoldToggle>
      <Fold open={queueOpen} id={`${uid}-queue`}>
      {requestsTruncated && <p className="pt-2 text-sm text-zinc-400">Showing the latest 100 sends.</p>}
      <ul className="max-h-96 overflow-y-auto space-y-4 pt-2 text-sm">
        {requests.map(r=>{
          // A send with many parts reads as one line; parts that need someone
          // are always listed, with their own button.
          const attention=(j:{review?:boolean;state:string})=>j.review || ['needs_review','rejected'].includes(j.state);
          const many=r.jobs.length>3;
          const open=!many || openSends.has(r.id);
          const shown=open?r.jobs:r.jobs.filter(attention);
          const counts=new Map<string,number>();
          for(const j of r.jobs){const word=attention(j)?'need attention':j.state==='sent_to_printer'||j.state==='resolved'?'sent to the printer':j.state==='cancelled'?'cancelled':'waiting';counts.set(word,(counts.get(word)??0)+1);}
          const tally=['sent to the printer','waiting','need attention','cancelled'].filter(w=>counts.get(w)).map(w=>`${counts.get(w)!.toLocaleString()} ${w}`).join(' · ');
          return <li key={r.id} className="space-y-1">
          <p className="font-medium text-zinc-100">{Range(r.range_from,r.range_to)}{r.reprint_of?' · printed again':''}</p>
          <p className="text-zinc-400">{[formatWhen(r.created_at),r.username].filter(Boolean).join(' · ')}</p>
          {many && <p className="text-zinc-300 tabular-nums">{r.jobs.length.toLocaleString()} batches · {tally}</p>}
          {shown.length>0 && <ul className="space-y-1">{foldJobs(shown,attention).map(j=><li key={j.id} className="text-zinc-300"><span className="tabular-nums">{nums(j.from,j.to)}</span>: {j.review && j.state!=='rejected'?'Needs a check':labels[j.state] ?? 'Unknown'}{j.reason && (j.review || ['rejected','needs_review'].includes(j.state)) && <span className="block text-zinc-400">{capitalise(plainJobReason(j.reason))}.</span>}
            {canPrint && !pending && (j.review || j.state==='needs_review') && <button type="button" disabled={busy} className="btn btn-ghost btn-sm -ml-2 block text-zinc-100" onClick={()=>openFix({from:j.from,to:j.to,reason:j.reason,requestId:r.id,jobIds:[j.id],didNotPrint:j.state==='rejected',kind:j.state==='rejected'?'did-not-print':'needs-check'})}>Record what happened</button>}
          </li>)}</ul>}
          <div className="flex flex-wrap gap-1 -ml-2">
            {many && <button type="button" aria-expanded={open} className="btn btn-ghost btn-sm text-zinc-300" onClick={()=>setOpenSends(prev=>{const next=new Set(prev);if(next.has(r.id))next.delete(r.id);else next.add(r.id);return next;})}>{open?'Hide batches':`Show all ${r.jobs.length.toLocaleString()} batches`}</button>}
            {canPrint && r.jobs.some(j=>j.state==='queued') && <button type="button" disabled={busy} className="btn btn-ghost btn-sm text-zinc-300" onClick={()=>void cancelWaiting(r)}>Cancel what hasn&apos;t been picked up</button>}
            {canPrint && !series && !pending && again?.requestId!==r.id && r.jobs.every(j=>!j.review && !['queued','claimed','submitted','needs_review','rejected'].includes(j.state)) && <button type="button" disabled={busy} className="btn btn-ghost btn-sm text-zinc-300" onClick={()=>openAgain('again',r.id)}><RotateCcw className="size-4" aria-hidden="true" />Print again…</button>}
          </div>
          {again?.requestId===r.id && againEditor && <div className="pt-1">{againEditor}</div>}
        </li>;})}
      </ul>
      </Fold>
    </div>}
    <Dialog open={!!fix} onClose={()=>setFix(null)} title={fix?`What came out for ${range(fix.part.from,fix.part.to)}?`:''} dismissible={!busy}>
      {fix && (()=>{
        const part=fix.part;const one=part.from===part.to;
        const words=officeProblemWords(part);
        const again=fixAgain(fix);
        const button=fix.seen==='all'?`Count ${nums(part.from,part.to)} as printed`:again?`Print ${nums(again.from,again.to)} again`:'Print again';
        return <>
        <p className="text-sm text-zinc-300">{part.kind==='did-not-print'
          ?`${words.step?`${words.step} first. `:''}Wait until the printer stops, then look at what came out.`
          :'The office computer didn’t confirm these. Wait until the printer stops, then look at what came out.'}</p>
        <fieldset className="space-y-1">
          <legend className="mb-1 text-sm text-zinc-100">Did any of {range(part.from,part.to)} come out?</legend>
          {([['none',one?'No, it didn’t come out':'None of them'],['some','Some of them'],['all',one?'Yes, it came out':'All of them']] as const).filter(([v])=>!(one && v==='some')).map(([value,text],i)=>(
            <label key={value} className="flex min-h-control cursor-pointer items-center gap-3 rounded-lg px-2 text-sm text-zinc-100 hover:bg-zinc-800">
              <input type="radio" name={`${uid}-seen`} value={value} checked={fix.seen===value} data-autofocus={i===0?true:undefined} onChange={()=>setFix(f=>f?{...f,seen:value}:f)} className="size-4 shrink-0 accent-amber-500" />{text}
            </label>))}
        </fieldset>
        {fix.seen==='some' && (()=>{const some=fixSome(fix);return <div className="space-y-2 text-sm">
          <label htmlFor={`${uid}-fix-some`} className="block font-medium text-zinc-100">Which labels didn’t come out?</label>
          <input id={`${uid}-fix-some`} className={inputClass} inputMode="text" autoComplete="off" autoFocus placeholder={`For example ${nums(part.from,Math.min(part.to,part.from+4))}`} aria-describedby={`${uid}-fix-some-help`} value={fix.againText} onChange={e=>{const text=e.target.value;setFix(f=>f?{...f,againText:text}:f);}} />
          <p id={`${uid}-fix-some-help`} className="text-zinc-400">The others are counted as printed.</p>
          {some.error && <p role="alert" className="text-amber-300">{some.error}</p>}
        </div>;})()}
        {fix.seen==='all' && <p className="text-sm text-zinc-300">{capitalise(range(part.from,part.to))} {one?'is':'are'} counted as printed. Nothing prints again.</p>}
        {again && fixLater && (fixLater.spans.length>0 || fixLater.atOffice.length>0) && <div className="space-y-1 text-sm">
          {fixLater.atOffice.length>0 && <p className="text-zinc-300">{capitalise(spanWords(fixLater.atOffice))} {single(fixLater.atOffice)?'is':'are'} already at the office and print{single(fixLater.atOffice)?'s':''} first.</p>}
          {fixLater.spans.length>0 && <fieldset className="space-y-1">
            <legend className="mb-1 text-zinc-100">{capitalise(spanWords(fixLater.spans))} {single(fixLater.spans)?'is':'are'} waiting behind {single([again])?'it':'them'}</legend>
            {([['in-order','Print in order',`Hold ${spanWords(fixLater.spans)} until the reprint is done.`],['let-run','Let them print first',`${capitalise(range(again.from,again.to))} come${again.from===again.to?'s':''} out after.`]] as const).map(([value,title,help])=>(
              <label key={value} className="flex min-h-control cursor-pointer items-start gap-3 rounded-lg px-2 py-2 hover:bg-zinc-800">
                <input type="radio" name={`${uid}-order`} value={value} checked={fix.order===value} onChange={()=>setFix(f=>f?{...f,order:value}:f)} className="mt-1 size-4 shrink-0 accent-amber-500" />
                <span className="space-y-0.5"><span className="block text-zinc-100">{title}</span><span className="block text-zinc-400">{help}</span></span>
              </label>))}
          </fieldset>}
          {fixLater.spans.length>0 && fix.order==='in-order' && <ol className="space-y-1 pl-2 text-zinc-300 tabular-nums">
            <li>1. Hold {spanWords(fixLater.spans)}</li>
            <li>2. Print {range(again.from,again.to)} again</li>
            <li>3. Then you send {spanWords(fixLater.spans)} (one tap, after the reprint)</li>
          </ol>}
        </div>}
        {again && <BlankOption id={`${uid}-fix-blank`} checked={fix.blank} disabled={busy} onChange={value=>setFix(f=>f?{...f,blank:value}:f)} firstHadBlank={sentWithBlank(part.requestId)}
          after={fix.order==='in-order' && fixLater && fixLater.spans.length?Math.max(...fixLater.spans.map(h=>h.to)):again.to} />}
        <label className="block text-sm text-zinc-300">Note for the print history (optional)
          <textarea className={inputClass+' mt-1 text-sm'} rows={2} maxLength={300} value={fix.note} onChange={e=>setFix(f=>f?{...f,note:e.target.value}:f)} />
        </label>
        {!fix.seen && <p className="text-sm text-zinc-400 sm:text-right">Choose what came out above to go on.</p>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn btn-secondary" onClick={()=>setFix(null)}>Cancel</button>
          <button type="button" disabled={busy || !fix.seen || (fix.seen!=='all' && !again)} className="btn btn-primary" onClick={saveFix}>{button}</button>
        </div>
      </>;})()}
    </Dialog>
  </div>;
}
