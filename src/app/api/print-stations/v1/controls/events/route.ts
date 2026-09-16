import { body,json,failure } from '@/lib/office/http';
import { requireStation } from '@/lib/office/auth';
import { controlEvent } from '@/lib/office/controls';
export async function POST(req:Request){try{const d=await body(req);return json(await controlEvent(await requireStation(req,d.station_id),d));}catch(e){return failure(e);}}
