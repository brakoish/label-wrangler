'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
interface Printer { station_id:string; id:string; name:string; dpi:number; max_width_dots:number; last_seen:string|null; online:boolean; available:boolean; dispatch_enabled:boolean; paired_at:string|null; needs_review:boolean }
interface Job { id:string; from:number; to:number; count:number; state:string; review:boolean; reason:string|null; cupsJobId:number|null }
interface PrintRequest { id:string; range_from:number; range_to:number; reprint_of:string|null; username:string; jobs:Job[] }
async function api(path:string,init?:RequestInit){
  const response=await fetch(path,{...init,headers:{'Content-Type':'application/json',...init?.headers},cache:'no-store'});
  const result=await response.json();if(!response.ok)throw new Error(result.error || 'Request failed');return result;
}
const labels:Record<string,string>={queued:'Waiting for office',claimed:'Assigned to office',submitted:'Queued at office',sent_to_printer:'Sent to printer',rejected:'Rejected — check reason',needs_review:'Check printer before retrying',cancelled:'Cancelled before dispatch',resolved:'Reviewed by operator'};
const inputClass='w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm';
export function OfficePiPrinter({runId,total}:{runId:string;total:number}){
  const [printers,setPrinters]=useState<Printer[]>([]);const [selected,setSelected]=useState('');
  const [requests,setRequests]=useState<PrintRequest[]>([]);const [canPrint,setCanPrint]=useState(false);
  const [from,setFrom]=useState('1');const [to,setTo]=useState(String(total));
  const [error,setError]=useState('');const [notice,setNotice]=useState('');const [busy,setBusy]=useState(false);
  const [pending,setPending]=useState<{from:number;to:number}|null>(null);
  const [reprintOf,setReprintOf]=useState('');const [reason,setReason]=useState('');
  const [review,setReview]=useState<Job|null>(null);const [reviewReason,setReviewReason]=useState('');const [checked,setChecked]=useState(false);
  const inFlight=useRef(false);
  // Persist a submission identity before network I/O. An uncertain response,
  // reload or double-click retries this identity, never manufactures new jobs.
  const storageKey=`lw:office-pending:${runId}`;
  useEffect(()=>{
    const saved=localStorage.getItem(storageKey);
    if(saved){try{const data=JSON.parse(saved);setPending({from:data.from,to:data.to});setFrom(String(data.from));setTo(String(data.to));setReprintOf(data.reprintOf || '');setReason(data.reason || '');}catch{setError('The pending request record could not be read. Check the queue before clearing it.');}}
  },[storageKey]);
  const refresh=useCallback(async()=>{
    const [stationData,jobData]=await Promise.all([api('/api/office/stations'),api('/api/office/jobs?runId='+encodeURIComponent(runId))]);
    setPrinters(stationData.printers);setCanPrint(stationData.canPrint);setRequests(jobData.requests);
    setSelected(value=>value || (stationData.printers[0]?`${stationData.printers[0].station_id}/${stationData.printers[0].id}`:''));
  },[runId]);
  useEffect(()=>{
    let active=true;
    const update=()=>refresh().catch(err=>{if(active)setError(err.message);});
    void update();const timer=setInterval(()=>void update(),5000);
    return()=>{active=false;clearInterval(timer);};
  },[refresh]);
  const printer=printers.find(p=>`${p.station_id}/${p.id}`===selected);
  const submit=async()=>{
    if(inFlight.current || !printer)return;inFlight.current=true;setBusy(true);setError('');setNotice('');
    try{
      let payload;
      const saved=localStorage.getItem(storageKey);
      if(saved)payload=JSON.parse(saved);
      else{
        payload={runId,stationId:printer.station_id,printerId:printer.id,from:Number(from),to:Number(to),idempotencyKey:crypto.randomUUID(),...(reprintOf?{reprintOf,reason}: {})};
        localStorage.setItem(storageKey,JSON.stringify(payload));setPending({from:payload.from,to:payload.to});
      }
      const result=await api('/api/office/jobs',{method:'POST',body:JSON.stringify(payload)});
      localStorage.removeItem(storageKey);setPending(null);setNotice(`Queued labels ${payload.from}–${payload.to}. Request ${result.requestId.slice(0,8)}. You can close this page.`);
      setReprintOf('');setReason('');await refresh();
    }catch(err){setError(err instanceof Error?err.message:'Unable to queue labels');}
    finally{inFlight.current=false;setBusy(false);}
  };
  const act=async(action:()=>Promise<void>)=>{setBusy(true);setError('');try{await action();await refresh();}catch(err){setError(err instanceof Error?err.message:'Request failed');}finally{setBusy(false);}};
  const allJobs=requests.flatMap(r=>r.jobs);
  const sent=allJobs.filter(j=>j.state==='sent_to_printer').reduce((sum,j)=>sum+j.count,0);
  const queued=allJobs.filter(j=>['queued','claimed','submitted'].includes(j.state)).reduce((sum,j)=>sum+j.count,0);
  return <div className="space-y-3">
    <label className="block text-xs text-zinc-400">Office station / printer<select className={inputClass+' mt-1'} value={selected} onChange={e=>setSelected(e.target.value)}>
      {!printers.length && <option value="">No authorized office printer</option>}
      {printers.map(p=><option key={p.id} value={`${p.station_id}/${p.id}`}>{p.name}</option>)}
    </select></label>
    {printer && <div className="text-xs space-y-1 text-zinc-400">
      <p className={printer.online?'text-emerald-400':'text-amber-400'}>{printer.online?(printer.available?'Office online · printer available':'Office online · printer unavailable'):'Office offline · queued work waits for reconnect'}</p>
      <p>Last contact: {printer.last_seen?new Date(printer.last_seen).toLocaleString():'not paired yet'} · {printer.dpi} DPI</p>
      {!printer.dispatch_enabled && <p className="text-amber-400">Awaiting verified pairing and activation. Job creation is disabled.</p>}
      {printer.needs_review && <p className="text-red-400">Check printer before retrying. Dispatch is blocked until reviewed.</p>}
    </div>}
    <div className="grid grid-cols-2 gap-2">
      <label className="text-xs">From label<input aria-label="Office from label" className={inputClass} inputMode="numeric" disabled={!!pending} value={from} onChange={e=>setFrom(e.target.value)} /></label>
      <label className="text-xs">Through label<input aria-label="Office through label" className={inputClass} inputMode="numeric" disabled={!!pending} value={to} onChange={e=>setTo(e.target.value)} /></label>
    </div>
    {pending && <p className="text-xs text-amber-400">Pending submission for labels {pending.from}–{pending.to}. Retry checks the same request; it does not create another batch.</p>}
    {reprintOf && <div className="space-y-2 rounded border border-amber-700 p-2 text-xs"><p>Intentional reprint of request {reprintOf.slice(0,8)}. New job IDs will be created.</p><input className={inputClass} placeholder="Reason for reprint" value={reason} onChange={e=>setReason(e.target.value)} /><button onClick={()=>{setReprintOf('');setReason('');}}>Exit reprint mode</button></div>}
    <button disabled={busy || !canPrint || !printer?.dispatch_enabled || !!printer?.needs_review || (!!reprintOf && reason.trim().length<3)} onClick={()=>void submit()} className="w-full rounded bg-amber-500 p-2 text-sm font-semibold text-black disabled:opacity-40">{busy?'Working…':pending?'Retry same request':reprintOf?'Queue intentional reprint':'Queue at office'}</button>
    <p className="text-[11px] text-zinc-500">Queued: {queued} · Sent to printer: {sent} labels (includes reprints). Delivery does not confirm physical printing. No Dazzle or local driver required.</p>
    {error && <div role="alert" className="text-xs text-red-400 space-y-2"><p>{error}</p><p>Retry keeps the same request ID. If this was a validation error, check the queue below before changing the request.</p><button onClick={()=>{localStorage.removeItem(storageKey);setPending(null);setError('');}} className="underline">Clear pending request form (does not cancel queued jobs)</button></div>}
    {notice && <p role="status" className="text-xs text-emerald-400">{notice}</p>}
    <div className="max-h-96 overflow-y-auto space-y-3">
      {requests.map(r=><div key={r.id} className="rounded border border-zinc-800 p-2 space-y-2 text-xs">
        <p className="font-medium">Labels {r.range_from}–{r.range_to} · {r.username}{r.reprint_of?' · reprint':''}</p>
        <p className="text-zinc-500">Request {r.id.slice(0,8)}</p>
        <details><summary className="cursor-pointer text-zinc-400">{r.jobs.length} batches · {r.jobs.filter(j=>j.state==='sent_to_printer').length} sent</summary>
          {r.jobs.map(j=><div key={j.id} className="border-t border-zinc-800 py-2"><p>{j.from}–{j.to}: {j.review?'Check printer before retrying':labels[j.state]}</p>{j.reason && <p className="text-zinc-500">{j.reason}</p>}{j.cupsJobId && <p className="text-zinc-500">Office CUPS job {j.cupsJobId}</p>}
            {canPrint && (j.review || ['claimed','submitted','needs_review','rejected'].includes(j.state)) && <button disabled={busy} className="mt-1 text-amber-400 underline" onClick={()=>{setReview(j);setChecked(false);setReviewReason('');}}>Review outcome</button>}
          </div>)}
        </details>
        {canPrint && r.jobs.some(j=>j.state==='queued') && <button disabled={busy} className="text-amber-400 underline" onClick={()=>void act(async()=>{const result=await api('/api/office/jobs/'+r.id,{method:'DELETE'});setNotice(`Cancelled ${result.cancelled} unclaimed batches. ${result.requires_review} assigned batches require review; no CUPS cancellation was sent.`);})}>Cancel unclaimed batches</button>}
        {canPrint && r.jobs.every(j=>!j.review && !['queued','claimed','submitted','needs_review'].includes(j.state)) && <button className="ml-2 text-amber-400 underline" onClick={()=>{setReprintOf(r.id);setFrom(String(r.range_from));setTo(String(r.range_to));}}>Reprint with reason</button>}
      </div>)}
    </div>
    {review && <div role="dialog" aria-label="Review office print outcome" className="rounded border border-amber-600 bg-zinc-950 p-3 space-y-3 text-xs">
      <p className="font-semibold">Review labels {review.from}–{review.to}</p>
      <p>Check the physical printer and office CUPS queue. Finish or cancel pending local work before resolving. This button cannot stop the printer.</p>
      <label className="flex gap-2"><input type="checkbox" checked={checked} onChange={e=>setChecked(e.target.checked)} />I checked the printer and no pending CUPS job can print these labels later.</label>
      <textarea className={inputClass} placeholder="What printed, what failed, and how pending work was resolved" value={reviewReason} onChange={e=>setReviewReason(e.target.value)} />
      <button disabled={busy || !checked || reviewReason.trim().length<3} className="rounded bg-amber-500 p-2 text-black disabled:opacity-40" onClick={()=>void act(async()=>{await api('/api/office/review',{method:'POST',body:JSON.stringify({jobId:review.id,pendingCupsResolved:checked,reason:reviewReason})});setReview(null);setNotice('Review recorded. No reprint was created.');})}>Record resolution</button>
      <button className="ml-3" onClick={()=>setReview(null)}>Close</button>
    </div>}
  </div>;
}
