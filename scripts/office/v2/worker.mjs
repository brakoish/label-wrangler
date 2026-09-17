// Explicit operator-run preparation worker; never claims or sends printer work.
import nextEnv from '@next/env';
import { neon } from '@neondatabase/serverless';
import { preparationStore, prepareTask } from './preparation.mjs';
import generator from './generator.cjs';
const args=process.argv.slice(2);
if(args.includes('--revision')) { console.log(generator.revision); process.exit(0); }
if(!args.includes('--once') && !args.includes('--serve')) throw new Error('Choose --once or --serve; no implicit service activation');
const schema=args.find(arg=>arg.startsWith('--schema='))?.slice(9);
if(!schema || !/^(v2_prepare_test_[0-9]+|office_v2_inactive)$/.test(schema)) throw new Error('Explicit isolated --schema is required');
nextEnv.loadEnvConfig(process.cwd(),false);
const sql=neon(process.env.DATABASE_URL);
const q=async(statement,params=[])=>{
 const result=await sql.transaction([sql.query(`SET LOCAL search_path TO ${schema},pg_catalog`),sql.query(statement,params)]);
 return result[1];
};
const store=preparationStore(q);
let stopping=false;
process.on('SIGTERM',()=>{stopping=true;});
process.on('SIGINT',()=>{stopping=true;});
do {
 const task=await store.claim(generator.revision);
 if(task){
  let leaseLost=false;
  const timer=setInterval(()=>{store.renew(task).catch(()=>{leaseLost=true;});},15000);
  try{
   await prepareTask(store,task,async function*(snapshot,next){
    for await(const feed of generator.feeds(snapshot,next)){
     if(leaseLost||stopping)throw new Error('preparation_interrupted');
     yield feed;
    }
   });
   console.log(JSON.stringify({id:task.id,state:'prepared'}));
  }catch(error){
   const code=error instanceof Error?error.message:'';
   if(['invalid_snapshot','payload_quota','feed_quota'].includes(code))await store.fail(task,code);
   // DB/network/ambiguous commit errors retain checkpoint and await lease reclaim.
   console.error(JSON.stringify({id:task.id,state:'preparation_stopped',code:['invalid_snapshot','payload_quota','feed_quota','preparation_interrupted'].includes(code)?code:'storage_or_render_failure'}));
   process.exitCode=1; stopping=true;
  }finally{clearInterval(timer);}
 }
 if(args.includes('--once')||stopping)break;
 await new Promise(resolve=>setTimeout(resolve,2000));
}while(!stopping);
