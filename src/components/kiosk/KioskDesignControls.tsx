'use client';
import { useEffect, useId, useState } from 'react';
import { AlertTriangle, Check, X } from 'lucide-react';
import { Switch } from '@/components/ui/Switch';
import { Dialog } from '@/components/ui/Dialog';
import { KIOSK_CATEGORIES, brandKey, cleanBrands, type KioskCategory } from '@/lib/kiosk/plan';

/** What the Designs list needs to show the owner's kiosk switches (from useKioskDesigns). */
export interface KioskControls {
  ready: boolean;
  categoriesReady: boolean;
  ids: ReadonlyArray<string>;
  categories: Readonly<Record<string, ReadonlyArray<KioskCategory>>>;
  brandsReady?: boolean;
  brands?: Readonly<Record<string, ReadonlyArray<string>>>;
  busy: string | null;
  /** The last save that failed, in plain words. */
  error?: string;
  save: (templateId: string, change: { kiosk?: boolean; categories?: KioskCategory[]; brands?: string[] }) => Promise<boolean>;
}

/** Manifest's brand names, loaded once per page for the brand choice. */
let brandList: Promise<string[]> | null = null;
function loadBrands(): Promise<string[]> {
  brandList ??= fetch('/api/kiosk/brands', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : { brands: [] }))
    .then((data) => (Array.isArray(data.brands) ? data.brands.filter((b: unknown): b is string => typeof b === 'string') : []))
    .catch(() => { brandList = null; return []; });
  return brandList;
}

/**
 * On a design card: "Use on kiosk", the kinds of products the label is for,
 * and (optionally) the only brands it's for. A label goes on the kiosk only
 * with at least one kind: the kiosk offers each product only the labels set
 * for its kind. Only roll (thermal) designs can go on the kiosk, since it
 * prints on the office label printer. Shown only to accounts that can edit,
 * once kiosk mode is set up.
 */
