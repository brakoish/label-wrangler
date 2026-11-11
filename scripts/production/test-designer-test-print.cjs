/* eslint-disable @typescript-eslint/no-require-imports -- Node regression harness */
// The designer's test print looks itself up by key under the run the server
// files it in, and checks and saves under one Web Lock: the run name it
// builds must stay the one src/lib/office/preview.ts gives the request.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '../..');
const server = fs.readFileSync(path.join(root, 'src/lib/office/preview.ts'), 'utf8');
const client = fs.readFileSync(path.join(root, 'src/components/designer/OfficePreviewPrint.tsx'), 'utf8');
assert.match(server, /const runId = `designer-test-\$\{user\.id\}-\$\{data\.idempotencyKey\}`;/, 'server names a test print designer-test-<user>-<key>');
assert.match(client, /return `designer-test-\$\{userId\}-\$\{key\}`;/, 'client looks it up under the same name');
assert.match(client, /\/api\/office\/jobs\?runId=\$\{encodeURIComponent\(runId\)\}&key=\$\{encodeURIComponent\(key\)\}/, 'the existing key lookup');
assert.match(client, /navigator\.locks\.request\(`lw-office-send:test:\$\{templateId\}`/, 'one lock per design across tabs');
// The saved print is written inside the lock, before the one POST.
const lockAt = client.indexOf('await withTestPrintLock(');
const saveAt = client.indexOf('localStorage.setItem(storageKey, JSON.stringify(payload));', lockAt);
const postAt = client.indexOf("api('/api/office/preview', { method: 'POST'", lockAt);
assert.ok(lockAt > 0 && saveAt > lockAt && postAt > saveAt, 'save before POST, under the lock');
assert.equal(client.split("api('/api/office/preview', { method: 'POST'").length - 1, 1, 'one POST site');
console.log('designer test print: ok');
