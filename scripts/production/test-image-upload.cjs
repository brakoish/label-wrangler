// Designer image uploads: unsupported types get a friendly message, large
// images are scaled to 1200 px on the longest side, small ones never upscale.
require('../thermal/register.cjs');
const assert=require('node:assert/strict');
const u=require('../../src/lib/imageUpload.ts');
assert.deepEqual(u.fitWithin(4032,3024),{width:1200,height:900});
assert.deepEqual(u.fitWithin(3024,4032),{width:900,height:1200});
assert.deepEqual(u.fitWithin(600,200),{width:600,height:200},'must not upscale');
assert.deepEqual(u.fitWithin(1200,1200),{width:1200,height:1200});
assert.deepEqual(u.fitWithin(10000,1),{width:1200,height:1});
for(const type of ['image/png','image/jpeg','image/webp','image/gif','image/svg+xml'])assert.equal(u.imageUploadProblem({type,size:1000}),null,type);
for(const type of ['image/heic','image/tiff','application/pdf','',"image/bmp"])assert.match(u.imageUploadProblem({type,size:1000}),/not supported/,type);
assert.match(u.imageUploadProblem({type:'image/jpeg',size:30*1024*1024}),/25 MB/);
assert.match(u.imageUploadProblem({type:'image/svg+xml',size:2_000_000}),/SVG/);
console.log('PASS image upload: type check with friendly message, 1200px longest-side downscale, no upscale');
