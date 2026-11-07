import fontUrl from '$lib/assets/fonts/patrick-hand/PatrickHand-Regular.ttf?url';

let loading: Promise<void> | null = null;
let ready = false;

/** One bundled face, registered before any annotation text is measured or painted. */
export function ensureDockAnnotationFont(): Promise<void> {
  if (ready) return Promise.resolve();
  if (loading) return loading;
  loading = (async () => {
    const fonts =
      typeof document !== 'undefined'
        ? document.fonts
        : (globalThis as typeof globalThis & { fonts?: FontFaceSet }).fonts;
    if (!fonts || typeof FontFace === 'undefined') throw new Error('annotation-font-unavailable');
    const face = await new FontFace('Intent Annotation Hand', `url("${fontUrl}")`, {
      style: 'normal',
      weight: '400',
      display: 'block',
    }).load();
    fonts.add(face);
    await fonts.load('24px "Intent Annotation Hand"');
    ready = true;
  })().catch((error) => {
    loading = null;
    throw error;
  });
  return loading;
}
