'use client';
import { Pause, Play } from 'lucide-react';
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
 return <div className="border-t border-zinc-800/60 pt-3 space-y-2 text-xs">
  <div className="flex items-center justify-between text-[11px]"><span className="text-zinc-400 font-medium">Office printer controls</span><span className={fresh && paused===false?'text-emerald-400':'text-amber-400'}>{!data?'Checking…':!fresh?'Office not reporting':paused===null?'Status unknown':paused?'Paused':'Ready'}</span></div>
  <p className="text-[11px] leading-relaxed text-zinc-500">Pauses or resumes the office printer for everyone. It can take a few seconds.</p>
  <div className="flex gap-2">{actions.map(action=><button type="button" key={action} disabled={disabled} onClick={()=>action==='pause'?void requestPause():void send(action)} className="flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-md border border-zinc-800 px-2 text-xs font-medium text-zinc-300 hover:text-amber-400 hover:border-amber-500/50 disabled:opacity-40">{action==='pause'?<Pause className="h-3.5 w-3.5" />:<Play className="h-3.5 w-3.5" />}{action==='pause'?'Pause printer':'Resume printer'}</button>)}</div>
  {data && !data.canControl && <p className="text-[11px] text-zinc-500">Your account can&apos;t pause or resume this printer.</p>}
  {data?.canControl && !fresh && <p className="text-[11px] text-zinc-500">Pause and Resume come back when the office computer reports in.</p>}
  {pending && <p role="status" className="text-[11px] text-amber-400">Waiting for the printer to confirm…</p>}
  {last?.result && last.result.state!=='succeeded' && <p role="status" className="text-[11px] text-amber-400">The last {last.action==='pause'?'Pause':'Resume'} {resultWords[last.result.state] ?? 'didn’t finish'}. Check the status above before trying again.</p>}
  {error && <div role="alert" className="space-y-1 text-red-400"><p>{error}</p>{(()=>{try{return localStorage.getItem(key);}catch{return null;}})() && <button type="button" onClick={()=>{const saved=localStorage.getItem(key);if(saved)void send(JSON.parse(saved).action);}} className="underline">Try again</button>}</div>}
 </div>;
}
