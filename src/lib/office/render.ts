import sharp from 'sharp';
import { renderThermalBitmap, validateBitmapDesign } from '../thermal/render.server';
import { createHash, randomUUID } from 'node:crypto';
import { generateZPL, type PreparedZplImages } from '../zplGenerator';
import { previewLabelValues } from '../runBuilder';
import type { LabelFormat, LabelTemplate, Run } from '../types';
import { OfficeError } from './http';
const MAX_BYTES = 2_097_152;
export interface OfficeBatch { id: string; from: number; to: number; count: number; payload: string; sha256: string }
function finite(value: unknown, min: number, max: number, name: string) {
  if (typeof value!=='number' || !Number.isFinite(value) || value<min || value>max) throw new OfficeError(`Invalid ${name}`);
  return value;
}
function content(value: unknown) {
  if (typeof value!=='string' || value.length>8192 || /[\^~\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) throw new OfficeError('Label text contains unsupported printer control characters or is too long');
}
export function validateLayout(template: LabelTemplate, format: LabelFormat, dpi: number, maxWidth: number) {
  if (format.type!=='thermal' || (format.dpi || 203)!==dpi) throw new OfficeError(`Office printer requires a ${dpi} DPI thermal format`);
  const w = Math.round(finite(format.width,0.01,56,'label width')*dpi);
  const h = Math.round(finite(format.height,0.01,20,'label height')*dpi);
  const across = finite(format.labelsAcross ?? 1,1,25,'labels across');
  if (!Number.isInteger(across)) throw new OfficeError('Labels across must be an integer');
  const gap = Math.round(finite(format.horizontalGapThermal ?? 0,0,4,'gap')*dpi);
  const margin = Math.round(finite(format.sideMarginThermal ?? 0,0,4,'margin')*dpi);
  const computed = w*across+gap*(across-1)+2*margin;
  const width = format.linerWidth ? Math.round(finite(format.linerWidth,0.01,56,'liner width')*dpi) : computed;
  if (width>maxWidth || width<computed) throw new OfficeError(`Label/liner needs ${width} dots; this printer supports at most ${maxWidth}. Check width, margins and labels across.`);
  if (!Array.isArray(template.elements) || template.elements.length>200) throw new OfficeError('Invalid template elements');
  const ids = new Set<string>();
  for (const el of template.elements) {
    if (typeof el.id!=='string' || ids.has(el.id)) throw new OfficeError('Invalid element ID'); ids.add(el.id);
    if (!['text','qr','barcode','image','line','rectangle'].includes(el.type)) throw new OfficeError('Unsupported element type');
    for (const key of ['x','y','zIndex'] as const) finite(el[key],-4096,4096,key);
    finite(el.width,0,4096,'element width'); finite(el.height,0,4096,'element height');
    if (![0,90,180,270].includes(el.rotation)) throw new OfficeError('Office printing supports right-angle rotations');
    const record=el as unknown as Record<string,unknown>;
    for (const key of ['content','defaultValue','prefix','suffix']) if(record[key]!==undefined) content(record[key]);
    if (el.type==='text') {
      finite(el.fontSize,1,200,'font size'); finite(el.lineHeight,0.1,10,'line height'); finite(el.charWidth ?? 1,0.1,10,'character width');
      if (el.minFontSize!==undefined) finite(el.minFontSize,1,200,'minimum font size');
      if (!['left','center','right'].includes(el.textAlign)) throw new OfficeError('Invalid text alignment');
    }
    if (el.type==='qr' && !['L','M','Q','H'].includes(el.errorCorrection)) throw new OfficeError('Invalid QR correction');
    if (el.type==='barcode' && !['CODE128','CODE39','UPC','EAN13','EAN8','ITF14'].includes(el.barcodeFormat)) throw new OfficeError('Invalid barcode format');
    if (el.type==='line' || el.type==='rectangle') finite(el.strokeWidth,0,100,'stroke width');
    if (el.type==='rectangle') finite(el.borderRadius,0,8,'border radius');
  }
  return { width, height:h, across };
}
export async function prepareServerImages(template: LabelTemplate, format: LabelFormat): Promise<PreparedZplImages> {
  const prepared: PreparedZplImages = {};
  for (const el of template.elements) {
    if (el.type!=='image' || !el.src) continue;
    if (!['contain','cover','fill'].includes(el.objectFit)) throw new OfficeError('Invalid logo fit');
    const match = /^data:image\/(png|jpeg|webp|svg\+xml);base64,([A-Za-z0-9+/=\s]+)$/.exec(el.src);
    if (!match || el.src.length>6_000_000) throw new OfficeError('Office logos must be embedded PNG, JPEG, WebP or SVG images');
    const input = Buffer.from(match[2],'base64');
    if ((match[1]==='png' && input.subarray(0,8).toString('hex')!=='89504e470d0a1a0a') ||
        (match[1]==='jpeg' && input.subarray(0,3).toString('hex')!=='ffd8ff') ||
        (match[1]==='webp' && (input.subarray(0,4).toString()!=='RIFF' || input.subarray(8,12).toString()!=='WEBP'))) throw new OfficeError('Logo data does not match its image type');
    if (match[1]==='svg+xml' && /<!|href|url\s*\(|<script|<foreignObject|&|@import|\\/i.test(input.toString('utf8'))) throw new OfficeError('This SVG has references or embedded content. Upload a flattened SVG or PNG logo for Office printing.');
    const max = (format.dpi || 203)*6;
    const width = Math.max(1,Math.round(el.width)); const height = Math.max(1,Math.round(el.height));
    const baseW = Math.min(width,max); const baseH = Math.min(height,max);
    const base = await sharp(input,{limitInputPixels:16_000_000}).resize(baseW,baseH,{fit:el.objectFit,background:'#ffffff'}).flatten({background:'#ffffff'}).png().toBuffer();
    const rotated = await sharp(base).rotate(el.rotation,{background:'#ffffff'}).removeAlpha().toColourspace('srgb').raw().toBuffer({resolveWithObject:true});
    const originX = Math.round(Math.round(el.x)+(width-rotated.info.width)/2);
    const originY = Math.round(Math.round(el.y)+(height-rotated.info.height)/2);
    const x = Math.max(0,originX); const y = Math.max(0,originY);
    const left = x-originX; const top = y-originY;
    const cropW = Math.min(rotated.info.width-left,Math.round(format.width*(format.dpi || 203))-x);
    const cropH = Math.min(rotated.info.height-top,Math.round(format.height*(format.dpi || 203))-y);
    if (cropW<=0 || cropH<=0) { prepared[el.id]={graphic:'',width:1,height:1,offsetX:0,offsetY:0}; continue; }
    const rowBytes = Math.ceil(cropW/8); const bytes = Buffer.alloc(rowBytes*cropH);
    for(let py=0;py<cropH;py++) for(let px=0;px<cropW;px++) {
      const index=((py+top)*rotated.info.width+px+left)*rotated.info.channels;
      const lum=0.299*rotated.data[index]+0.587*rotated.data[index+1]+0.114*rotated.data[index+2];
      if(lum<180) bytes[py*rowBytes+Math.floor(px/8)] |= 0x80>>(px%8);
    }
    prepared[el.id]={graphic:`^GFA,${bytes.length},${bytes.length},${rowBytes},${bytes.toString('hex').toUpperCase()}`,
      width:cropW,height:cropH,offsetX:x-Math.round(el.x),offsetY:y-Math.round(el.y)};
  }
  return prepared;
}
export async function buildBatches(run: Run, template: LabelTemplate, format: LabelFormat, from: number, to: number, dpi: number, maxWidth: number) {
  if (template.thermalRenderMode !== undefined && !['native-v1','bitmap-v1'].includes(template.thermalRenderMode)) throw new OfficeError('Unsupported thermal render mode');
  const started = Date.now();
  const bitmap = template.thermalRenderMode === 'bitmap-v1';
  if (bitmap) {
    const geometry = validateBitmapDesign(template, format);
    if ((format.dpi || 203) !== dpi || geometry.linerDots > maxWidth) throw new OfficeError(`Office printer requires ${dpi} DPI and at most ${maxWidth} dots wide`);
  }
  const across = bitmap ? (format.labelsAcross || 1) : validateLayout(template,format,dpi,maxWidth).across;
  if (!Array.isArray(run.sourceData) || !Number.isInteger(from) || !Number.isInteger(to) || from<1 || to<from || to>run.sourceData.length || to-from+1>10000) throw new OfficeError('Choose a valid range of up to 10,000 saved labels');
  const imageGraphics=bitmap ? {} : await prepareServerImages(template,format);
  const batches: OfficeBatch[]=[];
  let feeds: string[]=[]; let count=0; let start=from; let end=from; let bytes=0; let totalBytes=0;
  const flush=()=>{
    if(!count)return;
    const data=Buffer.from(feeds.join('\n'),'utf8');
    batches.push({id:randomUUID(),from:start,to:end,count,payload:data.toString('base64'),sha256:createHash('sha256').update(data).digest('hex')});
    feeds=[];count=0;bytes=0;
  };
  // Keep original lane positions. Unselected lanes are blank, not reprinted.
  for(let first=Math.floor((from-1)/across)*across;first<to;first+=across){
    if (bitmap && Date.now()-started > 40_000) throw new OfficeError('Bitmap preparation exceeds this request time limit. Choose a smaller range.');
    const laneValues: Array<Record<string,string>|undefined>=[]; let feedCount=0;
    for(let lane=0;lane<across;lane++){
      const index=first+lane;
      if(index<from-1 || index>=to){laneValues.push(undefined);continue;}
      const values=previewLabelValues(run,index);
      if (!bitmap) for(const value of Object.values(values)) content(value);
      laneValues.push(values);feedCount++;
    }
    let rendered: string;
    try { rendered = bitmap ? (await renderThermalBitmap(template,format,laneValues)).zpl : generateZPL(template,format,laneValues,{imageGraphics}); }
    catch (error) { throw new OfficeError(`Labels ${Math.max(from,first+1)}–${Math.min(to,first+across)}: ${error instanceof Error ? error.message : 'Rendering failed'}`); }
    const zpl=rendered.replace('^XA','^XA\n^PON\n^LH0,0\n^LT0\n^LS0\n^PQ1');
    const size=Buffer.byteLength(zpl,'utf8');
    if(size>MAX_BYTES)throw new OfficeError('One feed exceeds the 2 MiB payload limit. Reduce logo size.');
    if(count && (count+feedCount>25 || bytes+size+1>MAX_BYTES))flush();
    if(!count)start=Math.max(from,first+1);
    end=Math.min(to,first+across);count+=feedCount;bytes+=size+(feeds.length?1:0);feeds.push(zpl);totalBytes+=size;
    if(totalBytes>32*1024*1024)throw new OfficeError('This range exceeds 32 MiB of printer data. Queue a smaller range.');
  }
  flush();return batches;
}
