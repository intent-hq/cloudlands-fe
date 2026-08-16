import { cubicOut } from 'svelte/easing';
import type { TransitionConfig } from 'svelte/transition';

const DURATION_MS = 180;
const activeMotions = new WeakMap<HTMLElement, Animation>();

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
  const current = node.getBoundingClientRect();
  const currentOpacity = numericStyle(getComputedStyle(node), 'opacity') || 1;
  const previous = activeMotions.get(node);
  previous?.cancel();
  activeMotions.delete(node);

  if (current.height > 0) {
    node.style.height = `${current.height}px`;
    node.style.overflow = 'hidden';
  }

  return () => {
    activeMotions.get(node)?.cancel();
    activeMotions.delete(node);
    node.style.height = 'auto';
    const targetHeight = node.getBoundingClientRect().height;
    const targetOpacity = numericStyle(getComputedStyle(node), 'opacity') || 1;

    if (reducedMotion() || current.height <= 0 || targetHeight <= 0 || !node.animate) {
      node.style.height = '';
      node.style.overflow = '';
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
    activeMotions.set(node, animation);

    const finish = () => {
      if (activeMotions.get(node) !== animation) return;
      activeMotions.delete(node);
      node.style.height = '';
      node.style.overflow = '';
    };
    animation.onfinish = finish;
    animation.oncancel = finish;
  };
}

export function cancelQueuedMessageRowMotion(node: HTMLElement): void {
  activeMotions.get(node)?.cancel();
  activeMotions.delete(node);
  node.style.height = '';
  node.style.overflow = '';
}

export function queuedMessageRowTransition(node: HTMLElement): TransitionConfig {
  if (reducedMotion()) return { duration: 0 };
  cancelQueuedMessageRowMotion(node);
  const style = getComputedStyle(node);
  const height = node.getBoundingClientRect().height;
  if (!Number.isFinite(height) || height <= 0) return { duration: 0 };
  const opacity = numericStyle(style, 'opacity') || 1;

  return {
    duration: DURATION_MS,
    easing: cubicOut,
    css: (t) =>
      `overflow:hidden;height:${t * height}px;` +
      `padding-top:${t * numericStyle(style, 'paddingTop')}px;` +
      `padding-bottom:${t * numericStyle(style, 'paddingBottom')}px;` +
      `opacity:${t * opacity};`,
  };
}
