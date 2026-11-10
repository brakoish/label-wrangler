/**
 * A readable name for a design field key, for screens people read:
 * "coa_url" -> "COA link", "package_tag" -> "Package tag", "thc" -> "THC".
 * Keys that already look like words a person typed ("Product Name", "SKU")
 * are left exactly as they are, because they match a spreadsheet heading.
 */
const WORDS: Record<string, string> = {
  thc: 'THC', cbd: 'CBD', cbg: 'CBG', cbn: 'CBN', tac: 'TAC', coa: 'COA', sku: 'SKU', upc: 'UPC', ean: 'EAN',
  qr: 'QR', id: 'ID', po: 'PO', uid: 'UID', url: 'link', metrc: 'Metrc', ndc: 'NDC',
};

export function fieldDisplayName(key: string): string {
  const trimmed = (key ?? '').trim();
  if (!trimmed) return '';
  if (/\s/.test(trimmed) || /^[A-Z0-9]+$/.test(trimmed) || /^[A-Z][a-z]/.test(trimmed)) return trimmed;
  const parts = trimmed
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[_\-.\s]+/)
    .filter(Boolean)
    .map((part) => part.toLowerCase());
  if (!parts.length) return trimmed;
  return parts
    .map((part, index) => {
      const known = WORDS[part];
      if (known) return index === 0 && known === 'link' ? 'Link' : known;
      return index === 0 ? part[0].toUpperCase() + part.slice(1) : part;
    })
    .join(' ');
}
