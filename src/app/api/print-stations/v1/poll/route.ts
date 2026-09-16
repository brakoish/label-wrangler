import { body, json, failure } from '@/lib/office/http';
import { requireStation } from '@/lib/office/auth';
import { poll } from '@/lib/office/station';
export const runtime = 'nodejs';
export async function POST(req: Request) {
  try { const data=await body(req); const station=await requireStation(req,data.station_id); return json(await poll(station,data)); }
  catch(error){return failure(error);}
}
