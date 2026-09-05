import { getContext, setContext } from 'svelte';

export type SurfaceLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

const SURFACE_CONTEXT = Symbol('ui-surface');

export function clampSurface(level: number): SurfaceLevel {
  return Math.round(Math.max(1, Math.min(8, level))) as SurfaceLevel;
}

export function useSurface(): SurfaceLevel {
  return getContext<SurfaceLevel>(SURFACE_CONTEXT) ?? 1;
}

export function setSurface(level: number): SurfaceLevel {
  const surface = clampSurface(level);
  setContext(SURFACE_CONTEXT, surface);
  return surface;
}

export const SURFACE_BG: Record<SurfaceLevel, string> = {
  1: 'bg-surface-1',
  2: 'bg-surface-2',
  3: 'bg-surface-3',
  4: 'bg-surface-4',
  5: 'bg-surface-5',
  6: 'bg-surface-6',
  7: 'bg-surface-7',
  8: 'bg-surface-8',
};

export const SURFACE_SHADOW: Record<SurfaceLevel, string> = {
  1: 'shadow-surface-1',
  2: 'shadow-surface-2',
  3: 'shadow-surface-3',
  4: 'shadow-surface-4',
  5: 'shadow-surface-5',
  6: 'shadow-surface-6',
  7: 'shadow-surface-7',
  8: 'shadow-surface-8',
};

export const SURFACE_VALUE: Record<SurfaceLevel, string> = {
  1: 'var(--surface-1)',
  2: 'var(--surface-2)',
  3: 'var(--surface-3)',
  4: 'var(--surface-4)',
  5: 'var(--surface-5)',
  6: 'var(--surface-6)',
  7: 'var(--surface-7)',
  8: 'var(--surface-8)',
};

export const SURFACE_SHADOW_VALUE: Record<SurfaceLevel, string> = {
  1: 'var(--surface-shadow-1)',
  2: 'var(--surface-shadow-2)',
  3: 'var(--surface-shadow-3)',
  4: 'var(--surface-shadow-4)',
  5: 'var(--surface-shadow-5)',
  6: 'var(--surface-shadow-6)',
  7: 'var(--surface-shadow-7)',
  8: 'var(--surface-shadow-8)',
};

const SURFACE_HOVER_BG: Record<SurfaceLevel, string> = {
  1: 'hover:bg-surface-1',
  2: 'hover:bg-surface-2',
  3: 'hover:bg-surface-3',
  4: 'hover:bg-surface-4',
  5: 'hover:bg-surface-5',
  6: 'hover:bg-surface-6',
  7: 'hover:bg-surface-7',
  8: 'hover:bg-surface-8',
};

const SURFACE_HOVER_SHADOW: Record<SurfaceLevel, string> = {
  1: 'hover:shadow-surface-1',
  2: 'hover:shadow-surface-2',
  3: 'hover:shadow-surface-3',
  4: 'hover:shadow-surface-4',
  5: 'hover:shadow-surface-5',
  6: 'hover:shadow-surface-6',
  7: 'hover:shadow-surface-7',
  8: 'hover:shadow-surface-8',
};

export function surfaceClasses(level: number, shadowLevel = level): string {
  return `${SURFACE_BG[clampSurface(level)]} ${SURFACE_SHADOW[clampSurface(shadowLevel)]}`;
}

export function surfaceHoverClasses(level: number, shadowLevel = level): string {
  return `${SURFACE_HOVER_BG[clampSurface(level)]} ${SURFACE_HOVER_SHADOW[clampSurface(shadowLevel)]}`;
}
