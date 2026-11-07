import fontUrl from '$lib/assets/fonts/patrick-hand/PatrickHand-Regular.ttf?url';
import { DOCK_ANNOTATION_STYLE } from './dock-annotation-style';

let loading: Promise<void> | null = null;
let selectedFamily: string | null = null;
const fallbackFamily = DOCK_ANNOTATION_STYLE.badgeFontFamily;

/** Consumers wait for settlement before painting; the choice never changes afterward. */
export function dockAnnotationFontFamily(): string {
  return selectedFamily ?? fallbackFamily;
}

/** A missing/slow optional asset settles once to the same built-in face everywhere. */
export function ensureDockAnnotationFont(): Promise<void> {
  if (loading) return loading;
  loading = (async () => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const fonts =
        typeof document !== 'undefined'
          ? document.fonts
          : (globalThis as typeof globalThis & { fonts?: FontFaceSet }).fonts;
      if (!fonts || typeof FontFace === 'undefined') throw new Error('font-api-unavailable');
      const face = await Promise.race([
        new FontFace('Intent Annotation Hand', `url("${fontUrl}")`, {
          style: 'normal',
          weight: '400',
          display: 'block',
        }).load(),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error('font-load-timeout')), 2000);
        }),
      ]);
      fonts.add(face);
      selectedFamily = DOCK_ANNOTATION_STYLE.fontFamily;
    } catch {
      selectedFamily = fallbackFamily;
    } finally {
      clearTimeout(timeout);
    }
  })();
  return loading;
}
