const {spawnSync}=require('node:child_process');
for(const file of [
 'scripts/production/test-reliability.cjs',
 'scripts/thermal/test-designer.cjs',
 'scripts/thermal/test-dotted-lines.cjs',
 'scripts/test-lab-potency.cjs',
 'scripts/thermal/test-conversion-fit.cjs',
]) {
 const result=spawnSync(process.execPath,[file],{stdio:'inherit',env:{...process.env,UV_THREADPOOL_SIZE:'2',VIPS_CONCURRENCY:'1'}});
 if(result.status!==0)process.exit(result.status||1);
}
