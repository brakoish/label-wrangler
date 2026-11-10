'use client';
import { useEffect, useState } from 'react';
import { isNetworkError, OFFLINE_MESSAGE } from '@/lib/userMessages';
import { safeNextPath } from '@/lib/safeRedirect';
import { PageTitle } from '@/components/PageTitle';

function nextPath(){
  return safeNextPath(new URLSearchParams(window.location.search).get('next'), window.location.origin);
}
export default function LoginPage(){
  const [error,setError]=useState('');const [busy,setBusy]=useState(false);
  const [missing,setMissing]=useState<{username?:boolean;password?:boolean}>({});
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
  return <main className="min-h-dvh grid place-items-center p-4 sm:p-6"><PageTitle title="Sign in" />{/* method="post": if the page's script hasn't loaded (a slow phone, a
    stale tab), the browser's own submit sends the fields in the request body
    to this page, which just shows the form again. Never a GET, which would
    put the username and password in the address bar, history and logs. */}
  <form noValidate method="post" className="w-full max-w-sm space-y-4 p-2 sm:p-6" onSubmit={async(e)=>{
    e.preventDefault();
    const form=new FormData(e.currentTarget);
    // Say what is missing in the page's own words, next to the field.
    const empty={username:!String(form.get('username') ?? '').trim(),password:!String(form.get('password') ?? '')};
    setMissing(empty);
    if(empty.username||empty.password){(e.currentTarget.elements.namedItem(empty.username?'username':'password') as HTMLInputElement|null)?.focus();return;}
    setBusy(true);setError('');
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
    {/* The same mark as the nav bar, so sign-in looks like the app it opens. */}
    <img src="/logo.png" alt="" aria-hidden="true" width={48} height={48} className="size-12" style={{ filter: 'brightness(0) invert(1)' }} />
    <h1 className="text-xl font-semibold text-zinc-100">Label Wrangler</h1>
    <p className="-mt-2 text-sm text-zinc-400">Sign in with your office account.</p>
    <label htmlFor="login-username" className="field-label">Username</label>
    <input id="login-username" required name="username" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} aria-invalid={missing.username||undefined} aria-describedby={missing.username?'login-username-missing':undefined} onInput={()=>missing.username&&setMissing(m=>({...m,username:false}))} className="field -mt-2.5 text-base" />
    {missing.username && <p id="login-username-missing" className="-mt-2.5 text-sm text-red-400">Enter your username.</p>}
    <label htmlFor="login-password" className="field-label">Password</label>
    <input id="login-password" required name="password" type="password" autoComplete="current-password" aria-invalid={missing.password||undefined} aria-describedby={missing.password?'login-password-missing':undefined} onInput={()=>missing.password&&setMissing(m=>({...m,password:false}))} className="field -mt-2.5 text-base" />
    {missing.password && <p id="login-password-missing" className="-mt-2.5 text-sm text-red-400">Enter your password.</p>}
    <label className="flex min-h-11 items-center gap-3 text-sm text-zinc-300"><input name="staySignedIn" type="checkbox" className="check" />Stay signed in for 30 days</label>
    {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
    <button disabled={busy} className="btn btn-primary w-full">{busy?'Signing in…':'Sign in'}</button>
    <p className="text-sm text-zinc-400">Forgot your password? Ask your admin to reset it.</p>
  </form></main>;
}
