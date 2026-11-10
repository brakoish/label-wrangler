const {spawnSync}=require('node:child_process');
for(const file of [
 'scripts/production/test-reliability.cjs',
 'scripts/production/test-outbox.cjs',
 'scripts/production/test-origin-refusal.cjs',
 'scripts/production/test-run-progress.cjs',
 'scripts/production/test-permissions.cjs',
 'scripts/production/test-delete-conflicts.cjs',
 'scripts/production/test-login-throttle.cjs',
 'scripts/production/test-safe-redirect.cjs',
 'scripts/production/test-template-list.cjs',
 'scripts/production/test-image-upload.cjs',
 'scripts/production/test-office-status.cjs',
 'scripts/production/test-sheet-svg.cjs',
 'scripts/production/test-legacy-templates.cjs',
 'scripts/production/test-open-tab.cjs',
 'scripts/production/test-dialog-stack.cjs',
 'scripts/production/test-csp-report.cjs',
 'scripts/production/test-run-images.cjs',
 'scripts/production/test-run-preview.cjs',
 'scripts/production/test-run-data-check.cjs',
 'scripts/production/test-template-previews.cjs',
 'scripts/production/test-run-field-setup.cjs',
 'scripts/thermal/test-designer.cjs',
 'scripts/thermal/test-dotted-lines.cjs',
 'scripts/test-lab-potency.cjs',
 'scripts/thermal/test-conversion-fit.cjs',
]) {
 const result=spawnSync(process.execPath,[file],{stdio:'inherit',env:{...process.env,UV_THREADPOOL_SIZE:'2',VIPS_CONCURRENCY:'1'}});
 if(result.status!==0)process.exit(result.status||1);
}
