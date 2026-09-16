'use client';
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
 return <div className="border-t border-zinc-800 pt-3 space-y-2 text-xs">
  <p className="text-zinc-300">Printer: {!fresh?'Status stale / controls offline':data?.status?.paused===null?'Unknown':data?.status?.paused?'Paused':'Ready / unpaused'}</p>
  <p className="text-[11px] text-zinc-500">Pauses this Zebra after the current label. All jobs on this printer wait until resumed. Control delivery may take a few seconds.</p>
  <div className="flex gap-2">{['pause','resume'].map(action=><button key={action} disabled={busy || !!pending || !data?.canControl || !fresh} onClick={()=>void send(action)} className="flex-1 rounded border border-zinc-700 px-2 py-2 text-zinc-200 hover:border-amber-500 disabled:opacity-40">{action==='pause'?'Pause printer':'Resume printer'}</button>)}</div>
  {data?.controls[0] && <p className="text-zinc-400">Last {data.controls[0].action}: {data.controls[0].result?`${data.controls[0].result.state} · ${data.controls[0].result.reason}`:'pending confirmation'}</p>}
  {error && <div role="alert" className="text-red-400"><p>{error}</p><button onClick={()=>{const saved=localStorage.getItem(key);if(saved)void send(JSON.parse(saved).action);}} className="underline">Retry same action</button><p>Check latest printer status before a new action.</p></div>}
 </div>;
}
