import type { Action } from 'svelte/action';
import type { TransitionConfig } from 'svelte/transition';
import { ACTIVE_EDGE_WINDOW_MS, EDGE_ANIMATION } from './constants';

const RESOURCE_COOLDOWN_MS = 10 * 60 * 1000;
const observed = new Map<Element, boolean>();
let observer: IntersectionObserver | undefined;
let media: MediaQueryList | undefined;
let listening = false;

function animationsEnabled(element: Element): boolean {
  return !document.hidden && !media?.matches && (observed.get(element) ?? true);
}

function update(element: Element): void {
  const enabled = animationsEnabled(element);
  (element as HTMLElement).dataset.motionEnabled = String(enabled);
  if (element instanceof SVGSVGElement) {
    if (enabled) element.unpauseAnimations?.();
    else element.pauseAnimations?.();
  }
}

function updateAll(): void {
  for (const element of observed.keys()) update(element);
}

function startListeners(): void {
  if (listening) return;
  listening = true;
  media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  document.addEventListener('visibilitychange', updateAll);
  media?.addEventListener('change', updateAll);
  if (typeof IntersectionObserver !== 'undefined') {
    observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        observed.set(entry.target, entry.isIntersecting);
        update(entry.target);
      }
    });
  }
}

function stopListeners(): void {
  if (!listening || observed.size > 0) return;
  listening = false;
  observer?.disconnect();
  observer = undefined;
  document.removeEventListener('visibilitychange', updateAll);
  media?.removeEventListener('change', updateAll);
  media = undefined;
}

export const activityMotion: Action<Element> = (element) => {
  startListeners();
  observed.set(element, true);
  observer?.observe(element);
  update(element);
  return {
    destroy() {
      observer?.unobserve(element);
      observed.delete(element);
      stopListeners();
    },
  };
};

export function isRecentlyActive(timestamp: string, now = Date.now()): boolean {
  const touchedAt = Date.parse(timestamp);
  return (
    Number.isFinite(touchedAt) && now - touchedAt >= 0 && now - touchedAt <= ACTIVE_EDGE_WINDOW_MS
  );
}

export function edgeAnimationDuration(
  source: { x: number; y: number },
  target: { x: number; y: number },
): number {
  const distance = Math.hypot(target.x - source.x, target.y - source.y);
  return Math.max(
    EDGE_ANIMATION.minDuration,
    EDGE_ANIMATION.baseDuration + distance / EDGE_ANIMATION.speedFactor,
  );
}

export function resourceBrightness(timestamp: string, now = Date.now()): number {
  const touchedAt = Date.parse(timestamp);
  if (!Number.isFinite(touchedAt)) return 0.35;
  const age = Math.max(0, now - touchedAt);
  return 0.35 + 0.65 * Math.max(0, 1 - age / RESOURCE_COOLDOWN_MS);
}

export function resourceCooldownRemaining(timestamp: string, now = Date.now()): number {
  const touchedAt = Date.parse(timestamp);
  if (!Number.isFinite(touchedAt)) return 0;
  return Math.max(0, RESOURCE_COOLDOWN_MS - Math.max(0, now - touchedAt));
}

export function activityNodeTransition(_node: Element): TransitionConfig {
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  return {
    duration: reduced ? 0 : 220,
    css: (t) => `opacity: ${t}; transform: scale(${0.82 + t * 0.18})`,
  };
}
