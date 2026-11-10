'use client';
import { Loader2, Pause, Play } from 'lucide-react';
import { useCallback,useEffect,useState,useRef } from 'react';
import { confirmDialog } from '@/components/ui/feedback';
import { controlFailure } from '@/lib/officeSendOutcome';
type Control={id:string;action:string;result:{state:string;reason:string}|null};
type State={canControl:boolean;status:{paused:boolean|null;fresh:boolean}|null;controls:Control[];userId?:string};
const resultWords:Record<string,string>={failed:'didn’t go through',rejected:'was refused',expired:'timed out',succeeded:'worked'};
class ControlError extends Error{constructor(message:string,public status:number){super(message);}}
/** The saved pause/resume request, per account (older builds kept one per device). */
const LEGACY_KEY='lw:office-control-pending';
const keyFor=(userId?:string)=>userId?`${LEGACY_KEY}:${userId}`:LEGACY_KEY;
function readSaved(userId?:string){
 try{
  const own=localStorage.getItem(keyFor(userId));if(own)return own;
  // Carry an older device-wide request over to this account once.
  const legacy=userId?localStorage.getItem(LEGACY_KEY):null;
  if(legacy && userId){localStorage.setItem(keyFor(userId),legacy);localStorage.removeItem(LEGACY_KEY);}
  return legacy;
 }catch{return null;}
}
/**
 * Pause and Resume for the shared office printer, from any page (run page,
 * Runs list). Same endpoint, payload and saved idempotency key as before.
 * The page shows the printer's one status line (from the stations list), so
 * this only shows the button, unless `showStatus` asks for its own words.
 * Reads every 2 s while a pause or resume is on its way, every 15 s otherwise,
 * and not at all while the page is hidden.
 */
