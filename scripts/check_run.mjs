import { neon } from '@neondatabase/serverless';
import fs from 'fs';
import path from 'path';

const env = fs.readFileSync('.env.local', 'utf8');
const url = env.match(/^DATABASE_URL=(.+)$/m)[1].trim();
const sql = neon(url);

// Latest run + its template name.
const runs = await sql`
  SELECT r.id, r.name, r.template_id, r.data_source, r.total_labels,
         r.printed_count, r.status, r.field_mappings, r.mapped_field,
         jsonb_typeof(r.source_data) AS src_type,
         jsonb_array_length(r.source_data) AS src_len,
         r.created_at
  FROM runs r
  ORDER BY r.created_at DESC
  LIMIT 3
`;
console.log('=== Latest runs ===');
for (const r of runs) {
  console.log(JSON.stringify(r, null, 2));
}

if (runs.length === 0) {
  console.log('No runs.');
  process.exit(0);
}

const latest = runs[0];
console.log(`\n=== Diagnosing ${latest.name} (${latest.id}) ===`);

// Pull source_data and sample N values from a QR-ish field.
const rows = await sql`
  SELECT source_data FROM runs WHERE id = ${latest.id}
`;
const data = rows[0].source_data;

// Also fetch the template to see what dynamic fields exist.
const tpl = await sql`
  SELECT id, name, elements FROM templates WHERE id = ${latest.template_id}
`;
const tmpl = tpl[0];
const dynEls = (tmpl?.elements || []).filter(e => !e.isStatic);
console.log(`\nTemplate "${tmpl.name}" has ${dynEls.length} dynamic element(s):`);
for (const e of dynEls) {
  console.log(`  - ${e.type} fieldName="${e.fieldName || '(none)'}"`);
}

const fm = latest.field_mappings || {};
console.log('\nField mappings:');
console.log(JSON.stringify(fm, null, 2));

// Pull the resolved values per label.
function valuesForLabel(run, idx) {
  const vals = {};
  const row = run.source_data[idx];
  const mappings = run.field_mappings || {};
  if (row && typeof row === 'object' && !Array.isArray(row)) {
    for (const [field, m] of Object.entries(mappings)) {
      if (m.mode === 'column' && m.csvColumn) vals[field] = row[m.csvColumn] ?? '';
    }
  } else if (typeof row === 'string') {
    const legacy = run.mapped_field
      || Object.entries(mappings).find(([, m]) => m.mode === 'column')?.[0]
      || null;
    if (legacy) vals[legacy] = row;
  }
  return vals;
}

const run = { ...latest, source_data: data };
const samples = [0, 1, 2, Math.floor(data.length / 2), data.length - 2, data.length - 1]
  .filter((v, i, a) => v >= 0 && v < data.length && a.indexOf(v) === i);
console.log(`\n=== Sample resolved values (${data.length} labels total) ===`);
for (const i of samples) {
  console.log(`label ${i + 1}:`, JSON.stringify(valuesForLabel(run, i)));
}

// Count distinct values for each dynamic field across ALL rows.
const distinct = {};
for (let i = 0; i < data.length; i++) {
  const v = valuesForLabel(run, i);
  for (const [field, val] of Object.entries(v)) {
    distinct[field] ??= new Set();
    distinct[field].add(val);
  }
}
console.log('\n=== Distinct values per field ===');
for (const [field, set] of Object.entries(distinct)) {
  console.log(`  ${field}: ${set.size} unique across ${data.length} labels`);
  if (set.size === 1) console.log(`    ALL THE SAME: "${[...set][0]}"`);
}
