<script lang="ts">
  import { fade, Spring, type SpringTierName } from '$lib/motion';
  import { cn } from '$lib/utils.js';
  import type { Action } from 'svelte/action';

  type Rect = { top: number; left: number; width: number; height: number };

  interface SpringRectOptions {
    rect: Rect;
    identity: string | number;
    tier: SpringTierName;
    initialRect?: Rect;
  }

  let {
    rect,
    identity,
    tier,
    initialRect,
    kind,
    class: className,
  }: SpringRectOptions & {
    kind: 'active' | 'hover' | 'focus';
    class?: string;
  } = $props();

  const springRect: Action<HTMLElement, SpringRectOptions> = (node, options) => {
    const initial = options.initialRect ?? options.rect;
    const top = new Spring(initial.top, options.tier);
    const left = new Spring(initial.left, options.tier);
    const width = new Spring(initial.width, options.tier);
    const height = new Spring(initial.height, options.tier);
    let currentIdentity = options.identity;
    const disposeEffect = $effect.root(() => {
      $effect(() => {
        node.style.transform = `translate3d(${left.current}px, ${top.current}px, 0)`;
        node.style.width = `${width.current}px`;
        node.style.height = `${height.current}px`;
      });
    });

    const setRect = (next: SpringRectOptions, instant: boolean) => {
      void top.set(next.rect.top, { instant });
      void left.set(next.rect.left, { instant });
      void width.set(next.rect.width, { instant });
      void height.set(next.rect.height, { instant });
    };
    setRect(options, false);

    return {
      update(next) {
        const sameRow = currentIdentity === next.identity;
        currentIdentity = next.identity;
        setRect(next, sameRow);
      },
      destroy() {
        disposeEffect();
      },
    };
  };
</script>

<div
  aria-hidden="true"
  data-sidebar={`menu-${kind}-highlight`}
  class={cn('pointer-events-none absolute left-0 top-0 rounded-md', className)}
  use:springRect={{ rect, identity, tier, initialRect }}
  in:fade={{ tier }}
  out:fade={{ tier }}
></div>
