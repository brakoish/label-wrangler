// Legacy designs with style values outside today's lists must still save, and
// coercing those values must not change the printed thermal ZPL or sheet SVG.
require('../thermal/register.cjs');
const assert=require('node:assert/strict');
require('./fake-svg-dom.cjs').install();
const {validate}=require('../../src/lib/validation.ts');
const {generateZPL}=require('../../src/lib/zplGenerator.ts');
const {renderSheetLabelSvg}=require('../../src/lib/sheetPrint.ts');
const clone=v=>JSON.parse(JSON.stringify(v));
const base={x:10,y:10,width:180,height:60,rotation:0,zIndex:0,isStatic:false};
const legacy=[
 {...base,id:'t1',type:'text',fieldName:'name',content:'',defaultValue:'Sample',fontFamily:'"Helvetica Neue", Arial & Co/Bold',fontSize:10,fontWeight:'heavy',fontStyle:'oblique',textAlign:'',verticalAlign:'center',color:'rgb(0 0 0 / 50%)',lineHeight:1.2},
 {...base,id:'t2',type:'text',content:'Fixed',isStatic:true,fontFamily:'Arial',fontSize:8,fontWeight:650,textAlign:'justify',color:'#000',lineHeight:1.2,rotation:90},
 {...base,id:'b1',y:80,type:'barcode',fieldName:'tag',content:'',barcodeFormat:'code128',showText:true},
 {...base,id:'q1',y:150,width:80,height:80,type:'qr',fieldName:'url',content:'',errorCorrection:''},
 {...base,id:'q2',x:100,y:150,width:80,height:80,type:'qr',content:'https://example.test/a',isStatic:true,errorCorrection:'m'},
 {...base,id:'r1',y:240,height:20,type:'rectangle',strokeWidth:1,strokeColor:'black',fillColor:'none',borderRadius:0},
];
const template={id:'t',name:'Legacy',formatId:'f',thermalRenderMode:'native-v1',elements:legacy};
const thermal={id:'f',name:'2x1.5',type:'thermal',width:2,height:1.5,dpi:203,labelsAcross:1};
const values={name:'Lemon Cherry Gelato',tag:'1A40603000012345',url:'https://example.test/p/1'};
(async()=>{
 const before=generateZPL(clone(template),thermal,values);
 const data={elements:clone(legacy)};
 validate(data,'template');// saves instead of "Invalid fontFamily" / "Invalid textAlign"
 const [t1,t2,b1,q1,q2,r1]=data.elements;
 assert.equal(t1.textAlign,'left');assert.equal(t1.verticalAlign,'top');assert.equal(t1.fontStyle,'normal');assert.equal(t1.fontWeight,'normal');
 assert.equal(t1.fontFamily,legacy[0].fontFamily);assert.equal(t1.color,legacy[0].color);
 assert.equal(t2.textAlign,'left');assert.equal(t2.fontWeight,650,'valid CSS weight kept as written');
 assert.equal(b1.barcodeFormat,'CODE128');assert.equal(q1.errorCorrection,'M');assert.equal(q2.errorCorrection,'m','unknown QR level kept so ZPL bytes stay the same');
 assert.equal(r1.strokeColor,'black');
 const after=generateZPL({...template,elements:data.elements},thermal,values);
 assert.equal(after,before,'coercing legacy values changed the printed ZPL');
 // Sheet output for the text and shapes is the same. The only textual change
 // is an invalid font-weight ("heavy"), which browsers ignore and draw as
 // normal, now written as normal.
 const sheet={id:'s',name:'s',type:'sheet',width:2,height:1.5,sheetWidth:8.5,sheetHeight:11};
 const pick=els=>els.filter(e=>['t1','t2','r1'].includes(e.id));
 const sheetBefore=await renderSheetLabelSvg(pick(clone(legacy)),sheet,values);
 assert.ok(sheetBefore.includes('font-weight="heavy"'));
 assert.equal(await renderSheetLabelSvg(pick(data.elements),sheet,values),sheetBefore.replace('font-weight="heavy"','font-weight="normal"'),'coercing legacy values changed the sheet SVG');
 // Global elements use the same rules.
 validate({elements:clone(legacy)},'global');
 console.log('PASS legacy templates: out-of-list style values save (coerced to what prints today); thermal ZPL and sheet SVG unchanged');
})().catch(e=>{console.error(e);process.exitCode=1;});
