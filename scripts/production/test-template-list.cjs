// Template list: summary rows carry counts computed in SQL, never artwork,
// and keep the response shape the library uses.
const h=require('./route-harness.cjs');
const assert=require('node:assert/strict');
const {getTableColumns}=require('drizzle-orm');
const {templates}=require('../../src/lib/db/schema.ts');
const route=require('../../src/app/api/templates/route.ts');
(async()=>{
 h.reset();
 h.results.push([{id:'t',name:'T',description:null,formatId:'f',thermalRenderMode:'native-v1',archivedAt:null,createdAt:'c',updatedAt:'u',counts:{n:5,d:2}},{id:'e',name:'E',description:null,formatId:'f',thermalRenderMode:'native-v1',archivedAt:null,createdAt:'c',updatedAt:'u',counts:null}]);
 const res=await route.GET(new Request('https://example.test/api/templates?offset=0'));
 const body=await res.json();
 assert.deepEqual(body[0],{id:'t',name:'T',description:null,formatId:'f',thermalRenderMode:'native-v1',archivedAt:null,createdAt:'c',updatedAt:'u',elements:[],summaryOnly:true,elementCount:5,dynamicCount:2});
 assert.equal(body[1].elementCount,0);assert.equal(body[1].dynamicCount,0);
 const selection=h.log[0][0][1][0];
 assert.ok(!Object.values(selection).includes(getTableColumns(templates).elements),'list must not select the raw elements column');
 assert.equal(Object.keys(selection).filter(k=>k==='counts').length,1);
 console.log('PASS template list: counts from one SQL pass, no artwork selected, response shape unchanged');
})().catch(e=>{console.error(e);process.exitCode=1;});
