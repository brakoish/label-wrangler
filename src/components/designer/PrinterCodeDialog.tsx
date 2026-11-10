'use client';

import { useEffect, useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import type { LabelFormat, LabelTemplate } from '@/lib/types';
import { generateZPLWithImages } from '@/lib/zplGenerator';
import { friendlyError } from '@/lib/userMessages';

/**
 * The raw printer commands for this design, for admins who set up printers.
 * Kept out of the designer's main view: opened from its More menu. Read-only:
 * it shows what the preview already generates and sends nothing.
 */
export function PrinterCodeDialog({ open, onClose, template, format, values }: {
  open: boolean;
  onClose: () => void;
  template: LabelTemplate;
  format: LabelFormat;
  values: Record<string, string>;
}) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    let active = true;
    setCode(''); setError('');
    generateZPLWithImages(template, format, values)
      .then((zpl) => { if (active) setCode(zpl); })
      .catch((e) => { if (active) setError(friendlyError(e, 'Couldn’t make the printer commands.')); });
    return () => { active = false; };
  }, [open, template, format, values]);
  return (
    <Dialog open={open} onClose={onClose} title="Printer commands" description="What the printer gets for one label with the sample values." className="max-w-2xl">
      {error ? <p role="alert" className="text-sm text-red-400">{error}</p>
        : !code ? <p role="status" className="text-sm text-zinc-400">Making the commands…</p>
        : <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap break-all rounded-lg bg-zinc-950 p-3 font-sans text-xs tabular-nums text-zinc-300">{code}</pre>}
      <div className="dialog-actions pt-4">
        <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
      </div>
    </Dialog>
  );
}
