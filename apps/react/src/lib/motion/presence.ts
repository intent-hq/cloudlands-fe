import { useCallback, useLayoutEffect, useRef, useState, type Key, type RefObject } from 'react';
import { onReducedMotionChange, prefersReducedMotion } from '@/lib/motion/environment';
import type { MotionTransitionConfig, TransitionConfig } from '@/lib/motion/transitions';

export interface PresenceEntry<T> {
  key: Key;
  value: T;
  present: boolean;
}

/** Retain keyed DOM through its outro, including reversal when the same key returns. */
export function usePresence<T>(items: readonly T[], getKey: (item: T) => Key, enabled = true) {
  const [state, setState] = useState(() => ({
    items,
    enabled,
    entries: items.map((value) => ({ key: getKey(value), value, present: true })),
  }));
  let entries = state.entries;
  if (state.items !== items || state.enabled !== enabled) {
    entries = items.map((value) => ({ key: getKey(value), value, present: true }));
    if (enabled) {
      const keys = new Set(entries.map((entry) => entry.key));
      state.entries.forEach((entry, index) => {
        if (!keys.has(entry.key)) entries.splice(index, 0, { ...entry, present: false });
      });
    }
    setState({ items, enabled, entries });
  }
  const remove = useCallback((key: Key) => {
    setState((current) => {
      if (!current.entries.some((entry) => entry.key === key && !entry.present)) return current;
      return {
        ...current,
        entries: current.entries.filter((entry) => entry.key !== key || entry.present),
      };
    });
  }, []);
  return { entries, remove };
}

export type TransitionFactory = (node: HTMLElement) => MotionTransitionConfig;

/** A reversible transition that owns only its animated inline declarations. */
export function createTransition(
  node: HTMLElement,
  factory: TransitionFactory,
  initial: 0 | 1 = 0,
) {
  let progress: number = initial;
  let target: number = initial;
  let frame: number | undefined;
  let finish: (() => void) | undefined;
  let recipe: MotionTransitionConfig | undefined;
  let activeConfig: TransitionConfig | undefined;
  let destroyed = false;
  let generation = 0;
  const previous = new Map<string, { value: string; priority: string }>();
  const scratch = node.ownerDocument.createElement('div').style;
  const restore = () => {
    for (const [property, value] of previous) {
      if (value.value) node.style.setProperty(property, value.value, value.priority);
      else node.style.removeProperty(property);
    }
    previous.clear();
  };
  const remember = (property: string) => {
    if (!previous.has(property))
      previous.set(property, {
        value: node.style.getPropertyValue(property),
        priority: node.style.getPropertyPriority(property),
      });
  };
  const apply = () => {
    for (const property of activeConfig?.styleProperties ?? []) remember(property);
    scratch.cssText = activeConfig?.css?.(progress, 1 - progress) ?? '';
    for (let index = 0; index < scratch.length; index += 1) {
      const property = scratch.item(index);
      remember(property);
      node.style.setProperty(property, scratch.getPropertyValue(property));
    }
    activeConfig?.tick?.(progress, 1 - progress);
  };
  const stopFrame = () => {
    generation += 1;
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
  };
  const releaseRecipe = () => {
    const dispose = activeConfig?.dispose;
    activeConfig = undefined;
    recipe = undefined;
    dispose?.();
  };
  const complete = () => {
    stopFrame();
    const currentGeneration = generation;
    progress = target;
    apply();
    if (destroyed || currentGeneration !== generation) return;
    if (target === 1) {
      restore();
      releaseRecipe();
    }
    const callback = finish;
    finish = undefined;
    callback?.();
  };
  const stopPreference = onReducedMotionChange((reduced) => {
    if (reduced && frame !== undefined) complete();
  }, node.ownerDocument);
  return {
    setPresent(present: boolean, onFinish?: () => void) {
      if (destroyed) return;
      stopFrame();
      target = present ? 1 : 0;
      finish = onFinish;
      // On reversal reuse the natural-layout recipe; do not measure the clipped row.
      recipe ??= factory(node);
      const nextConfig =
        typeof recipe === 'function' ? recipe({ direction: present ? 'in' : 'out' }) : recipe;
      if (activeConfig !== nextConfig) activeConfig?.dispose?.();
      activeConfig = nextConfig;
      const from = progress;
      const duration = (activeConfig.duration ?? 0) * Math.abs(target - from);
      const easing = activeConfig.easing ?? ((t: number) => t);
      if (prefersReducedMotion(node.ownerDocument) || duration === 0) {
        complete();
        return;
      }
      const start = performance.now() + (activeConfig.delay ?? 0);
      const currentGeneration = generation;
      apply();
      if (destroyed || currentGeneration !== generation) return;
      const tick = (now: number) => {
        if (destroyed || currentGeneration !== generation) return;
        const elapsed = Math.max(0, Math.min(1, (now - start) / duration));
        progress = from + (target - from) * Math.max(0, Math.min(1, easing(elapsed)));
        if (elapsed === 1) complete();
        else {
          apply();
          if (!destroyed && currentGeneration === generation) frame = requestAnimationFrame(tick);
        }
      };
      frame = requestAnimationFrame(tick);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      stopFrame();
      stopPreference();
      finish = undefined;
      restore();
      releaseRecipe();
    },
  };
}

export function usePresenceTransition(
  ref: RefObject<HTMLElement | null>,
  present: boolean,
  onExit: () => void,
  factory: TransitionFactory,
  enabled = true,
  enter = true,
) {
  const controller = useRef<ReturnType<typeof createTransition> | null>(null);
  const latest = useRef({ present, onExit });
  useLayoutEffect(() => {
    latest.current = { present, onExit };
  }, [present, onExit]);
  useLayoutEffect(() => {
    if (!enabled || !ref.current) return;
    const instance = createTransition(ref.current, factory, enter ? 0 : 1);
    controller.current = instance;
    return () => {
      instance.destroy();
      controller.current = null;
    };
  }, [ref, factory, enabled, enter]);
  useLayoutEffect(() => {
    if (!enabled) {
      if (!present) latest.current.onExit();
      return;
    }
    controller.current?.setPresent(present, () => {
      if (!latest.current.present) latest.current.onExit();
    });
  }, [present, enabled, factory, enter]);
}
