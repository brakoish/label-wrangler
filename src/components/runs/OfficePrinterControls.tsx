'use client';
import { Loader2, Pause, Play } from 'lucide-react';
import { useCallback,useEffect,useState,useRef } from 'react';
import { confirmDialog } from '@/components/ui/feedback';
import { friendlyError } from '@/lib/userMessages';
type Control={id:string;action:string;result:{state:string;reason:string}|null};
type State={canControl:boolean;status:{paused:boolean|null;fresh:boolean}|null;controls:Control[]};
const resultWords:Record<string,string>={failed:'didn’t go through',rejected:'was refused',expired:'timed out',succeeded:'worked'};
export function OfficePrinterControls(){
 const [data,setData]=useState<State|null>(null);const [error,setError]=useState('');const [busy,setBusy]=useState(false);const sending=useRef(false);
 const key='lw:office-control-pending';
 const refresh=useCallback(async()=>{const r=await fetch('/api/office/controls',{cache:'no-store'});const d=await r.json();if(!r.ok)throw new Error(d.error);setData(d);},[]);
 useEffect(()=>{const update=()=>void refresh().catch(e=>setError(friendlyError(e,'Could not read the office printer status.')));update();const t=setInterval(update,2000);return()=>clearInterval(t);},[refresh]);
 const send=async(action:string)=>{if(sending.current)return;sending.current=true;setBusy(true);setError('');try{
  const saved=localStorage.getItem(key);const payload=saved?JSON.parse(saved):{action,idempotencyKey:crypto.randomUUID()};
  if(saved && payload.action!==action)throw new Error(`An earlier "${payload.action==='pause'?'Pause':'Resume'}" hasn’t been confirmed yet. Tap "Try again" to finish it first.`);
  localStorage.setItem(key,JSON.stringify(payload));const r=await fetch('/api/office/controls',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const d=await r.json();if(!r.ok)throw new Error(d.error);
  localStorage.removeItem(key);await refresh();
 }catch(e){setError(friendlyError(e,'The printer didn’t get the request.'));}finally{sending.current=false;setBusy(false);}};
 const requestPause=async()=>{
  const ok=await confirmDialog({title:'Pause the office printer?',body:'This pauses the shared office printer for everyone, not just this run. It stops after the label it is printing now. Anything waiting stays in line until someone taps Resume.',confirmLabel:'Pause printer',danger:true});
  if(ok)void send('pause');
 };
 const pending=data?.controls.some(c=>!c.result);const fresh=data?.status?.fresh;const paused=data?.status?.paused;
 const disabled=busy || !!pending || !data?.canControl || !fresh;
 const actions=paused===true?['resume']:paused===false?['pause']:['pause','resume'];
 const last=data?.controls[0];
 const statusWord=!data?'Checking the printer…':pending?'Waiting for the printer to confirm…':!fresh?'Office computer not reporting':paused===null?'Printer status unknown':paused?'Printer paused':'Printing normally';
 const tone=!data||pending?'text-zinc-400':fresh && paused===false?'text-emerald-400':'text-amber-300';
 const dot=!data||pending?'bg-zinc-500':fresh && paused===false?'bg-emerald-400':'bg-amber-300';
 // One row: the printer's state in words, and one button that changes it.
 return <div className="space-y-2 text-sm">
  <div className="flex min-h-control items-center justify-between gap-3">
   <p role="status" className={`flex min-w-0 items-center gap-2 ${tone}`}><span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${dot}`} />{statusWord}</p>
   {data?.canControl && <div className="flex shrink-0 gap-2">{actions.map(action=><button type="button" key={action} disabled={disabled} onClick={()=>action==='pause'?void requestPause():void send(action)} className="btn btn-secondary btn-sm">{busy?<Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />:action==='pause'?<Pause className="h-4 w-4 animate-icon" aria-hidden="true" />:<Play className="h-4 w-4 animate-icon" aria-hidden="true" />}{action==='pause'?'Pause printer':'Resume printer'}</button>)}</div>}
  </div>
  {data && !data.canControl && <p className="text-zinc-400">Your account can&apos;t pause or resume this printer.</p>}
  {data?.canControl && !fresh && <p className="text-zinc-400">Pause and Resume work again once the office computer reports in.</p>}
  {last?.result && last.result.state!=='succeeded' && !pending && <p role="status" className="text-amber-300">The last {last.action==='pause'?'Pause':'Resume'} {resultWords[last.result.state] ?? 'didn’t finish'}. Check the status before trying again.</p>}
  {error && <div role="alert" className="space-y-1 text-red-400"><p>{error}</p>{(()=>{try{return localStorage.getItem(key);}catch{return null;}})() && <button type="button" onClick={()=>{const saved=localStorage.getItem(key);if(saved)void send(JSON.parse(saved).action);}} className="btn btn-ghost btn-sm -ml-2 text-red-400">Try again</button>}</div>}
 </div>;
}
