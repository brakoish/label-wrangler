/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
const source = fs.readFileSync('src/app/api/nabis/search/route.ts', 'utf8');
const context = {};
vm.createContext(context);
const helpers = source.slice(source.indexOf('const EMPTY_LAB_POTENCY'), source.indexOf('function divideDecimalValue'));
const parser = source.slice(source.indexOf('function extractPotencyFromLabResults'), source.indexOf('async function fetchMetrcLabPotency'));
vm.runInContext(ts.transpile(helpers + parser), context);
const row = (TestTypeName, TestResultLevel) => ({ TestTypeName, TestResultLevel });
const parse = context.extractPotencyFromLabResults;
let result = parse([row('Total THC (%)', 25.67), row('Total CBD (%)', 0), row('Total Active Cannabinoids (mg/g)', 287.4)]);
assert.equal(result.thcPercent, '25.67');
assert.equal(result.thcMgG, '256.7');
assert.equal(result.cbdPercent, '0');
assert.equal(result.cbdMgG, '0');
assert.equal(result.tacPercent, '28.74');
assert.equal(result.tacMgG, '287.4');
result = parse([row('Total THC (mg)', 100), row('Total THC (mg/serving)', 10)]);
assert.equal(result.thcMgPackage, '100');
assert.equal(result.thcMgServing, '10');
assert.equal(result.thcPercent, '');
assert.equal(result.thcMgG, '');
for (const value of [null, '', 'ND', '<LOQ', -1]) {
  result = parse([row('Total CBD (%)', value)]);
  assert.equal(result.cbdPercent, '');
  assert.equal(result.cbdMgG, '');
}
console.log('PASS potency units, reported zero, missing/ND/LOQ preservation and package/serving isolation');
