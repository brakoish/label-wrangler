import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { runs, templates, formats } from '../db/schema';
import type { Run, LabelTemplate, LabelFormat } from '../types';
import { hash, requirePrinter, type OfficeUser } from './auth';
import { officeSql } from './db';
import { OfficeError, uuid } from './http';
import { buildBatches } from './render';

export async function createJobs(user: OfficeUser, data: Record<string,unknown>) {
  if (!uuid(data.idempotencyKey) || typeof data.runId!=='string' || data.stationId!=='office-zebra-pi' || data.printerId!=='black-zebra' || !Number.isInteger(data.from) || !Number.isInteger(data.to)) throw new OfficeError('Invalid print request');
  if (data.reprintOf!==undefined && data.reprintOf!==null && !uuid(data.reprintOf)) throw new OfficeError('Invalid reprint reference');
  if (data.reason!==undefined && (typeof data.reason!=='string' || data.reason.length>500)) throw new OfficeError('Invalid reprint reason');
  const printer=await requirePrinter(user,data.stationId,data.printerId);
  const sql=officeSql();
  const fp=hash(JSON.stringify([data.runId,data.stationId,data.printerId,data.from,data.to,data.reprintOf || null,data.reason || null,...(data.expectedBitmapDigest === undefined ? [] : [data.expectedBitmapDigest])]));
  const previous=await sql`SELECT id,fingerprint FROM office_requests WHERE requester=${user.id} AND idempotency_key=${data.idempotencyKey}`;
  if(previous.length){
    if(previous[0].fingerprint!==fp)throw new OfficeError('Request key already used for another range',409);
    return {requestId:previous[0].id};
  }
  const station=await sql`SELECT dispatch_enabled,paired_at FROM office_stations WHERE id=${data.stationId} AND revoked_at IS NULL`;
  if(!station[0]?.dispatch_enabled || !station[0]?.paired_at)throw new OfficeError('Office Pi is awaiting verified pairing. Job creation is disabled.',409);
  // One database statement snapshots the entire referenced run/design/format.
  const snapshots=await db.select({run:runs,template:templates,format:formats}).from(runs)
    .innerJoin(templates,eq(runs.templateId,templates.id)).innerJoin(formats,eq(templates.formatId,formats.id)).where(eq(runs.id,data.runId));
  if(!snapshots.length)throw new OfficeError('Run not found in this office workspace',404);
  const snapshot=snapshots[0];
  const batches=await buildBatches(snapshot.run as Run,snapshot.template as LabelTemplate,snapshot.format as LabelFormat,Number(data.from),Number(data.to),printer.dpi,printer.max_width_dots);
  if (snapshot.template.thermalRenderMode === 'bitmap-v1') {
    const digests = batches.flatMap(batch => [...Buffer.from(batch.payload, 'base64').toString().matchAll(/\^FXLWBITMAP1:[a-f0-9]{64}:([a-f0-9]{64})\^FS/g)].map(m => m[1]));
    if (data.expectedBitmapDigest !== hash(digests.join('\n'))) throw new OfficeError('The saved run/design changed or its bitmap proof is missing. Prepare the proof again before printing.',409);
  }
  try {
    const result=await sql`SELECT office_enqueue(${user.id}::uuid,${randomUUID()}::uuid,${data.idempotencyKey}::uuid,${fp},${data.runId},${snapshot.template.id},
      ${data.stationId},${data.printerId},${Number(data.from)},${Number(data.to)},${data.reprintOf || null}::uuid,${data.reason || (data.reprintOf ? 'Operator requested reprint' : null)},${JSON.stringify(batches)}::jsonb) AS id`;
    return {requestId:result[0].id};
  } catch(error) {
    const message=error instanceof Error?error.message:'';
    for(const known of ['Station pairing not activated','Print access denied','Check printer before retrying','This range has already been queued. Use an intentional reprint with a reason.','Invalid reprint reference or reason','Resolve pending original jobs before reprinting','Idempotency key already used for another request']) {
      if(message.includes(known))throw new OfficeError(known.replace('Use an intentional reprint with a reason.','Use Reprint to print this range again.').replace('Invalid reprint reference or reason','Invalid reprint reference'),409);
    }
    throw error;
  }
}
export async function requestAccess(user: OfficeUser, requestId: string) {
  const sql=officeSql();
  const rows=await sql`SELECT * FROM office_requests WHERE id=${requestId}`;
  if(!rows.length)throw new OfficeError('Print request not found',404);
  await requirePrinter(user,rows[0].station_id,rows[0].printer_id);
  return rows[0];
}