export function KioskDesignControls({ templateId, name, thermal, archived, controls }: { templateId: string; name: string; thermal: boolean; archived: boolean; controls: KioskControls }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  // "Use on kiosk" pressed before any kind was picked: the first kind picked puts it on.
  const [turningOn, setTurningOn] = useState(false);
  const [brandText, setBrandText] = useState('');
  const [options, setOptions] = useState<string[]>([]);
  const on = controls.ids.includes(templateId);
  const chosen = controls.categories[templateId] ?? [];
  const brands = controls.brands?.[templateId] ?? [];
  const busy = controls.busy === templateId;
  const showSwitch = controls.ready && thermal && (!archived || on);
  useEffect(() => {
    if (!open || !controls.brandsReady) return;
    let live = true;
    void loadBrands().then((list) => { if (live) setOptions(list); });
    return () => { live = false; };
  }, [open, controls.brandsReady]);
  if (!showSwitch && !controls.categoriesReady) return null;
  const close = () => { setOpen(false); setTurningOn(false); setBrandText(''); };
  const toggleKiosk = (value: boolean) => {
    if (value && !chosen.length) { setTurningOn(true); setOpen(true); return; }
    void controls.save(templateId, { kiosk: value });
  };
  const toggleCategory = (category: KioskCategory) => {
    const next = KIOSK_CATEGORIES.filter((c) => (c === category ? !chosen.includes(c) : chosen.includes(c)));
    if (turningOn && next.length) {
      void controls.save(templateId, { kiosk: true, categories: next }).then((ok) => { if (ok) setTurningOn(false); });
      return;
    }
    // A kiosk label keeps at least one kind; take it off the kiosk to clear them.
    if (on && !next.length) return;
    void controls.save(templateId, { categories: next });
  };
  const addBrand = (raw: string) => {
    const next = cleanBrands([...brands, raw]);
    setBrandText('');
    if (next.length !== brands.length) void controls.save(templateId, { brands: next });
  };
  const removeBrand = (brand: string) => { void controls.save(templateId, { brands: brands.filter((b) => brandKey(b) !== brandKey(brand)) }); };
  const summary = chosen.length ? `${chosen.join(', ')}${brands.length ? ` · ${brands.join(', ')} only` : ''}` : on ? 'Pick what it’s for' : 'All products';
  const listId = `${id}-brands`;
  const unknownBrand = brandText.trim() && options.length > 0 && !options.some((o) => brandKey(o) === brandKey(brandText));
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-zinc-800 pt-2" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      {showSwitch && (
        <div className="flex min-h-control-sm items-center gap-2">
          <Switch checked={on} disabled={busy} labelledBy={`${id}-kiosk`} onChange={toggleKiosk} />
          <span id={`${id}-kiosk`} className="text-xs text-zinc-300">Use on kiosk</span>
        </div>
      )}
      {controls.categoriesReady && (
        <button type="button" className={`btn btn-ghost btn-sm min-w-0 max-w-full text-xs ${on && !chosen.length ? 'text-amber-300' : 'text-zinc-300'}`} onClick={() => setOpen(true)} aria-haspopup="dialog">
          {on && !chosen.length && <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />}
          <span className="truncate">{summary}</span>
        </button>
      )}
      {on && !chosen.length && <p className="w-full text-xs text-amber-300">Staff can’t use this label on the kiosk until you pick what it’s for.</p>}
      <Dialog open={open} onClose={close} title={`What is “${name}” for?`}
        description={turningOn
          ? 'Pick the kinds of products this label is for. It goes on the kiosk with the first one you pick, and the kiosk only offers it for those products.'
          : 'Pick the kinds of products this label is for. The kiosk only offers it for those products; New run lists it first for them.'}>
        <div role="group" aria-label="Kinds of products" className="flex flex-wrap gap-2">
          {KIOSK_CATEGORIES.map((category) => {
            const pressed = chosen.includes(category);
            return (
              <button key={category} type="button" aria-pressed={pressed} disabled={busy || (pressed && on && chosen.length === 1)} onClick={() => toggleCategory(category)}
                className={`btn ${pressed ? 'btn-primary' : 'btn-secondary'} rounded-full`}>
                {pressed && <Check className="size-4" aria-hidden="true" />}{category}
              </button>
            );
          })}
        </div>
        {on && chosen.length === 1 && <p className="mt-2 text-xs text-zinc-500">A kiosk label needs at least one kind. To clear it, turn off “Use on kiosk” first.</p>}
        {controls.brandsReady && chosen.length > 0 && !turningOn && (
          <div className="mt-5 space-y-2">
            <p className="text-sm font-medium text-zinc-200">Only for some brands? <span className="font-normal text-zinc-400">(optional)</span></p>
            <p className="text-sm text-zinc-400">Leave it empty and the label is for every brand. Add brands and the kiosk only offers it for their products, ahead of general labels.</p>
            {brands.length > 0 && (
              <ul className="flex flex-wrap gap-2" aria-label="Brands">
                {brands.map((brand) => (
                  <li key={brand}>
                    <button type="button" className="btn btn-secondary btn-sm rounded-full" disabled={busy} onClick={() => removeBrand(brand)} aria-label={`Remove ${brand}`}>
                      {brand}<X className="size-3.5" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (brandText.trim()) addBrand(brandText); }}>
              <label htmlFor={`${id}-brand`} className="sr-only">Brand name</label>
              <input id={`${id}-brand`} className="field flex-1" list={listId} value={brandText} onChange={(e) => setBrandText(e.target.value)} placeholder="Type a brand, e.g. Zero Gravity" autoComplete="off" disabled={busy || brands.length >= 20} />
              <datalist id={listId}>{options.filter((o) => !brands.some((b) => brandKey(b) === brandKey(o))).map((o) => <option key={o} value={o} />)}</datalist>
              <button type="submit" className="btn btn-secondary" disabled={busy || !brandText.trim()}>Add</button>
            </form>
            {unknownBrand && <p className="text-xs text-amber-300">Manifest has no brand called “{brandText.trim()}”. Check the spelling, or it won’t match any product.</p>}
          </div>
        )}
        {controls.error && <p role="alert" className="mt-3 text-sm text-red-400">{controls.error}</p>}
        <p className="mt-3 text-sm text-zinc-400" role="status">{busy ? 'Saving…' : chosen.length ? `The kiosk offers it for ${chosen.join(', ')}${brands.length ? ` from ${brands.join(', ')}` : ''}.` : turningOn ? 'Pick at least one to put it on the kiosk.' : 'Not set for any kind yet.'}</p>
        <div className="mt-4 flex justify-end"><button type="button" className="btn btn-secondary" onClick={close}>Done</button></div>
      </Dialog>
    </div>
  );
}
