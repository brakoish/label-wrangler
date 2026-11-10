// Serve the pdf.js worker from the installed pdfjs-dist so the API and worker
// versions always match ("API version does not match Worker version").
// Runs before `next dev` / `next build`; offline, copies one file.
const fs=require('node:fs'),path=require('node:path');
const source=require.resolve('pdfjs-dist/build/pdf.worker.min.mjs');
const target=path.resolve(__dirname,'..','public','pdf.worker.min.mjs');
const next=fs.readFileSync(source);
if(!fs.existsSync(target)||!fs.readFileSync(target).equals(next)){fs.writeFileSync(target,next);console.log(`pdf.js worker updated to ${require('pdfjs-dist/package.json').version}`);}
