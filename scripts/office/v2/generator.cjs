/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const { createHash } = require('node:crypto');
const resolve = Module._resolveFilename;
Module._resolveFilename = function(specifier,...rest) { return resolve.call(this,specifier.startsWith('@/')?path.resolve('src',specifier.slice(2)):specifier,...rest); };
require.extensions['.ts'] = function(mod,file) { mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file); };
const { generateZPL } = require('../../../src/lib/zplGenerator.ts');
const { validateLayout, prepareServerImages } = require('../../../src/lib/office/render.ts');
const { previewLabelValues } = require('../../../src/lib/runBuilder.ts');
// Includes generator dependencies and worker protocol code. Resume requires exactly the same digest.
const files = [...Object.keys(require.cache).filter(file=>file.startsWith(path.resolve('src')+path.sep)),...['package-lock.json','scripts/office/v2/generator.cjs','scripts/office/v2/preparation.mjs','scripts/office/v2/manifest.mjs'].map(file=>path.resolve(file))].sort();
const fingerprint = createHash('sha256');
for(const file of files) fingerprint.update(path.relative(process.cwd(),file)).update('\0').update(fs.readFileSync(file)).update('\0');
const revision = fingerprint.digest('hex');
async function* feeds(snapshot,nextFeed) {
 const {run,template,format,from,to,dpi,maxWidth}=snapshot;
 const {across}=validateLayout(template,format,dpi,maxWidth);
 if(!Number.isSafeInteger(from)||!Number.isSafeInteger(to)||from<1||to<from||to-from+1>5000||!Array.isArray(run.sourceData)||to>run.sourceData.length) throw new Error('invalid_snapshot');
 const graphics=await prepareServerImages(template,format);
 const firstRow=Math.floor((from-1)/across)*across;
 for(let first=firstRow+nextFeed*across;first<to;first+=across){
  const lanes=[],values=[];
  for(let lane=0;lane<across;lane++){
   const index=first+lane;
   if(index<from-1||index>=to){lanes.push(null);values.push(undefined);continue;}
   const value=previewLabelValues(run,index);
   for(const text of Object.values(value)) if(typeof text!=='string'||text.length>8192||/[\^~\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text))throw new Error('invalid_snapshot');
   lanes.push(index+1);values.push(value);
  }
  const zpl=generateZPL(template,format,values,{imageGraphics:graphics}).replace('^XA','^XA\n^PON\n^LH0,0\n^LT0\n^LS0\n^PQ1');
  yield {lanes,bytes:Buffer.from(zpl)};
 }
}
module.exports={revision,feeds};
