'use client';
import { Pause, Play } from 'lucide-react';
import { useCallback,useEffect,useState,useRef } from 'react';
type Control={id:string;action:string;result:{state:string;reason:string}|null};
type State={canControl:boolean;status:{paused:boolean|null;fresh:boolean}|null;controls:Control[]};
export function OfficePrinterControls(){
 const [data,setData]=useState<State|null>(null);const [error,setError]=useState('');const [busy,setBusy]=useState(false);const sending=useRef(false);
 const key='lw:office-control-pending';
 const refresh=useCallback(async()=>{const r=await fetch('/api/office/controls',{cache:'no-store'});const d=await r.json();if(!r.ok)throw new Error(d.error);setData(d);},[]);
 useEffect(()=>{const update=()=>void refresh().catch(e=>setError(e.message));update();const t=setInterval(update,2000);return()=>clearInterval(t);},[refresh]);
 const send=async(action:string)=>{if(sending.current)return;sending.current=true;setBusy(true);setError('');try{
  const saved=localStorage.getItem(key);const payload=saved?JSON.parse(saved):{action,idempotencyKey:crypto.randomUUID()};
  if(saved && payload.action!==action)throw new Error('Retry the pending action first to resolve its delivery.');
  localStorage.setItem(key,JSON.stringify(payload));const r=await fetch('/api/office/controls',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const d=await r.json();if(!r.ok)throw new Error(d.error);
  localStorage.removeItem(key);await refresh();
 }catch(e){setError(e instanceof Error?e.message:'Control failed');}finally{sending.current=false;setBusy(false);}};
 const pending=data?.controls.some(c=>!c.result);const fresh=data?.status?.fresh;
 return <div className="border-t border-zinc-800/60 pt-3 space-y-2 text-xs">
  <div className="flex items-center justify-between text-[11px]"><span className="text-zinc-500">Printer status</span><span className={fresh && data?.status?.paused===false?'text-emerald-400':'text-amber-400'}>{!fresh?'Offline / stale':data?.status?.paused===null?'Unknown':data?.status?.paused?'Paused':'Ready'}</span></div>
  <div className="flex gap-2">{['pause','resume'].map(action=><button key={action} disabled={busy || !!pending || !data?.canControl || !fresh} onClick={()=>void send(action)} className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-zinc-800 px-2 py-1.5 text-[11px] font-medium text-zinc-400 hover:text-amber-400 hover:border-amber-500/50 disabled:opacity-40">{action==='pause'?<Pause className="h-3 w-3" />:<Play className="h-3 w-3" />}{action==='pause'?'Pause printer':'Resume printer'}</button>)}</div>
  <p className="text-[11px] leading-relaxed text-zinc-500">Pause holds all jobs after the current label. Controls may take a few seconds.</p>
  {pending && <p role="status" className="text-[11px] text-amber-400">Waiting for printer confirmation…</p>}
  {data?.controls[0]?.result && data.controls[0].result.state!=='succeeded' && <p role="status" className="text-[11px] text-amber-400">Last {data.controls[0].action}: {data.controls[0].result.state}. Check printer status before retrying.</p>}
  {error && <div role="alert" className="text-red-400"><p>{error}</p><button onClick={()=>{const saved=localStorage.getItem(key);if(saved)void send(JSON.parse(saved).action);}} className="underline">Retry same action</button><p>Check latest printer status before a new action.</p></div>}
 </div>;
}
