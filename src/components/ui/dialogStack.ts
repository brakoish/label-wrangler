/**
 * Open dialogs, innermost last. Every dialog listens for Tab and Escape on the
 * document, so with a dialog opened inside another (a confirm inside a picker)
 * both would react: Tab bounced between the two focus traps and Escape closed
 * both. Only the top dialog may act on a key.
 */
const stack: symbol[] = [];
/** Open menus and dropdowns close when a dialog opens, so none is drawn over it. */
const openListeners = new Set<() => void>();
export function onDialogOpen(listener: () => void): () => void {
  openListeners.add(listener);
  return () => { openListeners.delete(listener); };
}
export function pushDialogLayer(): symbol {
  const layer = Symbol('dialog');
  stack.push(layer);
  for (const listener of [...openListeners]) listener();
  return layer;
}
export function removeDialogLayer(layer: symbol) {
  const index = stack.lastIndexOf(layer);
  if (index >= 0) stack.splice(index, 1);
}
export function isTopDialogLayer(layer: symbol): boolean {
  return stack.length > 0 && stack[stack.length - 1] === layer;
}
