import { getContext, setContext } from 'svelte';

const STATIC_OVERLAY_CONTEXT = Symbol('static-overlay');
type StaticGetter = () => boolean;

export function provideStaticOverlay(staticPosition: StaticGetter): void {
  setContext(STATIC_OVERLAY_CONTEXT, staticPosition);
}

export function useStaticOverlay(): StaticGetter {
  return getContext<StaticGetter | undefined>(STATIC_OVERLAY_CONTEXT) ?? (() => false);
}
