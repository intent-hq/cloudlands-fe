<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    open?: boolean;
    align?: string;
    trigger?: Snippet<[{ toggle: () => void }]>;
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
</script>

<div class="dropdown-menu" data-open={open}>
  {#if trigger}
    {@render trigger({ toggle })}
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
