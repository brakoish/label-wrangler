// Additive release migration. Existing runs freeze CURRENT artwork, not a
// reconstruction of their original print. No templates/progress are changed.
require('../thermal/register.cjs');require('@next/env').loadEnvConfig(process.cwd(),false);
const {neon}=require('@neondatabase/serverless');
const {db}=require('../../src/lib/db/index.ts');
const {runs}=require('../../src/lib/db/schema.ts');
const {captureDesign}=require('../../src/lib/runDesign.server.ts');
const {eq,and,isNull}=require('drizzle-orm');
(async()=>{
 const sql=neon(process.env.DATABASE_URL);
 await sql`ALTER TABLE runs ADD COLUMN IF NOT EXISTS design_snapshot jsonb`;
 const pending=await db.selectDistinct({templateId:runs.templateId}).from(runs).where(isNull(runs.designSnapshot));
 let captured=0;
 for(const {templateId} of pending){
   const design={...await captureDesign(templateId),legacy:true};
   const changed=await db.update(runs).set({designSnapshot:design}).where(and(eq(runs.templateId,templateId),isNull(runs.designSnapshot))).returning({id:runs.id});
   captured+=changed.length;
 }
 console.log(JSON.stringify({column:'runs.design_snapshot',existingRunsCaptured:captured,templateOrProgressChanges:0}));
})().catch(e=>{console.error(e.message);process.exitCode=1});
