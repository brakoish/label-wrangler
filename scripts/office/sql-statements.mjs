// Split this migration's ordinary statements and dollar-quoted function bodies.
export function statements(source){
 const result=[];let start=0;let quoted=false;
 for(let i=0;i<source.length;i++){
  if(source.slice(i,i+2)==='$$'){quoted=!quoted;i++;continue;}
  if(source[i]===';' && !quoted){result.push(source.slice(start,i+1));start=i+1;}
 }
 if(source.slice(start).trim())result.push(source.slice(start));
 return result;
}
