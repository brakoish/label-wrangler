// Dump the actual ZPL that would be sent to the printer for the latest run,
// so we can see whether each label has a unique ^FD payload.
import { neon } from '@neondatabase/serverless';
import fs from 'fs';

const env = fs.readFileSync('.env.local', 'utf8');
const url = env.match(/^DATABASE_URL=(.+)$/m)[1].trim();
const sql = neon(url);

const runs = await sql`SELECT * FROM runs ORDER BY created_at DESC LIMIT 1`;
const run = runs[0];
const tpls = await sql`SELECT * FROM templates WHERE id = ${run.template_id}`;
const tmpl = tpls[0];
const fmts = await sql`SELECT * FROM formats WHERE id = ${tmpl.format_id}`;
const fmt = fmts[0];

console.log('Run:', run.name, 'total:', run.total_labels);
console.log('Template:', tmpl.name);
console.log('Format:', fmt.name, `${fmt.width}"x${fmt.height}" ${fmt.dpi}dpi across=${fmt.labels_across ?? 1}`);

// Replicate zplGenerator.generateZPL inline so we don't need to spin up tsx.
function valuesForLabel(run, idx) {
  const vals = { ...(run.static_values || {}) };
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

function resolveContent(el, fieldValues) {
  if (el.isStatic) return el.content || '';
  const v = (el.fieldName && fieldValues?.[el.fieldName]) || el.defaultValue || '';
  return `${el.prefix || ''}${v}${el.suffix || ''}`;
}

function genZpl(template, format, values) {
  const dpi = format.dpi || 203;
  const labelWDots = Math.round(format.width * dpi);
  const heightDots = Math.round(format.height * dpi);
  const across = Math.max(1, format.labels_across || 1);
  const gapDots = Math.round((format.horizontal_gap_thermal || 0) * dpi);
  const sideMDots = Math.round((format.side_margin_thermal || 0) * dpi);
  const computedLinerDots = sideMDots * 2 + across * labelWDots + (across - 1) * gapDots;
  const linerDots = format.liner_width ? Math.round(format.liner_width * dpi) : computedLinerDots;
  const effectiveSideMDots = format.side_margin_thermal > 0
    ? sideMDots
    : Math.max(0, Math.round((linerDots - (across * labelWDots + (across - 1) * gapDots)) / 2));

  const sorted = [...template.elements].sort((a, b) => a.zIndex - b.zIndex);
  const lines = ['^XA', `^PW${linerDots}`, `^LL${heightDots}`];
  for (let lane = 0; lane < across; lane++) {
    const laneOriginX = effectiveSideMDots + lane * (labelWDots + gapDots);
    for (const el of sorted) {
      const content = resolveContent(el, values);
      const x = Math.round(el.x) + laneOriginX;
      const y = Math.round(el.y);
      if (el.type === 'qr') {
        if (!content) continue;
        // Simplified QR: use a fixed mag of 6 for 0.5" label to see values clearly.
        const mag = Math.max(1, Math.min(10, Math.round(el.width / 25)));
        lines.push(`^FO${x},${y}^BQN,2,${mag}^FDQA,${content}^FS`);
      } else if (el.type === 'text') {
        if (!content) continue;
        const fh = Math.round(el.fontSize * (dpi / 72));
        const fw = Math.max(1, Math.round(fh * (el.charWidth ?? 0.5)));
        lines.push(`^FO${x},${y}^A0N,${fh},${fw}^FD${content}^FS`);
      }
    }
  }
  lines.push('^XZ');
  return lines.join('\n');
}

// Generate ZPL for first 3 and last 2 labels.
const n = run.source_data.length;
const idxs = [0, 1, 2, n - 2, n - 1].filter((v, i, a) => v >= 0 && v < n && a.indexOf(v) === i);
for (const i of idxs) {
  const vals = valuesForLabel(run, i);
  const zpl = genZpl(tmpl, fmt, vals);
  console.log(`\n===== Label ${i + 1} =====`);
  console.log(zpl);
}

// Also show what the batched payload (first 3 labels joined) looks like.
console.log('\n===== BATCH PAYLOAD (labels 1-3 as one USB write) =====');
const batch = [0, 1, 2].map(i => genZpl(tmpl, fmt, valuesForLabel(run, i))).join('\n');
console.log(batch);
