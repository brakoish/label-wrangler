import { and, eq, inArray, isNull } from 'drizzle-orm';
import { body, json, browserFailure, OfficeError } from '@/lib/office/http';
import { requireUser } from '@/lib/office/auth';
import { officeSql } from '@/lib/office/db';
import { db } from '@/lib/db';
import { templates, formats } from '@/lib/db/schema';
import { designCategories, kioskAccess, kioskDesignIds } from '@/lib/kiosk/server';
import { KIOSK_CATEGORIES, cleanCategories, isMissingTable } from '@/lib/kiosk/plan';

/**
 * GET: which designs are on the kiosk and each design's categories. A kiosk
 * account, or a manager previewing the kiosk, gets the kiosk designs themselves
 * (with their label sizes), ready to preview. `ready: false` until scripts/kiosk/schema.sql is applied.
 */
export async function GET(req: Request) {
  try {
    const access = await kioskAccess(req);
    const [ids, categories] = await Promise.all([kioskDesignIds(), designCategories()]);
    const base = { ready: ids !== null, categoriesReady: categories !== null, ids: ids ?? [], categories: categories ?? {}, canEdit: access.user.can_edit && !access.kiosk };
    if ((!access.kiosk && !access.manager) || !ids?.length) return json(base);
    const rows = await db.select({ template: templates, format: formats }).from(templates)
      .innerJoin(formats, eq(templates.formatId, formats.id))
      .where(and(inArray(templates.id, ids), isNull(templates.archivedAt)));
    // The kiosk prints on the office label printer: roll (thermal) designs only.
    const designs = rows.filter((row) => row.format.type === 'thermal').sort((a, b) => a.template.name.localeCompare(b.template.name));
    return json({ ...base, designs });
  } catch (error) { return browserFailure(error); }
}

/**
 * PUT { templateId, kiosk?: boolean, categories?: string[] }: put a design on
 * or off the kiosk, and set its categories. Accounts that can edit only, and
 * never a kiosk account.
 */
export async function PUT(req: Request) {
  try {
    const user = await requireUser(req, 'edit');
    const access = await kioskAccess(req);
    if (access.kiosk) throw new OfficeError('Your account does not have permission', 403);
    const data = await body(req, 8192);
    if (typeof data.templateId !== 'string' || !data.templateId || data.templateId.length > 200) throw new OfficeError('Invalid design');
    if (data.kiosk !== undefined && typeof data.kiosk !== 'boolean') throw new OfficeError('Invalid kiosk choice');
    if (data.categories !== undefined && (!Array.isArray(data.categories) || data.categories.some((c) => typeof c !== 'string' || !(KIOSK_CATEGORIES as readonly string[]).includes(c)))) throw new OfficeError('Invalid categories');
    const [design] = await db.select({ id: templates.id, archivedAt: templates.archivedAt, type: formats.type }).from(templates)
      .innerJoin(formats, eq(templates.formatId, formats.id)).where(eq(templates.id, data.templateId));
    if (!design) throw new OfficeError('Design not found', 404);
    const sql = officeSql();
    try {
      if (data.kiosk === true) {
        if (design.type !== 'thermal') throw new OfficeError('The kiosk prints on the office label printer, so it needs a roll label design.', 400);
        if (design.archivedAt) throw new OfficeError('Restore this design before putting it on the kiosk.', 400);
        await sql`INSERT INTO kiosk_designs(template_id,added_by) VALUES(${design.id},${user.id}::uuid) ON CONFLICT(template_id) DO NOTHING`;
      } else if (data.kiosk === false) {
        await sql`DELETE FROM kiosk_designs WHERE template_id=${design.id}`;
      }
      if (data.categories !== undefined) {
        const chosen = cleanCategories(data.categories);
        await sql.transaction([
          sql`DELETE FROM template_categories WHERE template_id=${design.id}`,
          ...chosen.map((category) => sql`INSERT INTO template_categories(template_id,category) VALUES(${design.id},${category})`),
        ]);
      }
    } catch (error) {
      if (isMissingTable(error)) throw new OfficeError('Kiosk mode isn’t set up yet, so this can’t be saved.', 409);
      throw error;
    }
    const [ids, categories] = await Promise.all([kioskDesignIds(), designCategories()]);
    return json({ ready: ids !== null, categoriesReady: categories !== null, ids: ids ?? [], categories: categories ?? {}, canEdit: true });
  } catch (error) { return browserFailure(error); }
}
