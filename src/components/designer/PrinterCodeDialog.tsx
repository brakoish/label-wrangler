'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Dialog } from '@/components/ui/Dialog';
import type { LabelFormat, LabelTemplate } from '@/lib/types';
import { generateZPLWithImages } from '@/lib/zplGenerator';
import { friendlyError } from '@/lib/userMessages';

/**
 * The code the printer gets for this design, for admins who set up printers.
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
  const [copied, setCopied] = useState<'yes' | 'failed' | ''>('');
  const codeRef = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(''), 2500);
    return () => clearTimeout(timer);
  }, [copied]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied('yes');
    } catch {
      // No clipboard (an old browser, a blocked permission): select the code
      // so Ctrl+C / long-press copies it.
      const range = document.createRange();
      if (codeRef.current) { range.selectNodeContents(codeRef.current); const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range); }
      setCopied('failed');
    }
  };
  useEffect(() => {
    if (!open) return;
    let active = true;
    setCode(''); setError(''); setCopied('');
    generateZPLWithImages(template, format, values)
      .then((zpl) => { if (active) setCode(zpl); })
      .catch((e) => { if (active) setError(friendlyError(e, 'Couldn’t make the printer code.')); });
    return () => { active = false; };
  }, [open, template, format, values]);
  return (
    <Dialog open={open} onClose={onClose} title="Printer setup code" description="Only needed if whoever set up your printer asks for it: copy it and send it to them. It’s what the printer gets for one label with the sample values." className="max-w-2xl">
      {error ? <p role="alert" className="text-sm text-red-400">{error}</p>
        : !code ? <p role="status" className="text-sm text-zinc-400">Making the code…</p>
        : <pre ref={codeRef} tabIndex={0} aria-label="Printer setup code" className="h-64 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-zinc-950 p-3 font-sans text-xs tabular-nums text-zinc-300">{code}</pre>}
      {copied && <p role="status" className="pt-2 text-sm text-zinc-400">{copied === 'yes' ? 'Copied. Paste it into an email or message.' : 'This browser wouldn’t copy it. The code is selected: press Ctrl+C (or ⌘+C) to copy it.'}</p>}
      <div className="dialog-actions pt-4">
        <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
        <button type="button" className="btn btn-primary" disabled={!code} onClick={() => void copy()}>
          {copied === 'yes' ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
          {copied === 'yes' ? 'Copied' : 'Copy'}
        </button>
      </div>
    </Dialog>
  );
}
