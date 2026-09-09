import type { Action } from 'svelte/action';
import type { TransitionConfig } from 'svelte/transition';
import { backOut, cubicIn } from 'svelte/easing';
import { ACTIVE_EDGE_WINDOW_MS, EDGE_ANIMATION } from './constants';

const RESOURCE_COOLDOWN_MS = 10 * 60 * 1000;
const RESOURCE_OPACITY_FLOOR = 0.4;
const observed = new Map<Element, boolean>();
let observer: IntersectionObserver | undefined;
let media: MediaQueryList | undefined;
let listening = false;

interface NodeTransitionParams {
  delay?: number;
  exit?: boolean;
  playbackSpeed?: number;
}

interface WritePulseParams {
  additions: number;
  deletions: number;
  enabled: boolean;
  nudgeX: number;
  nudgeY: number;
  timestamp?: string;
}

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
  playbackSpeed = 1,
): number {
  const distance = Math.hypot(target.x - source.x, target.y - source.y);
  const duration = Math.max(
    EDGE_ANIMATION.minDuration,
    EDGE_ANIMATION.baseDuration + distance / EDGE_ANIMATION.speedFactor,
  );
  return Math.max(0.45, Math.min(2.2, duration) / Math.sqrt(playbackSpeed));
}

export function playbackDuration(durationMs: number, playbackSpeed = 1): number {
  return Math.max(140, Math.round(durationMs / Math.sqrt(playbackSpeed)));
}

export function nodeEnterDelay(index: number, playbackSpeed = 1): number {
  return Math.round((Math.max(0, index) * 40) / Math.sqrt(playbackSpeed));
}

export function messageParticleLimit(playbackSpeed = 1): number {
  if (playbackSpeed >= 8) return 3;
  if (playbackSpeed >= 4) return 5;
  return 8;
}

export function resourceBrightness(timestamp: string, now = Date.now()): number {
  const touchedAt = Date.parse(timestamp);
  if (!Number.isFinite(touchedAt)) return RESOURCE_OPACITY_FLOOR;
  const age = Math.max(0, now - touchedAt);
  return (
    RESOURCE_OPACITY_FLOOR +
    (1 - RESOURCE_OPACITY_FLOOR) * Math.max(0, 1 - age / RESOURCE_COOLDOWN_MS)
  );
}

export function resourceOpacity(timestamp: string, dimmed: boolean, now = Date.now()): number {
  const brightness = resourceBrightness(timestamp, now);
  return dimmed ? Math.max(RESOURCE_OPACITY_FLOOR, brightness * 0.28) : brightness;
}

export function resourceCooldownRemaining(timestamp: string, now = Date.now()): number {
  const touchedAt = Date.parse(timestamp);
  if (!Number.isFinite(touchedAt)) return 0;
  return Math.max(0, RESOURCE_COOLDOWN_MS - Math.max(0, now - touchedAt));
}

export function activityNodeTransition(
  _node: Element,
  { delay = 0, exit = false, playbackSpeed = 1 }: NodeTransitionParams = {},
): TransitionConfig {
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  if (reduced) {
    return { delay: exit ? 0 : delay, duration: 140, css: (t) => `opacity: ${t}` };
  }
  return {
    delay: exit ? 0 : delay,
    duration: playbackDuration(exit ? 200 : 320, playbackSpeed),
    easing: exit ? cubicIn : backOut,
    css: (t) =>
      `opacity: ${Math.min(1, Math.max(0, t))}; transform: scale(${exit ? 0.72 + t * 0.28 : 0.6 + t * 0.4})`,
  };
}

export function activityHullTransition(
  node: Element,
  { delay = 0, exit = false, playbackSpeed = 1 }: NodeTransitionParams = {},
): TransitionConfig {
  const reduced =
    (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false) ||
    node.closest('[data-motion-enabled="false"]') !== null;
  if (reduced) {
    return { delay: exit ? 0 : delay, duration: 140, css: (t) => `opacity: ${t}` };
  }
  return {
    delay: exit ? 0 : delay,
    duration: playbackDuration(exit ? 200 : 320, playbackSpeed),
    easing: exit ? cubicIn : backOut,
    css: (t) =>
      `opacity: ${Math.min(1, Math.max(0, t))}; transform: scale(${exit ? 0.72 + t * 0.28 : 0.6 + t * 0.4})`,
  };
}

export const writePulse: Action<HTMLElement, WritePulseParams> = (element, initial) => {
  let previousTimestamp: string | undefined;
  let nudgeAnimation: Animation | undefined;
  let countAnimation: Animation | undefined;

  const run = (params: WritePulseParams) => {
    if (!params.enabled || !params.timestamp || params.timestamp === previousTimestamp) return;
    previousTimestamp = params.timestamp;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (reduced || element.dataset.motionEnabled === 'false') return;
    nudgeAnimation?.cancel();
    countAnimation?.cancel();
    nudgeAnimation = element.animate(
      [
        { transform: 'translate(0, 0)' },
        { transform: `translate(${params.nudgeX}px, ${params.nudgeY}px)`, offset: 0.48 },
        { transform: 'translate(0, 0)' },
      ],
      { duration: 360, easing: 'cubic-bezier(.22,1.25,.45,1)' },
    );
    const count = element.querySelector<HTMLElement>('[data-write-count]');
    countAnimation = count?.animate(
      [
        { '--display-additions': '0', '--display-deletions': '0' } as Keyframe,
        {
          '--display-additions': String(params.additions),
          '--display-deletions': String(params.deletions),
        } as Keyframe,
      ],
      { duration: 420, easing: 'ease-out' },
    );
  };

  run(initial);
  return {
    update: run,
    destroy() {
      nudgeAnimation?.cancel();
      countAnimation?.cancel();
    },
  };
};
