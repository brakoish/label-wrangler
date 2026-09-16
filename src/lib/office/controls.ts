import { officeSql } from './db';
import { OfficeError, uuid } from './http';
export function validateControlPoll(d:Record<string,unknown>){
 if(d.protocol!==1 || typeof d.controls_version!=='string' || d.controls_version.length>100 || !Array.isArray(d.printers) || d.printers.length>10)throw new OfficeError('Invalid control poll');
 for(const p of d.printers){if(!p || typeof p.id!=='string' || typeof p.serial!=='string' || ![true,false,null].includes(p.paused) || typeof p.observed_at_unix!=='number' || !Number.isFinite(p.observed_at_unix) || !Array.isArray(p.actions) || p.actions.some((a:unknown)=>a!=='pause' && a!=='resume'))throw new OfficeError('Invalid control observation');}
}
export function validateControlEvent(d:Record<string,unknown>){
 if(d.protocol!==1 || !uuid(d.control_id) || !['succeeded','failed','expired','uncertain'].includes(String(d.state)) || ![true,false,null].includes(d.paused as boolean|null) || typeof d.observed_at_unix!=='number' || !Number.isFinite(d.observed_at_unix) || typeof d.reason!=='string' || d.reason.length>200)throw new OfficeError('Invalid control event');
}
export async function controlPoll(sid:string,d:Record<string,unknown>){validateControlPoll(d);const sql=officeSql();return (await sql`SELECT office_controls_poll(${sid},${JSON.stringify(d.printers)}::jsonb) AS response`)[0].response;}
export async function controlEvent(sid:string,d:Record<string,unknown>){validateControlEvent(d);const sql=officeSql();if(!(await sql`SELECT id FROM office_controls WHERE id=${String(d.control_id)} AND station_id=${sid}`).length)throw new OfficeError('Control ownership denied',403);return (await sql`SELECT office_control_event(${sid},${JSON.stringify(d)}::jsonb) AS response`)[0].response;}
