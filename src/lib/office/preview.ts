import { randomUUID } from 'node:crypto';
import type { LabelFormat, LabelTemplate, Run } from '../types';
import { hash, requirePrinter, type OfficeUser } from './auth';
import { officeSql } from './db';
import { OfficeError, uuid } from './http';
import { buildBatches } from './render';

export function previewRun(data: Record<string, unknown>, runId: string): Run {
  if (!Number.isInteger(data.quantity) || Number(data.quantity) < 1 || Number(data.quantity) > 25) {
    throw new OfficeError('Choose 1–25 preview labels');
  }
  const template = data.template as LabelTemplate | undefined;
  const format = data.format as LabelFormat | undefined;
  if (!template || typeof template.id !== 'string' || typeof template.name !== 'string' ||
      template.name.length > 200 || !format || typeof format.id !== 'string' || template.formatId !== format.id) {
    throw new OfficeError('Invalid preview design');
  }
  const values = data.testData ?? {};
  if (!values || typeof values !== 'object' || Array.isArray(values) ||
      Object.keys(values).length > 200 || Object.values(values).some(v => typeof v !== 'string')) {
    throw new OfficeError('Invalid preview values');
  }
  const now = new Date().toISOString();
  return {
    id: runId, name: `Designer test: ${template.name}`, templateId: template.id,
    presetId: null, staticValues: values as Record<string, string>, fieldMappings: {},
    dataSource: 'manual', mappedField: null, sourceData: Array.from({ length: Number(data.quantity) }, () => ({})),
    status: 'queued', totalLabels: Number(data.quantity), printedCount: 0, pinnedAt: null,
    notes: 'Designer preview test. Office queue stores the exact submitted design bytes; later template edits do not change this queued print.',
    createdAt: now, updatedAt: now, completedAt: null,
  };
}

export async function createPreviewJobs(user: OfficeUser, data: Record<string, unknown>) {
  if (!uuid(data.idempotencyKey) || data.stationId !== 'office-zebra-pi' || data.printerId !== 'black-zebra') {
    throw new OfficeError('Invalid preview print request');
  }
  const runId = `designer-test-${user.id}-${data.idempotencyKey}`;
  const run = previewRun(data, runId);
  const printer = await requirePrinter(user, data.stationId, data.printerId);
  const template = data.template as LabelTemplate;
  const format = data.format as LabelFormat;
  const fp = hash(JSON.stringify(['designer-preview', data.stationId, data.printerId, data.quantity, template, format, data.testData ?? {}, ...(data.expectedPixelDigests === undefined ? [] : [data.expectedPixelDigests])]));
  const sql = officeSql();
  const previous = await sql`SELECT id,fingerprint FROM office_requests WHERE requester=${user.id} AND idempotency_key=${data.idempotencyKey}`;
  if (previous.length) {
    if (previous[0].fingerprint !== fp) throw new OfficeError('Request key already used for a different preview', 409);
    return { requestId: previous[0].id, runId };
  }
  // Only a library template can anchor a test record. Render the submitted
  // editor snapshot, not a potentially older autosave from the database.
  const existing = await sql`SELECT id FROM templates WHERE id=${template.id}`;
  if (!existing.length) throw new OfficeError('Save this template before test printing', 404);
  const batches = await buildBatches(run, template, format, 1, run.totalLabels, printer.dpi, printer.max_width_dots);
  if (template.thermalRenderMode === 'bitmap-v1') {
    const actual = batches.flatMap(batch => [...Buffer.from(batch.payload, 'base64').toString().matchAll(/\^FXLWBITMAP1:[a-f0-9]{64}:([a-f0-9]{64})\^FS/g)].map(m => m[1]));
    if (JSON.stringify(data.expectedPixelDigests) !== JSON.stringify(actual)) throw new OfficeError('Preview changed or is missing. Refresh the bitmap proof before printing.', 409);
  }
  try {
    // Both statements commit together. Lost-response retries share the same
    // run/key; office_enqueue owns the existing station lock and safety gates.
    const result = await sql.transaction([
      sql`INSERT INTO runs(id,name,template_id,static_values,field_mappings,data_source,source_data,status,total_labels,notes,created_at,updated_at)
        VALUES(${run.id},${run.name},${run.templateId},${JSON.stringify(run.staticValues)}::jsonb,'{}'::jsonb,'manual',
          ${JSON.stringify(run.sourceData)}::jsonb,'queued',${run.totalLabels},${run.notes},${run.createdAt},${run.updatedAt})
        ON CONFLICT(id) DO NOTHING`,
      sql`SELECT office_enqueue(${user.id}::uuid,${randomUUID()}::uuid,${data.idempotencyKey}::uuid,${fp},${runId},${template.id},
        ${data.stationId},${data.printerId},1,${run.totalLabels},NULL::uuid,'Designer preview test',${JSON.stringify(batches)}::jsonb) AS id`,
    ]);
    return { requestId: result[1][0].id, runId };
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    for (const known of ['Station pairing not activated', 'Print access denied', 'Check printer before retrying', 'Idempotency key already used for another request']) {
      if (message.includes(known)) throw new OfficeError(known, 409);
    }
    throw error;
  }
}
