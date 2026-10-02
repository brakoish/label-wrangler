import { requireUser } from '@/lib/office/auth';
import { body, failure, json } from '@/lib/office/http';
import { createPreviewJobs } from '@/lib/office/preview';

export const maxDuration = 60;
export async function POST(req: Request) {
  try {
    const user = await requireUser(req, 'print');
    return json(await createPreviewJobs(user, await body(req, 4_000_000)));
  } catch (error) { return failure(error); }
}