export function OfficePrinterControls({attention=false,showStatus=false,onUnavailable,onChange}:{attention?:boolean;showStatus?:boolean;
 /** Called once when this account can't see the office printer at all (401/403 on read). */
 onUnavailable?:()=>void;
 /** Called after a pause or resume is confirmed or settles, so the page re-reads the printer. */
 onChange?:()=>void}={}){
 const [data,setData]=useState<State|null>(null);const [error,setError]=useState('');const [busy,setBusy]=useState(false);const sending=useRef(false);
 const [canRetry,setCanRetry]=useState(false);
 const userId=data?.userId;
 const key=keyFor(userId);
 const reported=useRef(false);
 const readError=useRef('');
 const lastPending=useRef(false);
 const refresh=useCallback(async()=>{const r=await fetch('/api/office/controls',{cache:'no-store'});const d=await r.json().catch(()=>({}));if(!r.ok)throw new ControlError(typeof d.error==='string'?d.error:'',r.status);setData(d);setError(e=>e && e===readError.current?'':e);},[]);
 const pending=!!data?.controls.some(c=>!c.result);
 // Tell the page once a pending pause or resume settles.
 useEffect(()=>{if(lastPending.current && !pending)onChange?.();lastPending.current=pending;},[pending,onChange]);
 useEffect(()=>{
  let active=true;
  const update=()=>{if(typeof document!=='undefined' && document.visibilityState==='hidden')return;void refresh().catch(e=>{
   if(!active)return;
   const status=e instanceof ControlError?e.status:0;
   if((status===401||status===403) && !reported.current){reported.current=true;onUnavailable?.();}
   const m=status===401?'You’re signed out. Sign in again to see the office printer.':status===403?'Your account can’t see the office printer.':'The office printer status couldn’t be read just now.';
   readError.current=m;setError(m);
  });};
  update();const t=setInterval(update,pending||busy?2000:15000);
  const onVisible=()=>{if(document.visibilityState==='visible')update();};
  document.addEventListener('visibilitychange',onVisible);
  return()=>{active=false;clearInterval(t);document.removeEventListener('visibilitychange',onVisible);};
 },[refresh,onUnavailable,pending,busy]);
 const send=async(action:string)=>{if(sending.current)return;sending.current=true;setBusy(true);setError('');setCanRetry(false);try{
  const saved=readSaved(userId);
  let payload:{action:string;idempotencyKey:string};
  try{payload=saved?JSON.parse(saved):{action,idempotencyKey:crypto.randomUUID()};}catch{try{localStorage.removeItem(key);}catch{/* nothing saved */}payload={action,idempotencyKey:crypto.randomUUID()};}
  const resend=!!saved;
  if(saved && payload.action!==action){setError(`An earlier “${payload.action==='pause'?'Pause':'Resume'}” hasn’t been confirmed yet. Tap “Try again” to finish it first.`);setCanRetry(true);return;}
  // Saved before the request, so a lost answer is retried with the same key.
  try{localStorage.setItem(key,JSON.stringify(payload));}catch{setError('This device can’t save the request, so it wasn’t sent. Check that the browser allows saving site data.');return;}
  let r:Response;
  try{r=await fetch('/api/office/controls',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});}
  catch{setError('The printer didn’t get the request. Check your connection, then tap “Try again”. It’s the same request, so it won’t happen twice.');setCanRetry(true);return;}
  if(!r.ok){
   // A definite refusal clears the saved request; anything unsure keeps it
   // so "Try again" reuses the same key. A resend keeps it when signed out
   // or refused access, because the first try may already have arrived.
   const answer=await r.json().catch(()=>({}));
   const outcome=controlFailure(r.status,typeof answer.code==='string'?answer.code:undefined,resend);
   if(!outcome.keep){try{localStorage.removeItem(key);}catch{/* nothing saved */}}
   setError(outcome.message);setCanRetry(outcome.keep);await refresh().catch(()=>{});return;
  }
  try{localStorage.removeItem(key);}catch{/* nothing saved */}await refresh().catch(()=>{});onChange?.();
 }finally{sending.current=false;setBusy(false);}};
 const requestPause=async()=>{
  const ok=await confirmDialog({title:'Pause the office printer?',body:'This pauses the shared office printer for everyone, not just this run. It stops after the label it’s printing now. Anything waiting stays in line until someone taps Resume.',confirmLabel:'Pause printer',danger:true});
  if(ok)void send('pause');
 };
 useEffect(()=>{if(readSaved(userId))setCanRetry(true);},[userId]);
 const fresh=data?.status?.fresh;const paused=data?.status?.paused;
 const disabled=busy || pending || !data?.canControl || !fresh;
 const actions=paused===true?['resume']:paused===false?['pause']:['pause','resume'];
 const last=data?.controls[0];
 const statusWord=!data?'Checking the printer…':pending?'Waiting for the printer to confirm…':!fresh?'Office computer not reporting':paused===null?'Printer status unknown':paused?'Paused':attention?'Stopped for a check':'Printing normally';
 const ok=!!data && !pending && fresh && paused===false && !attention;
 const tone=!data||pending?'text-zinc-400':ok?'text-emerald-400':'text-amber-300';
 const dot=!data||pending?'bg-zinc-500':ok?'bg-emerald-400':'bg-amber-300';
 const buttons=data?.canControl && <div className="flex shrink-0 gap-2">{actions.map(action=><button type="button" key={action} disabled={disabled} onClick={()=>action==='pause'?void requestPause():void send(action)} className="btn btn-secondary btn-sm">{busy?<Loader2 className="size-4 animate-spin" aria-hidden="true" />:action==='pause'?<Pause className="size-4 animate-icon" aria-hidden="true" />:<Play className="size-4 animate-icon" aria-hidden="true" />}{action==='pause'?'Pause printer':'Resume printer'}</button>)}</div>;
 const notes=<>
  {data?.canControl && !fresh && !pending && <p className="text-zinc-400">Pause and Resume work again once the office computer reports in.</p>}
  {last?.result && last.result.state!=='succeeded' && !pending && <p role="status" className="text-amber-300">The last {last.action==='pause'?'Pause':'Resume'} {resultWords[last.result.state] ?? 'didn’t finish'}. Check the status before trying again.</p>}
  {error && <div role="alert" className="space-y-1 text-red-400"><p>{error}</p>{canRetry && <button type="button" disabled={busy} onClick={()=>{const saved=readSaved(userId);if(saved){try{void send(JSON.parse(saved).action);}catch{try{localStorage.removeItem(key);}catch{/* nothing saved */}setCanRetry(false);}}}} className="btn btn-ghost btn-sm -ml-2 text-red-400">Try again</button>}</div>}
 </>;
 if(!showStatus){
  if(!buttons && !error)return null;
  return <div className="space-y-2 text-sm">{buttons}{notes}</div>;
 }
 // One row: the printer's state in words, and one button that changes it.
 return <div className="space-y-2 text-sm">
  <div className="flex min-h-control flex-wrap items-center justify-between gap-x-3 gap-y-1">
   <p role="status" className={`flex min-w-0 items-center gap-2 ${tone}`}><span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${dot}`} />{statusWord}</p>
   {buttons}
  </div>
  {notes}
 </div>;
}
