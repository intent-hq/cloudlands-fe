import { getContext, setContext } from 'svelte';
import { exitFallbackMs, spring, type CrispOutParams, type SpringInParams } from '$lib/motion';

export type OverlaySide = 'top' | 'right' | 'bottom' | 'left';
type OpenGetter = () => boolean;

const OPEN_CONTEXT = Symbol('overlay-open');
const backdrop = { tier: 'moderate', x: 0, y: 0, scale: 1, opacity: 0 } as const;
const dialog = { tier: 'slow', x: 0, y: 8, scale: 0.97, opacity: 0 } as const;
const sheetOffsets: Record<OverlaySide, Pick<SpringInParams, 'x' | 'y'>> = {
  top: { x: 0, y: '-100%' },
  right: { x: '100%', y: 0 },
  bottom: { x: 0, y: '100%' },
  left: { x: '-100%', y: 0 },
};

export const overlayMotion = {
  backdrop: { enter: backdrop, exit: backdrop },
  dialog: { enter: dialog, exit: dialog },
  sheet(side: OverlaySide): { enter: SpringInParams; exit: CrispOutParams } {
    const motion = { tier: 'slow' as const, scale: 1, opacity: 1, ...sheetOffsets[side] };
    return { enter: motion, exit: motion };
  },
};

export function provideOverlayOpen(open: OpenGetter): void {
  setContext(OPEN_CONTEXT, open);
}

export function useOverlayOpen(): OpenGetter {
  const open = getContext<OpenGetter | undefined>(OPEN_CONTEXT);
  if (!open) throw new Error('Dialog or Sheet Content must be nested inside its Root.');
  return open;
}

export function createOverlayPresence(open: OpenGetter) {
  let mounted = $state(open());

  $effect(() => {
    if (open()) {
      mounted = true;
      return;
    }
    if (!mounted) return;
    const fallback = window.setTimeout(() => (mounted = false), exitFallbackMs(spring.slow));
    return () => window.clearTimeout(fallback);
  });

  return {
    get mounted() {
      return mounted;
    },
    finishExit() {
      if (!open()) mounted = false;
    },
  };
}
