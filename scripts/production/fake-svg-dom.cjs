// Minimal SVG DOM, enough for JsBarcode's SVG renderer and innerHTML. Offline only.
const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const escA=s=>esc(s).replace(/"/g,'&quot;');
class Text{constructor(t){this.nodeType=3;this.data=String(t);}get outerHTML(){return esc(this.data);}}
class El{
 constructor(tag){this.nodeType=1;this.tagName=tag;this.nodeName=tag;this.attrs=new Map();this.childNodes=[];this.style={};this.parentNode=null;}
 setAttribute(k,v){this.attrs.set(k,String(v));} hasAttribute(k){return this.attrs.has(k);} getAttribute(k){return this.attrs.has(k)?this.attrs.get(k):null;}
 setAttributeNS(_,k,v){this.setAttribute(k,v);} removeAttribute(k){this.attrs.delete(k);}
 appendChild(c){c.parentNode=this;this.childNodes.push(c);return c;} removeChild(c){this.childNodes=this.childNodes.filter(x=>x!==c);return c;}
 remove(){this.parentNode?.removeChild(this);} get firstChild(){return this.childNodes[0]||null;}
 hasChildNodes(){return this.childNodes.length>0;}
 get innerHTML(){return this.childNodes.map(c=>c.outerHTML).join('');}
 get outerHTML(){return `<${this.tagName}${[...this.attrs].map(([k,v])=>` ${k}="${escA(v)}"`).join('')}>${this.innerHTML}</${this.tagName}>`;}
 set textContent(t){this.childNodes=[new Text(t)];}
 getContext(){return {font:'',measureText:t=>({width:String(t).length*7})};}
}
function install(){
 const body=new El('body');
 global.document={body,createElementNS:(_,tag)=>new El(tag),createElement:tag=>new El(tag),createTextNode:t=>new Text(t)};
 return global.document;
}
module.exports={install,El};
