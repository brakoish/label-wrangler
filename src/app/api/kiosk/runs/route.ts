import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { body, json, browserFailure, OfficeError } from '@/lib/office/http';
import { officeSql } from '@/lib/office/db';
import { db } from '@/lib/db';
import { runs } from '@/lib/db/schema';
import { captureDesign } from '@/lib/runDesign.server';
import { validate } from '@/lib/validation';
import { officeSummaryQuery } from '@/lib/runListQueries.server';
import { officeDeliverySummary, type OfficeJobLike } from '@/lib/officeRange';
import { requireKiosk } from '@/lib/kiosk/server';
import { KIOSK_RUN_LIMIT, isMissingTable, kioskRunData, kioskRunName, kioskTestCount } from '@/lib/kiosk/plan';

export const maxDuration = 60;

function rowsFrom(value: unknown): Record<string, string>[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > KIOSK_RUN_LIMIT) throw new OfficeError('Pick a product first.');
  return value.map((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new OfficeError('Invalid product details');
    const entries = Object.entries(row as Record<string, unknown>);
    if (entries.length > 500) throw new OfficeError('Invalid product details');
    const out: Record<string, string> = {};
    for (const [key, v] of entries) {
      if (key.length > 200) throw new OfficeError('Invalid product details');
      if (v === null || v === undefined) continue;
      if (typeof v !== 'string' || v.length > 20000) throw new OfficeError('Invalid product details');
      out[key] = v;
    }
    return out;
  });
}
const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

/**
 * POST: a kiosk print. Makes a normal run (so it's in Runs and its history)
 * from a kiosk design and the picked product, and records it as a kiosk run
 * waiting for its 12-label check. Printing then goes through the office
 * printer's own endpoints, exactly like a run made in New run.
 */
export async function POST(req: Request) {
  try {
    const user = await requireKiosk(req);
    const data = await body(req, 4_000_000);
    if (typeof data.templateId !== 'string' || !data.templateId || data.templateId.length > 200) throw new OfficeError('Pick a label first.');
    if (!Number.isSafeInteger(data.quantity) || Number(data.quantity) < 1 || Number(data.quantity) > KIOSK_RUN_LIMIT) throw new OfficeError('Choose how many labels: a whole number of 1 or more.');
    const quantity = Number(data.quantity);
    const rows = rowsFrom(data.rows);
    const packageKey = text(data.packageKey, 300);
    if (!packageKey) throw new OfficeError('Pick a product first.');
    const productName = text(data.productName, 200);
    const category = text(data.category, 100);
    const sql = officeSql();
    const allowed = await sql`SELECT 1 FROM kiosk_designs k JOIN templates t ON t.id=k.template_id WHERE k.template_id=${data.templateId} AND t.archived_at IS NULL`;
    if (!allowed.length) throw new OfficeError('That label isn’t on the kiosk any more. Pick another one.', 409);
    const design = await captureDesign(data.templateId);
    if (design.format.type !== 'thermal') throw new OfficeError('That label isn’t for the office label printer. Ask a manager.', 409);
    const filled = kioskRunData(design.template, rows, quantity, design.format);
    if (!filled.ok) throw new OfficeError(filled.message, 400);
    const name = kioskRunName(productName || rows[0].itemName || rows[0].productName || '');
    // The same checks every new run passes (src/lib/validation.ts).
    validate({ name, templateId: data.templateId, staticValues: filled.staticValues, fieldMappings: filled.fieldMappings, dataSource: 'manifest', sourceData: filled.sourceData, mappedField: null, status: 'queued' }, 'run', true);
    const now = new Date().toISOString();
    const id = `run-${randomUUID()}`;
    await db.insert(runs).values({
      id, designSnapshot: design, name, templateId: data.templateId, presetId: null,
      staticValues: filled.staticValues, fieldMappings: filled.fieldMappings, dataSource: 'manifest',
      sourceData: filled.sourceData, mappedField: null, status: 'queued', totalLabels: filled.sourceData.length,
      printedCount: 0, notes: null, pinnedAt: null, createdAt: now, updatedAt: now, completedAt: null,
    });
    const testCount = kioskTestCount(quantity, design.format.labelsAcross ?? 1);
    try {
      await sql`INSERT INTO kiosk_runs(run_id,template_id,user_id,package_key,product_name,category,quantity,test_count)
        VALUES(${id},${data.templateId},${user.id}::uuid,${packageKey},${productName},${category},${quantity},${testCount})`;
    } catch (error) {
      // Nothing was printed yet: take the run back out so no half-made print is left.
      await db.delete(runs).where(eq(runs.id, id)).catch(() => {});
      if (isMissingTable(error)) throw new OfficeError('Kiosk mode isn’t set up yet. Ask a manager.', 409);
      throw error;
    }
    return json({ run: { id, name, totalLabels: filled.sourceData.length }, testCount }, 201);
  } catch (error) { return browserFailure(error); }
}

