export type RunPreviewState =
  | { status: 'loading' }
  | { status: 'empty' }
  | { status: 'error'; message: string }
  | { status: 'ready'; url: string };

// One lifecycle for both generation and rendering: never render empty ZPL or
// publish a result after the input has changed/unmounted.
export function prepareRunPreview(
  generate: () => Promise<string>,
  render: (zpl: string) => Promise<string>,
  publish: (state: RunPreviewState) => void,
): () => void {
  let cancelled = false;
  publish({ status: 'loading' });
  void (async () => {
    try {
      const zpl = await generate();
      if (cancelled) return;
      if (!zpl.trim()) {
        publish({ status: 'empty' });
        return;
      }
      const url = await render(zpl);
      if (!cancelled) publish({ status: 'ready', url });
    } catch (error) {
      if (!cancelled) publish({
        status: 'error',
        message: error instanceof Error ? error.message : 'Could not render this label.',
      });
    }
  })();
  return () => { cancelled = true; };
}
