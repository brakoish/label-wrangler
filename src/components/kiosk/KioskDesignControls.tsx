'use client';
import { useId, useState } from 'react';
import { Check } from 'lucide-react';
import { Switch } from '@/components/ui/Switch';
import { Dialog } from '@/components/ui/Dialog';
import { KIOSK_CATEGORIES, type KioskCategory } from '@/lib/kiosk/plan';

/** What the Designs list needs to show the owner's kiosk switches (from useKioskDesigns). */
export interface KioskControls {
  ready: boolean;
  categoriesReady: boolean;
  ids: ReadonlyArray<string>;
  categories: Readonly<Record<string, ReadonlyArray<KioskCategory>>>;
  busy: string | null;
  /** The last save that failed, in plain words. */
  error?: string;
  save: (templateId: string, change: { kiosk?: boolean; categories?: KioskCategory[] }) => Promise<boolean>;
}

/**
 * On a design card: "Use on kiosk" and the design's product categories.
 * Only roll (thermal) designs can go on the kiosk, since it prints on the
 * office label printer. Shown only to accounts that can edit, once kiosk mode
 * is set up.
 */
export function KioskDesignControls({ templateId, name, thermal, archived, controls }: { templateId: string; name: string; thermal: boolean; archived: boolean; controls: KioskControls }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const on = controls.ids.includes(templateId);
  const chosen = controls.categories[templateId] ?? [];
  const busy = controls.busy === templateId;
  const showSwitch = controls.ready && thermal && (!archived || on);
  if (!showSwitch && !controls.categoriesReady) return null;
  const toggleCategory = (category: KioskCategory) => {
    const next = chosen.includes(category) ? chosen.filter((c) => c !== category) : [...chosen, category];
    void controls.save(templateId, { categories: KIOSK_CATEGORIES.filter((c) => next.includes(c)) });
  };
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-zinc-800 pt-2" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      {showSwitch && (
        <div className="flex min-h-control-sm items-center gap-2">
          <Switch checked={on} disabled={busy} labelledBy={`${id}-kiosk`} onChange={(value) => void controls.save(templateId, { kiosk: value })} />
          <span id={`${id}-kiosk`} className="text-xs text-zinc-300">Use on kiosk</span>
        </div>
      )}
      {controls.categoriesReady && (
        <button type="button" className="btn btn-ghost btn-sm min-w-0 max-w-full text-xs text-zinc-300" onClick={() => setOpen(true)} aria-haspopup="dialog">
          <span className="truncate">{chosen.length ? chosen.join(', ') : 'All products'}</span>
        </button>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} title={`What is “${name}” for?`} description="Pick the kinds of products this label is for. When a product is picked, on the kiosk and in New run, its kind of label shows first. Pick none and it shows for every product.">
        <div role="group" aria-label="Kinds of products" className="flex flex-wrap gap-2">
          {KIOSK_CATEGORIES.map((category) => {
            const pressed = chosen.includes(category);
            return (
              <button key={category} type="button" aria-pressed={pressed} disabled={busy} onClick={() => toggleCategory(category)}
                className={`btn ${pressed ? 'btn-primary' : 'btn-secondary'} rounded-full`}>
                {pressed && <Check className="size-4" aria-hidden="true" />}{category}
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-sm text-zinc-400" role="status">{busy ? 'Saving…' : chosen.length ? `Shows first for ${chosen.join(', ')}.` : 'Shows for every product.'}</p>
        <div className="mt-4 flex justify-end"><button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>Done</button></div>
      </Dialog>
    </div>
  );
}
