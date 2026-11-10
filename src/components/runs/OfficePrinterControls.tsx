'use client';
import { Loader2, Pause, Play } from 'lucide-react';
import { useCallback,useEffect,useState,useRef } from 'react';
import { confirmDialog } from '@/components/ui/feedback';
import { controlFailure } from '@/lib/officeSendOutcome';
type Control={id:string;action:string;result:{state:string;reason:string}|null};
type State={canControl:boolean;status:{paused:boolean|null;fresh:boolean}|null;controls:Control[]};
const resultWords:Record<string,string>={failed:'didn’t go through',rejected:'was refused',expired:'timed out',succeeded:'worked'};
class ControlError extends Error{constructor(message:string,public status:number){super(message);}}
/**
 * Pause and Resume for the shared office printer, from any page (run page,
 * Runs list). Same endpoint, payload and saved idempotency key as before.
 * `attention`: something on the page needs a check, so the status never
 * reads "Printing normally" next to a failed job.
 */
export function OfficePrinterControls({attention=false,onUnavailable}:{attention?:boolean;
 /** Called once when this account can't see the office printer at all (401/403 on read). */
 onUnavailable?:()=>void}={}){
 const [data,setData]=useState<State|null>(null);const [error,setError]=useState('');const [busy,setBusy]=useState(false);const sending=useRef(false);
 const [canRetry,setCanRetry]=useState(false);
 const key='lw:office-control-pending';
 const reported=useRef(false);
 const readError=useRef('');
 const refresh=useCallback(async()=>{const r=await fetch('/api/office/controls',{cache:'no-store'});const d=await r.json().catch(()=>({}));if(!r.ok)throw new ControlError(typeof d.error==='string'?d.error:'',r.status);setData(d);setError(e=>e && e===readError.current?'':e);},[]);
 useEffect(()=>{
  let active=true;
  const update=()=>{if(typeof document!=='undefined' && document.visibilityState==='hidden')return;void refresh().catch(e=>{
   if(!active)return;
   const status=e instanceof ControlError?e.status:0;
   if((status===401||status===403) && !reported.current){reported.current=true;onUnavailable?.();}
   const m=status===401?'You’re signed out. Sign in again to see the office printer.':status===403?'Your account can’t see the office printer.':'The office printer status couldn’t be read just now.';
   readError.current=m;setError(m);
  });};
  update();const t=setInterval(update,2000);return()=>{active=false;clearInterval(t);};
 },[refresh,onUnavailable]);
 const send=async(action:string)=>{if(sending.current)return;sending.current=true;setBusy(true);setError('');setCanRetry(false);try{
  let saved:string|null=null;try{saved=localStorage.getItem(key);}catch{saved=null;}
  let payload:{action:string;idempotencyKey:string};
  try{payload=saved?JSON.parse(saved):{action,idempotencyKey:crypto.randomUUID()};}catch{localStorage.removeItem(key);saved=null;payload={action,idempotencyKey:crypto.randomUUID()};}
  if(saved && payload.action!==action){setError(`An earlier “${payload.action==='pause'?'Pause':'Resume'}” hasn’t been confirmed yet. Tap “Try again” to finish it first.`);setCanRetry(true);return;}
  localStorage.setItem(key,JSON.stringify(payload));
  let r:Response;
  try{r=await fetch('/api/office/controls',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});}
  catch{setError('The printer didn’t get the request. Check your connection, then tap “Try again”. It’s the same request, so it won’t happen twice.');setCanRetry(true);return;}
  if(!r.ok){
   // A definite refusal clears the saved request; anything unsure keeps it
   // so "Try again" reuses the same key.
   const outcome=controlFailure(r.status);
   if(!outcome.keep)localStorage.removeItem(key);
   setError(outcome.message);setCanRetry(outcome.keep);return;
  }
  localStorage.removeItem(key);await refresh().catch(()=>{});
 }finally{sending.current=false;setBusy(false);}};
 const requestPause=async()=>{
  const ok=await confirmDialog({title:'Pause the office printer?',body:'This pauses the shared office printer for everyone, not just this run. It stops after the label it’s printing now. Anything waiting stays in line until someone taps Resume.',confirmLabel:'Pause printer',danger:true});
  if(ok)void send('pause');
 };
 useEffect(()=>{try{if(localStorage.getItem(key))setCanRetry(true);}catch{/* nothing saved */}},[]);
 const pending=data?.controls.some(c=>!c.result);const fresh=data?.status?.fresh;const paused=data?.status?.paused;
 const disabled=busy || !!pending || !data?.canControl || !fresh;
 const actions=paused===true?['resume']:paused===false?['pause']:['pause','resume'];
 const last=data?.controls[0];
 const statusWord=!data?'Checking the printer…':pending?'Waiting for the printer to confirm…':!fresh?'Office computer not reporting':paused===null?'Printer status unknown':paused?'Printer paused':attention?'Printer running, but a print needs a check':'Printing normally';
 const ok=!!data && !pending && fresh && paused===false && !attention;
 const tone=!data||pending?'text-zinc-400':ok?'text-emerald-400':'text-amber-300';
 const dot=!data||pending?'bg-zinc-500':ok?'bg-emerald-400':'bg-amber-300';
 // One row: the printer's state in words, and one button that changes it.
 return <div className="space-y-2 text-sm">
  <div className="flex min-h-control flex-wrap items-center justify-between gap-x-3 gap-y-1">
   <p role="status" className={`flex min-w-0 items-center gap-2 ${tone}`}><span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${dot}`} />{statusWord}</p>
   {data?.canControl && <div className="flex shrink-0 gap-2">{actions.map(action=><button type="button" key={action} disabled={disabled} onClick={()=>action==='pause'?void requestPause():void send(action)} className="btn btn-secondary btn-sm">{busy?<Loader2 className="size-4 animate-spin" aria-hidden="true" />:action==='pause'?<Pause className="size-4 animate-icon" aria-hidden="true" />:<Play className="size-4 animate-icon" aria-hidden="true" />}{action==='pause'?'Pause printer':'Resume printer'}</button>)}</div>}
  </div>
  {data && !data.canControl && <p className="text-zinc-400">Your account can&apos;t pause or resume this printer.</p>}
  {data?.canControl && !fresh && <p className="text-zinc-400">Pause and Resume work again once the office computer reports in.</p>}
  {last?.result && last.result.state!=='succeeded' && !pending && <p role="status" className="text-amber-300">The last {last.action==='pause'?'Pause':'Resume'} {resultWords[last.result.state] ?? 'didn’t finish'}. Check the status before trying again.</p>}
  {error && <div role="alert" className="space-y-1 text-red-400"><p>{error}</p>{canRetry && <button type="button" disabled={busy} onClick={()=>{let saved:string|null=null;try{saved=localStorage.getItem(key);}catch{saved=null;}if(saved){try{void send(JSON.parse(saved).action);}catch{localStorage.removeItem(key);setCanRetry(false);}}}} className="btn btn-ghost btn-sm -ml-2 text-red-400">Try again</button>}</div>}
 </div>;
}
