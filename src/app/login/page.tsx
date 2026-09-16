'use client';
import { useState } from 'react';
export default function LoginPage(){
  const [error,setError]=useState('');const [busy,setBusy]=useState(false);
  return <main className="min-h-screen grid place-items-center p-6"><form className="w-full max-w-sm rounded-xl border border-zinc-800 bg-zinc-950 p-6 space-y-4" onSubmit={async(e)=>{
    e.preventDefault();setBusy(true);setError('');
    const form=new FormData(e.currentTarget);
    try{
      const response=await fetch('/api/office/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:form.get('username'),password:form.get('password')})});
      const result=await response.json();if(!response.ok)throw new Error(result.error);
      const next=new URLSearchParams(window.location.search).get('next') || '/runs';
      window.location.assign(next.startsWith('/') && !next.startsWith('//') && !next.includes('\\')?next:'/runs');
    }catch(err){setError(err instanceof Error?err.message:'Unable to sign in');setBusy(false);}
  }}>
    <h1 className="text-xl font-semibold text-amber-400">Label Wrangler</h1>
    <p className="text-sm text-zinc-400">Sign in with your office account.</p>
    <label className="block text-sm">Username<input required name="username" autoComplete="username" className="mt-1 w-full rounded bg-zinc-900 p-2" /></label>
    <label className="block text-sm">Password<input required name="password" type="password" autoComplete="current-password" className="mt-1 w-full rounded bg-zinc-900 p-2" /></label>
    {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
    <button disabled={busy} className="w-full rounded bg-amber-500 p-2 font-semibold text-black disabled:opacity-50">{busy?'Signing in…':'Sign in'}</button>
  </form></main>;
}
