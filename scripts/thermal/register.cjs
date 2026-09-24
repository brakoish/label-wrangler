const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
const original = Module._resolveFilename;
Module._resolveFilename = function(name, ...args) { return original.call(this, name.startsWith('@/') ? path.resolve('src', name.slice(2)) : name, ...args); };
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
