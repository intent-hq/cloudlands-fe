import './svelte-motion-match-media-fallback';
import { Spring } from 'svelte/motion';
import type { Action } from 'svelte/action';
import { spring, type SpringTierName } from './springs';

export interface AnimatedHeightOptions {
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
  return content?.getBoundingClientRect().height ?? node.scrollHeight;
}

function prefersReducedMotion(): MediaQueryList | undefined {
  return typeof window === 'undefined' || typeof window.matchMedia !== 'function'
    ? undefined
    : window.matchMedia('(prefers-reduced-motion: reduce)');
}

/** Animates a wrapper's real height while preserving velocity across retargets. */
export const animatedHeight: Action<HTMLElement, AnimatedHeightParameter> = (
  node,
  parameter = true,
) => {
  let { open } = resolveOptions(parameter);
  const { tier } = resolveOptions(parameter);
  const media = prefersReducedMotion();
  const initialHeight = measuredHeight(node);
  const height = new Spring(open ? initialHeight : 0, spring[tier]);
  const previousOverflow = node.style.overflow;
  const previousHeight = node.style.height;
  node.style.overflow = 'clip';

  const disposeEffect = $effect.root(() => {
    $effect(() => {
      node.style.height = `${height.current}px`;
    });
  });

  const retarget = () => {
    void height.set(open ? measuredHeight(node) : 0, { instant: media?.matches === true });
  };
  const handleMotionPreference = () => {
    if (media?.matches) void height.set(height.target, { instant: true });
  };
  const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(retarget);
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
          observeContent();
          retarget();
        });
  mutationObserver?.observe(node, { childList: true, subtree: true });
  media?.addEventListener('change', handleMotionPreference);

  return {
    update(nextParameter = true) {
      open = resolveOptions(nextParameter).open;
      retarget();
    },
    destroy() {
      observer?.disconnect();
      mutationObserver?.disconnect();
      media?.removeEventListener('change', handleMotionPreference);
      disposeEffect();
      node.style.height = previousHeight;
      node.style.overflow = previousOverflow;
    },
  };
};
