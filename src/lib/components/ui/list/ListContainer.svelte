<script lang="ts">
  import { cn } from '$lib/utils';
  import { createProximityHover, type ProximityHover } from '$lib/interaction';
  import type { HTMLAttributes } from 'svelte/elements';
  import { setListProximityContext } from './list-context';

  interface Props extends HTMLAttributes<HTMLDivElement> {
    class?: string;
    spacing?: 'compact' | 'normal' | 'relaxed';
    interactive?: boolean;
    children?: any;
  }

  let {
    class: className,
    spacing = 'normal',
    interactive = false,
    children,
    ...restProps
  }: Props = $props();

  let container: HTMLDivElement | null = $state(null);
  let hover: ProximityHover | null = $state.raw(null);
  let nextIndex = 0;

  setListProximityContext({
    get interactive() {
      return interactive;
    },
    get hover() {
      return hover;
    },
    claimIndex() {
      return nextIndex++;
    },
  });

  $effect(() => {
    if (!container || !interactive) {
      hover = null;
      return;
    }
    const instance = createProximityHover(container);
    hover = instance;
    return () => {
      instance.destroy();
      if (hover === instance) hover = null;
    };
  });

  const spacingClasses = {
    compact: 'gap-px p-px',
    normal: 'gap-px p-1',
    relaxed: 'gap-px p-1.5',
  };
</script>

<div
  bind:this={container}
  data-slot="list-container"
  data-interactive={interactive || undefined}
  class={cn(
    'flex min-w-0 flex-col overflow-hidden text-foreground',
    spacingClasses[spacing],
    className,
  )}
  {...restProps}
>
  {@render children?.()}
</div>
