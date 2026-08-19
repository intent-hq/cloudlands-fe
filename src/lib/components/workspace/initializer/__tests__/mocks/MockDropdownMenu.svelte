<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    open = $bindable(false),
    trigger,
    content,
  }: {
    open?: boolean;
    trigger?: Snippet<[{ toggle: () => void; open: boolean; props: Record<string, unknown> }]>;
    content?: Snippet<[{ close: () => void }]>;
  } = $props();

  function toggle() {
    const openBeforeClick = open;
    queueMicrotask(() => {
      if (open === openBeforeClick) open = !openBeforeClick;
    });
  }

  // Mock props that would come from bits-ui MenuPrimitive.Trigger
  const mockProps = $derived({
    'aria-expanded': open,
    'aria-haspopup': 'menu' as const,
    'data-state': open ? 'open' : 'closed',
    onclick: toggle,
  });
</script>

{#if trigger}
  {@render trigger({ toggle, open, props: mockProps })}
{/if}
{#if open && content}
  {@render content({ close: () => (open = false) })}
{/if}
