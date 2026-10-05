import {
  scheduleLayoutRead,
  scheduleLayoutWrite,
  type CancelLayoutTask,
} from '$lib/utils/layout-phases';
import { prefersReducedMotion, onReducedMotionChange } from '$lib/utils/reduced-motion';
import './svelte-motion-match-media-fallback';
import type { Action } from 'svelte/action';
import { Spring, type SpringTierName } from './springs';

interface AnimatedHeightOptions {
  open?: boolean;
  tier?: SpringTierName;
}

type AnimatedHeightParameter = boolean | AnimatedHeightOptions | undefined;

function resolveOptions(parameter: AnimatedHeightParameter): Required<AnimatedHeightOptions> {
  return typeof parameter === 'object'
    ? { open: parameter.open ?? true, tier: parameter.tier ?? 'slow' }
    : { open: parameter ?? true, tier: 'slow' };
}

function measuredHeight(node: HTMLElement): number {
  const targets = node.querySelectorAll<HTMLElement>('[data-animated-height-target]');
  const content =
    targets.item(targets.length - 1) || (node.firstElementChild as HTMLElement | null);
  if (!content) return node.scrollHeight;
  // CSS height needs layout pixels, not the zoomed/transformed visual rectangle.
  const style = getComputedStyle(content);
  const height = Number.parseFloat(style.height);
  if (!Number.isFinite(height)) return content.offsetHeight;
  if (style.boxSizing === 'border-box') return height;
  return (
    height +
    ['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth'].reduce(
      (total, property) =>
        total + (Number.parseFloat(style[property as keyof CSSStyleDeclaration] as string) || 0),
      0,
    )
  );
}

/** Eases a wrapper's real height from its current position without overshoot. */
export const animatedHeight: Action<HTMLElement, AnimatedHeightParameter> = (
  node,
  parameter = true,
) => {
  let { open } = resolveOptions(parameter);
  const { tier } = resolveOptions(parameter);
  // Initially open content retains its natural layout until the first read phase.
  // Historical mounts snap to that measurement rather than animating from zero.
  const height = new Spring(0, tier);
  let initialized = !open;
  let writtenHeight: number | undefined;
  let destroyed = false;
  let cancelRead: CancelLayoutTask | undefined;
  let cancelTarget: CancelLayoutTask | undefined;
  let cancelStyle: CancelLayoutTask | undefined;
  const previousOverflow = node.style.overflow;
  const previousHeight = node.style.height;

  const writeHeight = () => {
    node.style.overflow = 'clip';
    writtenHeight = height.current;
    node.style.height = `${writtenHeight}px`;
  };
  const disposeEffect = $effect.root(() => {
    $effect(() => {
      // Subscribe here; the write consumes the latest value after all reads.
      const current = height.current;
      if (!initialized || destroyed || current === writtenHeight) return;
      cancelStyle?.();
      cancelStyle = scheduleLayoutWrite(() => {
        cancelStyle = undefined;
        if (!destroyed) writeHeight();
      });
    });
  });

  const retarget = () => {
    if (destroyed) return;
    cancelRead?.();
    cancelTarget?.();
    const setTarget = (target: number) => {
      cancelTarget = scheduleLayoutWrite(() => {
        cancelTarget = undefined;
        if (destroyed) return;
        void height.set(target, { instant: !initialized || prefersReducedMotion() });
        initialized = true;
        cancelStyle?.();
        writeHeight();
      });
    };
    if (open) {
      cancelRead = scheduleLayoutRead(() => {
        cancelRead = undefined;
        setTarget(measuredHeight(node));
      });
    } else {
      setTarget(0);
    }
  };
  const handleMotionPreference = () => {
    if (prefersReducedMotion()) retarget();
  };
  const observer =
    typeof ResizeObserver === 'undefined'
      ? undefined
      : new ResizeObserver(() => {
          if (open) retarget();
        });
  let observedContent: Element | null = null;
  const observeContent = () => {
    const targets = node.querySelectorAll<HTMLElement>('[data-animated-height-target]');
    const content = targets.item(targets.length - 1) || node.firstElementChild || node;
    if (content === observedContent) return;
    if (observedContent) observer?.unobserve(observedContent);
    observedContent = content;
    observer?.observe(content);
  };
  observeContent();
  const mutationObserver =
    typeof MutationObserver === 'undefined'
      ? undefined
      : new MutationObserver(() => {
          if (destroyed) return;
          observeContent();
          if (open) retarget();
        });
  mutationObserver?.observe(node, { childList: true, subtree: true });
  const stopMotionListener = onReducedMotionChange(handleMotionPreference);
  retarget();

  return {
    update(nextParameter = true) {
      open = resolveOptions(nextParameter).open;
      retarget();
    },
    destroy() {
      destroyed = true;
      cancelRead?.();
      cancelTarget?.();
      cancelStyle?.();
      void height.set(height.current, { instant: true });
      observer?.disconnect();
      mutationObserver?.disconnect();
      stopMotionListener();
      disposeEffect();
      node.style.height = previousHeight;
      node.style.overflow = previousOverflow;
    },
  };
};
