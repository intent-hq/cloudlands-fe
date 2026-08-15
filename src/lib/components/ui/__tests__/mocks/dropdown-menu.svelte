<script lang="ts">
  import { onMount } from 'svelte';
  import type { Snippet } from 'svelte';

  interface Props {
    open?: boolean;
    align?: string;
    trigger?: Snippet<[{ toggle: () => void; props: Record<string, unknown> }]>;
    content?: Snippet<[{ close: () => void }]>;
    children?: Snippet;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let { open = $bindable(false), align = 'end', trigger, content, children }: Props = $props();

  function toggle() {
    open = !open;
  }

  function close() {
    open = false;
  }

  // Mock props that would come from bits-ui MenuPrimitive.Trigger
  const mockProps = {
    'aria-expanded': open,
    'aria-haspopup': 'menu' as const,
    'data-state': open ? 'open' : 'closed',
  };

  // Handle Escape key to close dropdown (like bits-ui does)
  onMount(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && open) {
        close();
        event.preventDefault();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });
</script>

<div class="dropdown-menu" data-open={open}>
  {#if trigger}
    {@render trigger({ toggle, props: mockProps })}
  {/if}

  {#if open && content}
    <div class="dropdown-content">
      {@render content({ close })}
    </div>
  {/if}

  {#if children}
    {@render children()}
  {/if}
</div>
