// Sheet/browser SVG output: barcode viewBox is numeric, and every
// interpolated style value is escaped (stored XSS regression).
require('../thermal/register.cjs');
const assert=require('node:assert/strict');
require('./fake-svg-dom.cjs').install();
const {barcodeViewBox}=require('../../src/lib/barcodeViewBox.ts');
const {renderSheetLabelSvg}=require('../../src/lib/sheetPrint.ts');
(async()=>{
 assert.equal(barcodeViewBox('400px','96px'),'0 0 400 96');
 assert.equal(barcodeViewBox('218','142'),'0 0 218 142');
 assert.equal(barcodeViewBox(null,'oops'),'0 0 200 100');
 assert.equal(barcodeViewBox('-5px','0'),'0 0 200 100');
 const format={id:'f',name:'f',type:'sheet',width:2,height:1,sheetWidth:8.5,sheetHeight:11};
 const base={id:'b',x:0.1,y:0.1,width:1.5,height:0.5,rotation:0,zIndex:0,isStatic:true};
 const svg=await renderSheetLabelSvg([{...base,type:'barcode',content:'1A40603000012345',barcodeFormat:'CODE128',showText:true}],format,{});
 const viewBox=svg.match(/<svg x="[^"]*"[^>]*viewBox="([^"]*)"/)[1];
 assert.match(viewBox,/^0 0 \d+(\.\d+)? \d+(\.\d+)?$/,`barcode viewBox must be numeric, got "${viewBox}"`);
 assert.ok(svg.includes('<rect'),'barcode bars missing');

 // Stored-XSS regression: hostile values that bypass validation (old rows,
 // direct DB edits) are escaped, and numbers are coerced, in the sheet SVG.
 const evil='bold"/><image href="x" onerror="alert(1)"/><text x="';
 const hostile=await renderSheetLabelSvg([
  {...base,type:'text',content:'<script>x</script>',fontFamily:'A"onload="x',fontSize:'12" onclick="x',fontWeight:evil,textAlign:'left',color:'red" onmouseover="x',lineHeight:1.2},
  {...base,x:'1" onclick="x',type:'rectangle',strokeWidth:1,strokeColor:'"><script>',fillColor:'"/>',borderRadius:'0" a="'},
  {...base,type:'line',strokeWidth:'1"><script>',color:'#000"/>',lineStyle:'dashed'},
  {...base,type:'image',src:'data:image/png;base64,AA"/><script>x</script>',objectFit:'cover'},
 ],{...format,width:'2"><script>'},{});
 assert.ok(!/<script|<image href="x"|\son[a-z]+="/i.test(hostile.replace(/&quot;|&lt;|&gt;|&amp;/g,'_')),'unescaped markup in sheet SVG: '+hostile);
 assert.ok(hostile.includes('font-weight="bold&quot;/&gt;'),'fontWeight not escaped');
 const {buildSheetPrintHtml}=require('../../src/lib/sheetPrint.ts');
 const html=await buildSheetPrintHtml({id:'r',name:'<img src=x onerror=alert(1)>',sourceData:['a'],totalLabels:1,printedCount:0},{elements:[{...base,type:'text',content:'v',fontWeight:evil,textAlign:'left',fontSize:10}]},{...format,columns:1,rows:1,sheetWidth:'8.5}</style><script>x</script>'},{autoPrint:false});
 assert.ok(!/<img src=x|<image href="x"|<\/style><script>x/.test(html),'unescaped markup in sheet print HTML');
 // API validation: style values are escaped wherever they render, so unknown
 // list values are coerced (legacy rows still save) and only values that
 // would reach unescaped ZPL are refused.
 const {validate}=require('../../src/lib/validation.ts');
 const el={id:'e',type:'text',x:0,y:0,width:1,height:1,rotation:0,zIndex:0,isStatic:true,content:'x',fontFamily:'Arial',fontSize:10,fontWeight:'bold',textAlign:'left',color:'#000000',lineHeight:1.2};
 validate({elements:[el]},'template');
 validate({elements:[{...el,fontWeight:700,fontStyle:'italic',verticalAlign:'middle',fontFamily:'ABCDEF+Arial-BoldMT',color:'rgb(0, 0, 0)'}]},'template');
 validate({elements:[{...el,id:'r',type:'rectangle',strokeColor:'#000',fillColor:'',strokeWidth:1,borderRadius:0}]},'global');
 for(const [bad,key,expected] of [[{fontWeight:evil},'fontWeight','normal'],[{fontStyle:'oblique"'},'fontStyle','normal'],[{textAlign:'justify'},'textAlign','left'],[{verticalAlign:'x'},'verticalAlign','top']]){
  const data={elements:[{...el,...bad}]};validate(data,'template');assert.equal(data.elements[0][key],expected,JSON.stringify(bad));
 }
 const coerced=(extra)=>{const data={elements:[{...el,...extra}]};validate(data,'template');return data.elements[0];};
 assert.equal(coerced({id:'b',type:'barcode',barcodeFormat:'CODE128"'}).barcodeFormat,'CODE128');
 assert.equal(coerced({id:'i',type:'image',src:'data:image/png;base64,AA',objectFit:'scale-down'}).objectFit,'contain');
 // Colors and fonts are stored as written; the sheet output above escapes them.
 assert.equal(coerced({color:'red" onclick="x'}).color,'red" onclick="x');
 // QR correction reaches ZPL unescaped: separators are refused, '' prints as M.
 assert.throws(()=>validate({elements:[{...el,id:'q',type:'qr',errorCorrection:'M^FO0,0^FDX'}]},'template'),/Invalid errorCorrection/);
 assert.equal(coerced({id:'q',type:'qr',errorCorrection:''}).errorCorrection,'M');
 console.log('PASS sheet SVG: numeric barcode viewBox; hostile style values escaped in SVG/HTML; API coerces unknown list values and refuses ZPL separators');
})().catch(e=>{console.error(e);process.exitCode=1;});
// pdf.js: the served worker must be the installed version, and the version
// must be pinned exactly so the API and worker cannot drift apart again.
{
 const fs=require('node:fs');
 const pkg=require('../../package.json');const installed=require('pdfjs-dist/package.json').version;
 if(!/^\d+\.\d+\.\d+$/.test(pkg.dependencies['pdfjs-dist']))throw new Error('pdfjs-dist must be pinned to an exact version');
 if(pkg.dependencies['pdfjs-dist']!==installed)throw new Error(`pdfjs-dist ${installed} installed, package.json pins ${pkg.dependencies['pdfjs-dist']}`);
 if(!installed.startsWith('4.'))throw new Error('Keep pdf.js v4 (v5 worker had a Vercel issue; see HANDOFF.md)');
 const served=fs.readFileSync('public/pdf.worker.min.mjs');const expected=fs.readFileSync(require.resolve('pdfjs-dist/build/pdf.worker.min.mjs'));
 if(!served.equals(expected))throw new Error('public/pdf.worker.min.mjs does not match the installed pdfjs-dist worker; run node scripts/copy-pdf-worker.cjs');
 console.log(`PASS pdf.js worker matches installed pdfjs-dist ${installed} (exact pin)`);
}
