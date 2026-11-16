import type { LabelTemplate, TemplateElement } from './types';
import { OfficeError } from './office/http';

/**
 * "Adjust for this run": the person moves, resizes or changes items on the
 * label for one new run. The saved design is never changed. The run is made
 * from the saved design with these items in place of the design's own, so
 * its saved run design (and every print of it, here or at the office) has
 * the adjusted layout, and the design id, name and label size stay the
 * design's.
 */
export interface LayoutOverride { elements: TemplateElement[] }

/** Designer id of a run's own copy of a design (never a saved design id). */
const PREFIX = 'rundraft:';
export function runLayoutId(templateId: string): string { return PREFIX + templateId; }
export function isRunLayoutId(id: string | null | undefined): boolean { return typeof id === 'string' && id.startsWith(PREFIX) && id.length > PREFIX.length; }
/** The saved design a run's copy was made from, or null for any other id. */
export function runLayoutSource(id: string | null | undefined): string | null { return isRunLayoutId(id) ? id!.slice(PREFIX.length) : null; }

/**
 * What the new-run page sends: the adjusted items, with each picture that is
 * still the design's own sent without its picture data (the server takes it
 * from the design), so a run with a logo doesn't send the logo twice.
 */
export function layoutOverrideFor(elements: ReadonlyArray<TemplateElement>, saved: Pick<LabelTemplate, 'elements'>): LayoutOverride {
  return {
    elements: elements.map((el) => {
      if (el.type !== 'image') return el;
      const own = saved.elements.find((s) => s.id === el.id && s.type === 'image');
      if (!own || own.type !== 'image' || own.src !== el.src) return el;
      const rest: Partial<typeof el> = { ...el };
      delete rest.src;
      return rest as TemplateElement;
    }),
  };
}

/**
 * The run's design with the adjusted items in place of the saved design's.
 * Everything else (id, name, label size, how it prints) stays the design's.
 * A picture sent without its data is the design's own picture with that id.
 */
export function applyLayoutOverride(template: LabelTemplate, override: LayoutOverride): LabelTemplate {
  const elements = override.elements.map((el) => {
    if (el.type !== 'image' || typeof el.src === 'string') return el;
    const own = template.elements.find((s) => s.id === el.id && s.type === 'image');
    if (!own || own.type !== 'image') throw new OfficeError('A picture in this run’s adjusted layout is no longer in the design. Undo the adjustments for this run and try again.', 409);
    return { ...el, src: own.src } as TemplateElement;
  });
  return { ...template, elements };
}
