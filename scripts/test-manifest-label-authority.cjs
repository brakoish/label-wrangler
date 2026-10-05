// Hermetic regression of the actual search handler. No DB/network/print writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync('src/app/api/nabis/search/route.ts', 'utf8');
const tag = '1A4120300001A94000000352';
const current = {
  id: 1, metrcPackageId: 1516575, packageTag: tag, productName: 'Higher Vibrations - RoseWater - 3.5g',
  quantity: 2, unitOfMeasure: 'Each', thcPercent: 31.7874, thcMgG: 317.87,
  tacPercent: 36.6422, tacMgG: 366.42, batchNumber: 'HVRW-0426', lotNumber: 'HVRW-0426',
  testPerformedDate: '2026-06-01', coaDocumentId: 103618,
  units: [{ retailId: 'fixture-unit-1', index: 1 }, { retailId: 'fixture-unit-2', index: 2 }],
};
const stale = { ...current, label: tag, thcPercent: 28.1915, thcMgG: 281.92,
  tacPercent: 32.4903, tacMgG: 324.9, batchNumber: 'product-name-placeholder', lotNumber: 'product-name-placeholder' };
const oldMetrc = [
  { LabTestResultId: 1, TestPerformedDate: '2026-04-15', TestTypeName: 'Total THC (%)', TestResultLevel: 28.1915 },
  { LabTestResultId: 1, TestPerformedDate: '2026-04-15', TestTypeName: 'Total Cannabinoids (%)', TestResultLevel: 32.4903 },
  { LabTestResultId: 2, TestPerformedDate: '2026-06-01', TestTypeName: 'Total THC (%)', TestResultLevel: 31.7874 },
];
async function search({ query=tag, database=true, payload=current, failManifest=false }={}) {
  const calls=[]; const exports={};
  const fetch=async (input, options)=>{
    const url=new URL(String(input));calls.push({ path:url.pathname, cache:options?.cache });
    if(url.hostname==='manifest.invalid' && url.pathname.includes('/label-data/'))return failManifest?new Response('',{status:503}):Response.json(payload);
    if(url.hostname==='metrc.invalid' && url.pathname==='/labtests/v2/results')return Response.json({Data:oldMetrc});
    throw Error('Unstubbed request: '+url.pathname);
  };
  const sandbox={exports,console,URL,Buffer,Response,fetch,process:{env:{MANIFEST_API_BASE_URL:'https://manifest.invalid/api',
    MANIFEST_DATABASE_URL:database?'fixture-only':undefined,METRC_LICENSE_DISTRIBUTOR:'fixture-DX1',METRC_BASE_URL:'https://metrc.invalid',METRC_INTEGRATOR_KEY:'fixture',METRC_USER_KEY:'fixture'}},
    require:(name)=>{if(name==='@/lib/office/guard')return{withOfficeAuth:fn=>fn};if(name==='next/server')return{NextResponse:Response};if(name==='@neondatabase/serverless')return{neon:()=>async()=>[stale]};throw Error('Unexpected import '+name);}};
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,sandbox);
  const response=await exports.GET({nextUrl:new URL('http://fixture.invalid/api/nabis/search?q='+encodeURIComponent(query))});
  return {status:response.status,body:await response.json(),calls};
}
(async()=>{
  let count=0;
  for(const options of [{query:tag},{query:'RoseWater'},{query:tag,database:false}]){
    const result=await search(options);assert.equal(result.status,200);assert.equal(result.body.packages.length,2);
    for(const row of result.body.packages){assert.equal(row.thcPercent,'31.79');assert.equal(row.thcMgG,'317.87');assert.equal(row.tacPercent,'36.64');assert.equal(row.tacMgG,'366.42');assert.equal(row.lotNumber,'HVRW-0426');assert.equal(row.batchNumber,'HVRW-0426');assert.equal(row.coaDocumentId,'103618');assert.equal(row.testPerformedDate,'6/1/26');}
    assert.equal(result.calls.length,1,'Successful Manifest response must not trigger raw Metrc lab fallback');assert.equal(result.calls[0].cache,'no-store');count++;
  }
  const missing=await search({payload:{...current,tacPercent:null,tacMgG:null,lotNumber:null,batchNumber:null}});
  for(const row of missing.body.packages){assert.equal(row.tacPercent,'');assert.equal(row.tacMgG,'');assert.equal(row.lotNumber,'');assert.equal(row.batchNumber,'');}
  assert.equal(missing.calls.length,1);count++;
  const capped=await search({payload:{...current,quantity:1}});assert.equal(capped.body.packages.length,1);assert.equal(capped.body.packages[0].retailId,'fixture-unit-1');count++;
  // Keep the pre-existing unavailable-Manifest fallback behavior outside this patch.
  const fallback=await search({failManifest:true});assert.equal(fallback.status,200);assert(fallback.calls.some(c=>c.path==='/labtests/v2/results'));count++;
  console.log(`PASS: ${count} actual-handler cases; authoritative exact/name imports, missing-value preservation, row caps and fallback compatibility. No external requests.`);
})().catch(e=>{console.error(e.message);process.exit(1)});
