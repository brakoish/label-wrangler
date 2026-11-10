// Login throttle: successful sign-ins never stay counted, lockout ends after a
// fixed window, and the message says when. In-memory fake of the two tables.
require('../thermal/register.cjs');
const assert=require('node:assert/strict');
const path=require('node:path');
const {scryptSync,randomBytes}=require('node:crypto');
let now=0;const attempts=new Map();const sessions=[];
const salt=randomBytes(16).toString('hex');
const user={id:'u1',username:'owner',password_hash:`${salt}:${scryptSync('right-password',salt,64).toString('hex')}`,disabled:false};
const fakeSql=(strings,...v)=>{const q=strings.join('?');
 if(q.startsWith('INSERT INTO office_login_attempts')){const key=v[0];const row=attempts.get(key);
  if(!row||row.window_start<now-15*60)attempts.set(key,{attempts:1,window_start:now});else row.attempts++;
  return Promise.resolve([{attempts:attempts.get(key).attempts}]);}
 if(q.startsWith('SELECT CEIL')){const row=attempts.get(v[0]);return Promise.resolve([{minutes:Math.ceil((row.window_start+15*60-now)/60)}]);}
 if(q.startsWith('SELECT * FROM office_users'))return Promise.resolve(v[0]===user.username?[user]:[]);
 if(q.startsWith('INSERT INTO office_sessions')){sessions.push(v[0]);return Promise.resolve([]);}
 if(q.startsWith('DELETE FROM office_login_attempts')){attempts.delete(v[0]);return Promise.resolve([]);}
 throw new Error('unexpected SQL '+q);};
const mock=(file,exports)=>{require.cache[file]={id:file,filename:file,loaded:true,exports,children:[],paths:[]};};
mock(path.resolve('src/lib/office/db.ts'),{officeSql:()=>fakeSql});
mock(require.resolve('next/headers'),{cookies:async()=>({set(){},get(){return undefined;}})});
const {login}=require('../../src/lib/office/auth.ts');
(async()=>{
 const fail=()=>assert.rejects(login('owner','wrong'),e=>e.status===401);
 // Successes refund their slot and clear earlier failures, repeatedly.
 for(let round=0;round<5;round++){for(let i=0;i<9;i++)await fail();await login('owner','right-password');}
 assert.equal(attempts.size,0);
 // 10 failures lock the account; even the right password is refused, with a clear time.
 for(let i=0;i<10;i++)await fail();
 now+=4*60;
 await assert.rejects(login('owner','right-password'),e=>e.status===429&&/Try again in 11 minutes/.test(e.message)&&/already signed in keep working/.test(e.message));
 // Continued attempts do not extend the lockout: it ends 15 minutes after it started.
 for(let i=0;i<20;i++){now+=30;await assert.rejects(login('owner','wrong'),e=>e.status===429);}
 now=15*60+1;
 const ok=await login('owner','right-password');assert.equal(ok.username,'owner');assert.equal(attempts.size,0);
 // Wrong passwords are still rejected (verification unchanged), including unknown users.
 await assert.rejects(login('nobody','right-password'),e=>e.status===401);
 console.log('PASS login throttle: successes never stay counted, finite 15-minute lockout with remaining time, verification unchanged');
})().catch(e=>{console.error(e);process.exitCode=1;});
