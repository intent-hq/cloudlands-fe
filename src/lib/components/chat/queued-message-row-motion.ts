import { cubicOut } from 'svelte/easing';
import type { TransitionConfig } from 'svelte/transition';
import { beforeFollowBottomMutation, type FollowBottomMutation } from '$lib/utils/smartScroll';

const DURATION_MS = 180;
interface ActiveMotion {
  animation: Animation;
  bottomMutation: FollowBottomMutation;
}

const activeMotions = new WeakMap<HTMLElement, ActiveMotion>();

function finishActiveMotion(node: HTMLElement, motion: ActiveMotion): void {
  if (activeMotions.get(node) !== motion) return;
  activeMotions.delete(node);
  node.style.height = '';
  node.style.overflow = '';
  motion.bottomMutation.settle();
}

function cancelActiveMotion(node: HTMLElement): void {
  const motion = activeMotions.get(node);
  if (!motion) return;
  activeMotions.delete(node);
  motion.animation.cancel();
  node.style.height = '';
  node.style.overflow = '';
  motion.bottomMutation.settle();
}

function reducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true
  );
}

function numericStyle(style: CSSStyleDeclaration, property: keyof CSSStyleDeclaration): number {
  const value = Number.parseFloat(String(style[property]));
  return Number.isFinite(value) ? value : 0;
}

export function captureQueuedMessageRowMotion(node: HTMLElement): () => void {
  const bottomMutation = beforeFollowBottomMutation(node);
  const current = node.getBoundingClientRect();
  const currentOpacity = numericStyle(getComputedStyle(node), 'opacity') || 1;
  cancelActiveMotion(node);

  if (current.height > 0) {
    node.style.height = `${current.height}px`;
    node.style.overflow = 'hidden';
  }

  return () => {
    cancelActiveMotion(node);
    node.style.height = 'auto';
    const targetHeight = node.getBoundingClientRect().height;
    const targetOpacity = numericStyle(getComputedStyle(node), 'opacity') || 1;

    if (reducedMotion() || current.height <= 0 || targetHeight <= 0 || !node.animate) {
      node.style.height = '';
      node.style.overflow = '';
      bottomMutation.settle();
      return;
    }

    node.style.height = `${current.height}px`;
    const animation = node.animate(
      [
        { height: `${current.height}px`, opacity: currentOpacity },
        { height: `${targetHeight}px`, opacity: Math.min(currentOpacity, targetOpacity, 0.72) },
        { height: `${targetHeight}px`, opacity: targetOpacity },
      ],
      { duration: DURATION_MS, easing: 'cubic-bezier(0.33, 1, 0.68, 1)' },
    );
    const motion = { animation, bottomMutation };
    activeMotions.set(node, motion);
    bottomMutation.request();

    const finish = () => finishActiveMotion(node, motion);
    animation.onfinish = finish;
    animation.oncancel = finish;
  };
}

export function cancelQueuedMessageRowMotion(node: HTMLElement): void {
  cancelActiveMotion(node);
}

export function queuedMessageRowTransition(
  node: HTMLElement,
  _params?: undefined,
  options: { direction?: 'in' | 'out' | 'both' } = {},
): TransitionConfig {
  const bottomMutation = beforeFollowBottomMutation(node);
  if (reducedMotion()) {
    bottomMutation.settle();
    return { duration: 0 };
  }
  cancelQueuedMessageRowMotion(node);
  const style = getComputedStyle(node);
  const height = node.getBoundingClientRect().height;
  if (!Number.isFinite(height) || height <= 0) {
    bottomMutation.settle();
    return { duration: 0 };
  }
  const opacity = numericStyle(style, 'opacity') || 1;
  let settled = false;

  return {
    duration: DURATION_MS,
    easing: cubicOut,
    css: (t) =>
      `overflow:hidden;height:${t * height}px;` +
      `padding-top:${t * numericStyle(style, 'paddingTop')}px;` +
      `padding-bottom:${t * numericStyle(style, 'paddingBottom')}px;` +
      `opacity:${t * opacity};`,
    tick: (t) => {
      bottomMutation.request();
      const finished = options.direction === 'out' ? t === 0 : t === 1;
      if (!settled && finished) {
        settled = true;
        bottomMutation.settle();
      }
    },
  };
}
