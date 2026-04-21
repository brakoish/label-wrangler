// v2: simulate the NEW multi-across-aware generateLabelsForRun so we can
// see that each lane gets its own unique URL.
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

console.log('Run:', run.name, 'rows:', run.source_data.length);
console.log('Format across:', fmt.labels_across);

function valuesForLabel(run, idx) {
  const vals = { ...(run.static_values || {}) };
  const row = run.source_data[idx];
  const mappings = run.field_mappings || {};
  if (row && typeof row === 'object' && !Array.isArray(row)) {
    for (const [field, m] of Object.entries(mappings)) {
      if (m.mode === 'column' && m.csvColumn) vals[field] = row[m.csvColumn] ?? '';
    }
  }
  return vals;
}

function resolveContent(el, fieldValues) {
  if (el.isStatic) return el.content || '';
  const v = (el.fieldName && fieldValues?.[el.fieldName]) || el.defaultValue || '';
  return `${el.prefix || ''}${v}${el.suffix || ''}`;
}

// New multi-across generateZPL that accepts per-lane values array.
function genZpl(template, format, fieldValues) {
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

  const perLane = [];
  if (Array.isArray(fieldValues)) {
    for (let i = 0; i < across; i++) perLane.push(fieldValues[i] ?? undefined);
  } else {
    for (let i = 0; i < across; i++) perLane.push(fieldValues);
  }

  const sorted = [...template.elements].sort((a, b) => a.zIndex - b.zIndex);
  const lines = ['^XA', `^PW${linerDots}`, `^LL${heightDots}`];
  for (let lane = 0; lane < across; lane++) {
    const laneValues = perLane[lane];
    if (laneValues === undefined) continue;
    const laneOriginX = effectiveSideMDots + lane * (labelWDots + gapDots);
    for (const el of sorted) {
      const content = resolveContent(el, laneValues);
      const x = Math.round(el.x) + laneOriginX;
      const y = Math.round(el.y);
      if (el.type === 'qr' && content) {
        const mag = Math.max(1, Math.min(10, Math.round(el.width / 25)));
        lines.push(`^FO${x},${y}^BQN,2,${mag}^FDQA,${content}^FS`);
      }
    }
  }
  lines.push('^XZ');
  return lines.join('\n');
}

// generateLabelsForRun: multi-across bundles `across` rows per feed.
function genFeeds(run, tmpl, fmt) {
  const across = Math.max(1, fmt.labels_across || 1);
  const total = run.source_data.length;
  const feeds = [];
  if (across === 1) {
    for (let i = 0; i < total; i++) feeds.push(genZpl(tmpl, fmt, valuesForLabel(run, i)));
    return feeds;
  }
  for (let i = 0; i < total; i += across) {
    const laneValues = [];
    for (let lane = 0; lane < across; lane++) {
      const idx = i + lane;
      laneValues.push(idx < total ? valuesForLabel(run, idx) : undefined);
    }
    feeds.push(genZpl(tmpl, fmt, laneValues));
  }
  return feeds;
}

const feeds = genFeeds(run, tmpl, fmt);
console.log(`\n=== ${feeds.length} printer feed(s) for ${run.source_data.length} labels ===\n`);
for (let i = 0; i < Math.min(feeds.length, 3); i++) {
  console.log(`----- Feed ${i + 1} (rows ${i * 3 + 1}..${Math.min((i + 1) * 3, run.source_data.length)}) -----`);
  console.log(feeds[i]);
  console.log();
}
console.log(`----- Last feed (#${feeds.length}) -----`);
console.log(feeds[feeds.length - 1]);
