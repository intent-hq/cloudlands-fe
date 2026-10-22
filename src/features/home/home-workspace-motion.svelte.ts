import { onDestroy, onMount, tick, untrack } from 'svelte';
import { spring } from '$lib/motion';
import { onReducedMotionChange, prefersReducedMotion } from '$lib/utils/reduced-motion';

/** Capture before keyed lists update so identity survives moves between separate groups. */
export function homeWorkspaceMotion(
  root: () => HTMLElement | undefined,
  revision: () => unknown,
  scope: () => string,
): void {
  const animations = new Set<Animation>();
  const exiting = new Set<HTMLElement>();
  let generation = 0;
  let previousScope: string | undefined;
  const cancel = () => {
    for (const animation of animations) animation.cancel();
    animations.clear();
    for (const node of exiting) node.remove();
    exiting.clear();
  };
  onMount(() =>
    onReducedMotionChange((reduced) => {
      if (reduced) cancel();
    }),
  );
  onDestroy(() => {
    generation++;
    cancel();
  });
  $effect.pre(() => {
    revision();
    const nextScope = scope();
    const host = root();
    untrack(() => {
      const run = ++generation;
      const sameScope = nextScope === previousScope;
      previousScope = nextScope;
      if (!host) return;
      const nodes = () => Array.from(host.querySelectorAll<HTMLElement>('[data-home-workspace]'));
      // Read all painted positions before cancelling interrupted motion.
      const before = new Map(
        nodes().map((node) => [
          node.dataset.homeWorkspace,
          {
            rect: node.getBoundingClientRect(),
            radius: getComputedStyle(node).borderRadius,
            clone: node.cloneNode(true) as HTMLElement,
          },
        ]),
      );
      cancel();
      if (!sameScope || prefersReducedMotion(host.ownerDocument)) return;
      void tick().then(() => {
        if (run !== generation || !host.isConnected || prefersReducedMotion(host.ownerDocument))
          return;
        const changes = nodes().map((node) => ({
          node,
          from: before.get(node.dataset.homeWorkspace),
          to: node.getBoundingClientRect(),
        }));
        const present = new Set(changes.map(({ node }) => node.dataset.homeWorkspace));
        for (const [id, { rect, clone }] of before) {
          if (present.has(id) || !rect.height || !rect.width) continue;
          clone.removeAttribute('data-home-workspace');
          clone.removeAttribute('id');
          clone.querySelectorAll('[id]').forEach((child) => child.removeAttribute('id'));
          clone.inert = true;
          clone.setAttribute('aria-hidden', 'true');
          Object.assign(clone.style, {
            position: 'fixed',
            left: `${rect.left}px`,
            top: `${rect.top}px`,
            width: `${rect.width}px`,
            height: `${rect.height}px`,
            margin: '0',
            pointerEvents: 'none',
            transform: 'none',
            zIndex: '1',
          });
          host.ownerDocument.body.append(clone);
          exiting.add(clone);
          const animation = clone.animate([{ opacity: 1 }, { opacity: 0 }], {
            duration: spring.fast.settleMs,
          });
          animations.add(animation);
          const finish = () => {
            clone.remove();
            exiting.delete(clone);
            animations.delete(animation);
          };
          animation.onfinish = finish;
          animation.oncancel = finish;
        }
        for (const { node, from, to } of changes) {
          if (!from && to.height && to.width) {
            const animation = node.animate([{ opacity: 0 }, { opacity: 1 }], {
              duration: spring.fast.settleMs,
            });
            animations.add(animation);
            const finish = () => animations.delete(animation);
            animation.onfinish = finish;
            animation.oncancel = finish;
          }
          if (!from || !from.rect.height || !to.height || !to.width) continue;
          // Canvas nodes live under a zoom transform. Convert viewport deltas
          // into their local coordinate space so the same workspace starts at
          // its actual painted position when entering or leaving the Canvas.
          const parentScaleX = to.width / (node.offsetWidth || to.width);
          const parentScaleY = to.height / (node.offsetHeight || to.height);
          const x = (from.rect.left - to.left) / parentScaleX;
          const y = (from.rect.top - to.top) / parentScaleY;
          const scaleX = from.rect.width / to.width;
          const scaleY = from.rect.height / to.height;
          if (
            Math.abs(x) < 1 &&
            Math.abs(y) < 1 &&
            Math.abs(scaleX - 1) < 0.01 &&
            Math.abs(scaleY - 1) < 0.01
          )
            continue;
          const animation = node.animate(
            [
              {
                transformOrigin: 'top left',
                transform: `translate(${x}px, ${y}px) scale(${scaleX}, ${scaleY})`,
                borderRadius: from.radius,
              },
              {
                transformOrigin: 'top left',
                transform: 'translate(0, 0) scale(1, 1)',
                borderRadius: getComputedStyle(node).borderRadius,
              },
            ],
            { duration: spring.slow.settleMs, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
          );
          animations.add(animation);
          const finish = () => animations.delete(animation);
          animation.onfinish = finish;
          animation.oncancel = finish;
        }
      });
    });
  });
}
