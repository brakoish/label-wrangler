'use client';
import { useEffect, useState } from 'react';
import { isNetworkError, OFFLINE_MESSAGE } from '@/lib/userMessages';

function nextPath(){
  const next=new URLSearchParams(window.location.search).get('next') || '/runs';
  return next.startsWith('/') && !next.startsWith('//') && !next.includes('\\') ? next : '/runs';
}
export default function LoginPage(){
  const [error,setError]=useState('');const [busy,setBusy]=useState(false);
  useEffect(()=>{
    const controller=new AbortController();
    // Older Strict cookies may be absent on an external navigation but are
    // available to this same-origin session check. Do not ask for login again.
    void fetch('/api/office/session',{cache:'no-store',signal:controller.signal})
      .then(response=>response.ok?response.json():null)
      .then(result=>{if(result?.user && !controller.signal.aborted)window.location.replace(nextPath());})
      .catch(()=>{}); // Leave the normal login form available on failure.
    return ()=>controller.abort();
  },[]);
  return <main className="min-h-screen grid place-items-center p-6"><form className="w-full max-w-sm rounded-xl border border-zinc-800 bg-zinc-950 p-6 space-y-4" onSubmit={async(e)=>{
    e.preventDefault();setBusy(true);setError('');
    const form=new FormData(e.currentTarget);
    try{
      const username=String(form.get('username') ?? '').trim();
      const response=await fetch('/api/office/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password:form.get('password'),staySignedIn:form.get('staySignedIn')==='on'})});
      const result=await response.json().catch(()=>({}));
      if(!response.ok){
        // Server trouble reads differently from a wrong password.
        if(response.status>=500)throw new Error('Label Wrangler is having trouble right now. Try again in a minute.');
        throw new Error(result.error || 'That username and password didn\u2019t work. Check them and try again.');
      }
      window.location.assign(nextPath());
    }catch(err){setError(isNetworkError(err)?OFFLINE_MESSAGE:err instanceof Error?err.message:'Sign-in didn\u2019t work. Try again.');setBusy(false);}
  }}>
    <h1 className="text-xl font-semibold text-amber-400">Label Wrangler</h1>
    <p className="text-sm text-zinc-400">Sign in with your office account.</p>
    <label htmlFor="login-username" className="block text-sm">Username</label>
    <input id="login-username" required name="username" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} className="-mt-3 w-full rounded border border-zinc-700 bg-zinc-900 p-2 text-base" />
    <label htmlFor="login-password" className="block text-sm">Password</label>
    <input id="login-password" required name="password" type="password" autoComplete="current-password" className="-mt-3 w-full rounded border border-zinc-700 bg-zinc-900 p-2 text-base" />
    <label className="flex items-center gap-2 text-sm"><input name="staySignedIn" type="checkbox" className="accent-amber-500" />Stay signed in for 30 days</label>
    {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
    <button disabled={busy} className="w-full min-h-11 rounded bg-amber-500 p-2 font-semibold text-black disabled:opacity-50">{busy?'Signing in…':'Sign in'}</button>
    <p className="text-xs text-zinc-500">Forgot your password? Ask Will to reset your password.</p>
  </form></main>;
}
