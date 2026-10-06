import { and, eq, isNull } from 'drizzle-orm';
import { db } from './db';
import { runs, templates, formats } from './db/schema';
import type { RunDesign, LabelTemplate, LabelFormat } from './types';
import { OfficeError } from './office/http';

export async function captureDesign(templateId: string): Promise<RunDesign> {
  const [design] = await db.select({ template: templates, format: formats }).from(templates)
    .innerJoin(formats, eq(templates.formatId, formats.id)).where(eq(templates.id, templateId));
  if (!design) throw new OfficeError('Template or format not found', 404);
  return { template: design.template as LabelTemplate, format: design.format as LabelFormat, capturedAt: new Date().toISOString() };
}
export async function loadRunWithDesign(id: string) {
  let [run] = await db.select().from(runs).where(eq(runs.id, id));
  if (!run) throw new OfficeError('Run not found', 404);
  if (!run.designSnapshot) {
    const design = { ...await captureDesign(run.templateId), legacy: true };
    await db.update(runs).set({ designSnapshot: design }).where(and(eq(runs.id, id), isNull(runs.designSnapshot)));
    [run] = await db.select().from(runs).where(eq(runs.id, id));
  }
  return run;
}
