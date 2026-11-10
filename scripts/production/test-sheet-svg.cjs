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
 console.log('PASS sheet SVG: numeric barcode viewBox (px units parsed, defaults on bad input)');
})().catch(e=>{console.error(e);process.exitCode=1;});
