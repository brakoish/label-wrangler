// No label text, tags, query strings, or stack traces leave the browser.
let reports = 0;
function report(kind: string, duration?: number) {
  if (location.pathname === '/login' || reports++ >= 10) return;
  const page = location.pathname.split('/')[1] || 'home';
  void fetch('/api/client-diagnostics', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind,page,duration:duration===undefined?undefined:Math.round(duration)}),keepalive:true}).catch(()=>{});
}
window.addEventListener('error',()=>report('javascript-error'));
window.addEventListener('unhandledrejection',()=>report('unhandled-rejection'));
try {
  new PerformanceObserver(list=>{for(const entry of list.getEntries())if(entry.duration>500)report('long-task',entry.duration)}).observe({type:'longtask',buffered:true});
} catch { /* Browser does not support long-task observations. */ }
