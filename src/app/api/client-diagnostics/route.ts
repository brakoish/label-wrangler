import { requireUser } from '@/lib/office/auth';
import { body, failure, json, OfficeError } from '@/lib/office/http';
export async function POST(req: Request) {
  try {
    await requireUser(req);
    const data=await body(req,512);
    if (!['javascript-error','unhandled-rejection','long-task'].includes(String(data.kind)) || !['home','runs','designer','formats','nabis'].includes(String(data.page))) throw new OfficeError('Invalid diagnostic');
    if(data.duration!==undefined && (typeof data.duration!=='number'||!Number.isFinite(data.duration)||data.duration<0||data.duration>3600000)) throw new OfficeError('Invalid duration');
    console.warn('client-diagnostic',JSON.stringify({kind:data.kind,page:data.page,duration:data.duration}));
    return json({ok:true});
  } catch(error) { return failure(error); }
}