interface ListRow { id: string; name: string; template_name: string | null; format_type: string | null; total_labels: number; status: string; created_at: string; stage: string | null; test_count: number | null; product_name: string | null; kiosk_at: string | null }

/**
 * GET ?product=KEY&name=ITEM: what's been run for a product (kiosk prints of
 * it, and runs made from its Manifest data in New run). Without a product: this
 * kiosk's prints since `since` (default the last day). Each with what the
 * office printer did, read-only.
 */
export async function GET(req: Request) {
  try {
    const user = await requireKiosk(req);
    const params = new URL(req.url).searchParams;
    const product = (params.get('product') ?? '').slice(0, 300);
    const item = (params.get('name') ?? '').trim().slice(0, 200);
    const sinceRaw = params.get('since');
    const since = sinceRaw && Number.isFinite(Date.parse(sinceRaw)) ? new Date(sinceRaw) : new Date(Date.now() - 24 * 60 * 60 * 1000);
    const sql = officeSql();
    const like = item ? `${item.replace(/[\\%_]/g, (c) => '\\' + c)} - %` : '';
    let rows: ListRow[];
    try {
      rows = (product
        ? await sql`SELECT r.id, r.name, coalesce(r.design_snapshot->'template'->>'name', t.name) AS template_name,
            r.design_snapshot->'format'->>'type' AS format_type, r.total_labels, r.status, r.created_at,
            k.stage, k.test_count, k.product_name, k.created_at AS kiosk_at
          FROM runs r LEFT JOIN kiosk_runs k ON k.run_id=r.id LEFT JOIN templates t ON t.id=r.template_id
          WHERE r.id IN (
            SELECT run_id FROM kiosk_runs WHERE package_key=${product}
            UNION
            SELECT m.id FROM (SELECT id, name, source_data FROM runs WHERE data_source='manifest' ORDER BY created_at DESC LIMIT 300) m
            WHERE m.source_data->0->>'packageTag'=${product} OR m.source_data->0->>'tag'=${product} OR (${like}<>'' AND m.name ILIKE ${like})
          )
          ORDER BY r.created_at DESC LIMIT 20`
        : await sql`SELECT r.id, r.name, coalesce(r.design_snapshot->'template'->>'name', t.name) AS template_name,
            r.design_snapshot->'format'->>'type' AS format_type, r.total_labels, r.status, r.created_at,
            k.stage, k.test_count, k.product_name, k.created_at AS kiosk_at
          FROM kiosk_runs k JOIN runs r ON r.id=k.run_id LEFT JOIN templates t ON t.id=r.template_id
          WHERE k.created_at > ${since.toISOString()}::timestamptz
          ORDER BY k.created_at DESC LIMIT 30`) as ListRow[];
    } catch (error) {
      if (isMissingTable(error)) throw new OfficeError('Kiosk mode isn’t set up yet. Ask a manager.', 409);
      throw error;
    }
    const ids = rows.map((row) => row.id);
    const byRun = new Map<string, OfficeJobLike[]>();
    if (ids.length) {
      const jobs = await officeSummaryQuery(sql, user.id, ids, [], []) as Array<Record<string, unknown>>;
      for (const job of jobs) {
        const list = byRun.get(String(job.run_id)) ?? [];
        list.push({ ...(job.id ? { id: String(job.id), requestId: String(job.request_id) } : {}), from: Number(job.range_from), to: Number(job.range_to), state: String(job.state), review: job.review === true, reason: typeof job.reason === 'string' ? job.reason : null });
        byRun.set(String(job.run_id), list);
      }
    }
    return json({
      runs: rows.map((row) => {
        const summary = officeDeliverySummary(byRun.get(row.id) ?? [], Number(row.total_labels));
        return {
          id: row.id, name: row.name, designName: row.template_name ?? '', thermal: row.format_type === 'thermal',
          totalLabels: Number(row.total_labels), status: row.status, createdAt: row.kiosk_at ? new Date(row.kiosk_at).toISOString() : row.created_at,
          kiosk: row.stage ? { stage: row.stage, testCount: Number(row.test_count), productName: row.product_name ?? '' } : null,
          office: { sent: summary.sent, onTheWay: summary.onTheWay, failedLabels: summary.failedLabels, anySent: (byRun.get(row.id) ?? []).length > 0 },
        };
      }),
    });
  } catch (error) { return browserFailure(error); }
}

