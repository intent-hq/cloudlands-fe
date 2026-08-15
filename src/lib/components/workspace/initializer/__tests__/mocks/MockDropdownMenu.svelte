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
  const mockProps = {
    'aria-expanded': open,
    'aria-haspopup': 'menu' as const,
    'data-state': open ? 'open' : 'closed',
  };
</script>

{#if trigger}
  <div
    role="button"
    tabindex="0"
    onclick={() => (open = !open)}
    onkeydown={(event) => {
      if (event.key === 'Enter' || event.key === ' ') open = !open;
    }}
  >
    {@render trigger({ toggle, open, props: mockProps })}
  </div>
{/if}
{#if open && content}
  {@render content({ close: () => (open = false) })}
{/if}
