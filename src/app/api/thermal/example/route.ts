import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { requireUser } from '@/lib/office/auth';
import { failure, json } from '@/lib/office/http';
export async function GET(req: Request) {
  try {
    await requireUser(req);
    return json(JSON.parse(await readFile(path.join(process.cwd(), 'scripts/thermal/fixtures/Lemon-Cherry-Gelato-Your-Edits.label.json'), 'utf8')));
  } catch (error) { return failure(error); }
}
