import {
  scheduleLayoutRead,
  scheduleLayoutWrite,
  type CancelLayoutTask,
} from '@/lib/motion/environment';
import { prefersReducedMotion, onReducedMotionChange } from '@/lib/motion/environment';
import { useLayoutEffect, useRef, type RefObject } from 'react';
import { Spring, type SpringTierName } from '@/lib/motion/springs';

export interface AnimatedHeightOptions {
  open?: boolean;
  tier?: SpringTierName;
}

export type AnimatedHeightParameter = boolean | AnimatedHeightOptions | undefined;

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
export function animatedHeight(node: HTMLElement, parameter: AnimatedHeightParameter = true) {
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
  const disposeEffect = height.subscribe(() => {
    if (!initialized || destroyed || height.current === writtenHeight) return;
    cancelStyle?.();
    cancelStyle = scheduleLayoutWrite(() => {
      cancelStyle = undefined;
      if (!destroyed) writeHeight();
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
    update(nextParameter: AnimatedHeightParameter = true) {
      open = resolveOptions(nextParameter).open;
      retarget();
    },
    destroy() {
      destroyed = true;
      cancelRead?.();
      cancelTarget?.();
      cancelStyle?.();
      height.destroy();
      observer?.disconnect();
      mutationObserver?.disconnect();
      stopMotionListener();
      disposeEffect();
      node.style.height = previousHeight;
      node.style.overflow = previousOverflow;
    },
  };
}

/** React lifecycle adapter; the DOM algorithm is shared with the source action. */
export function useAnimatedHeight(
  ref: RefObject<HTMLElement | null>,
  parameter: AnimatedHeightParameter = true,
) {
  const options = resolveOptions(parameter);
  const initialOpen = useRef(options.open);
  useLayoutEffect(() => {
    initialOpen.current = options.open;
  }, [options.open]);
  const controller = useRef<ReturnType<typeof animatedHeight> | null>(null);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const instance = animatedHeight(ref.current, { open: initialOpen.current, tier: options.tier });
    controller.current = instance;
    return () => {
      instance.destroy();
      controller.current = null;
    };
  }, [ref, options.tier]);
  useLayoutEffect(() => {
    controller.current?.update({ open: options.open });
  }, [options.open]);
}
