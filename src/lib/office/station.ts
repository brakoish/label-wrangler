import { officeSql } from './db';
import { OfficeError, uuid } from './http';

export function validatePoll(data: Record<string, unknown>) {
  if (data.protocol !== 1 || typeof data.accept_job !== 'boolean' || typeof data.agent_version !== 'string' || data.agent_version.length>100 || !Array.isArray(data.printers) || data.printers.length>10) throw new OfficeError('Invalid poll');
  for (const p of data.printers) {
    if (!p || typeof p.id!=='string' || typeof p.serial!=='string' || typeof p.available!=='boolean' || !Number.isInteger(p.dpi) || !Number.isInteger(p.max_width_dots) || !Array.isArray(p.content_types) || p.content_types.some((t: unknown)=>typeof t!=='string')) throw new OfficeError('Invalid printer advertisement');
  }
}
export function validateEvent(data: Record<string, unknown>) {
  if (data.protocol !== 1 || !uuid(data.event_id) || !uuid(data.job_id) || !['submitted','sent_to_printer','rejected','needs_review'].includes(String(data.state)) ||
    (data.cups_job_id !== null && (!Number.isInteger(data.cups_job_id) || Number(data.cups_job_id)<1)) ||
    (data.reason !== null && (typeof data.reason!=='string' || data.reason.length>200)) || typeof data.observed_at_unix!=='number' || !Number.isFinite(data.observed_at_unix)) throw new OfficeError('Invalid station event');
}
export async function poll(station: string, data: Record<string, unknown>) {
  validatePoll(data); const sql = officeSql();
  const result = await sql`SELECT office_poll(${station},${String(data.agent_version)},${JSON.stringify(data.printers)}::jsonb,${Boolean(data.accept_job)}) AS response`;
  return result[0].response;
}
export async function event(station: string, data: Record<string, unknown>) {
  validateEvent(data); const sql = officeSql();
  const jobs = await sql`SELECT id FROM office_jobs WHERE id=${String(data.job_id)} AND station_id=${station}`;
  if (!jobs.length) throw new OfficeError('Job not owned by station', 403);
  const result = await sql`SELECT office_event(${station},${JSON.stringify(data)}::jsonb) AS response`;
  return result[0].response;
}
