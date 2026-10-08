import { tick } from 'svelte';
import type { Action } from 'svelte/action';
import { spring } from '$lib/motion';
import { onReducedMotionChange, prefersReducedMotion } from '$lib/utils/reduced-motion';

export const homeSidebarMotion: Action<HTMLElement, string> = (root, initial) => {
  let value = initial;
  let generation = 0;
  const animations = new Map<Animation, HTMLElement>();
  const restore = (node: HTMLElement) => {
    node.removeAttribute('data-home-sidebar-exiting');
    node.removeAttribute('data-home-panel-exiting');
    if (node.matches('.home-sidebar-content')) node.hidden = node.dataset.value !== value;
    if (node.dataset.homeDestination === 'assistant') node.hidden = value !== 'assistant';
  };
  const cancel = () => {
    const pending = [...animations];
    animations.clear();
    for (const [animation, node] of pending) {
      animation.cancel();
      restore(node);
    }
  };
  const stopMotionListener = onReducedMotionChange((reduced) => {
    if (reduced) {
      generation++;
      cancel();
      for (const panel of root.querySelectorAll<HTMLElement>('[data-home-destination]')) {
        for (const animation of panel.getAnimations()) animation.finish();
      }
    }
  }, root.ownerDocument);

  return {
    update(next) {
      if (next === value) return;
      const previous = value;
      value = next;
      const run = ++generation;
      const painted = new Map(
        [...animations.values()].map((node) => {
          const style = getComputedStyle(node);
          return [node, { transform: style.transform, opacity: Number(style.opacity) }] as const;
        }),
      );
      cancel();
      if (prefersReducedMotion(root.ownerDocument)) return;
      void tick().then(() => {
        if (run !== generation || !root.isConnected || prefersReducedMotion(root.ownerDocument))
          return;
        const panels = [...root.querySelectorAll<HTMLElement>('.home-sidebar-content')];
        const incoming = panels.find((node) => node.dataset.value === next);
        const outgoing = panels.find((node) => node.dataset.value === previous);
        if (!incoming || !outgoing) return;
        const direction = next === 'assistant' ? 1 : -1;
        const style = getComputedStyle(incoming);
        const timing = {
          duration:
            Number.parseFloat(style.getPropertyValue('--spring-moderate')) ||
            spring.moderate.settleMs,
          easing: style.getPropertyValue('--spring-moderate-ease').trim() || undefined,
        };
        const animate = (node: HTMLElement, frames: Keyframe[], exit = false) => {
          const animation = node.animate(
            frames,
            exit
              ? {
                  ...timing,
                  duration:
                    Number.parseFloat(style.getPropertyValue('--spring-moderate-exit')) ||
                    spring.moderate.exit.duration,
                }
              : timing,
          );
          animations.set(animation, node);
          const finish = () => {
            if (animations.delete(animation)) restore(node);
          };
          animation.onfinish = finish;
          animation.oncancel = finish;
        };
        outgoing.hidden = false;
        outgoing.setAttribute('data-home-sidebar-exiting', '');
        animate(
          outgoing,
          [
            painted.get(outgoing) ?? { transform: 'translateX(0)', opacity: 1 },
            { transform: `translateX(${-direction * 16}px)`, opacity: 0 },
          ],
          true,
        );
        animate(incoming, [
          painted.get(incoming) ?? { transform: `translateX(${direction * 16}px)`, opacity: 0 },
          { transform: 'translateX(0)', opacity: 1 },
        ]);
        const indicator = root.querySelector<HTMLElement>('.home-sidebar [data-tabs-indicator]');
        if (indicator)
          animate(indicator, [
            { opacity: painted.get(indicator)?.opacity ?? 1 },
            { opacity: 0.6 },
            { opacity: 1 },
          ]);
        const main = root.querySelector<HTMLElement>('[data-home-destination="assistant"]');
        if (next === 'assistant' && main)
          animate(main, [
            painted.get(main) ?? { transform: `translate(${direction * 12}px, 0)`, opacity: 0 },
            { transform: 'translate(0, 0)', opacity: 1 },
          ]);
        else if (previous === 'assistant' && main) {
          main.hidden = false;
          main.setAttribute('data-home-panel-exiting', '');
          animate(
            main,
            [
              painted.get(main) ?? { transform: 'translate(0, 0)', opacity: 1 },
              { transform: `translate(${-direction * 12}px, 0)`, opacity: 0 },
            ],
            true,
          );
        }
      });
    },
    destroy() {
      generation++;
      stopMotionListener();
      cancel();
    },
  };
};
