<script lang="ts">
  import type { Snippet } from 'svelte';
  import * as Menu from './menu';
  import { m } from '$shared/paraglide/messages.js';

  let {
    open = $bindable(false),
    align = 'start',
    side = 'bottom',
    portal = true,
    collisionPadding = 8,
    trigger,
    content,
    contentClass = '',
    contentMaxHeight,
    class: className = '',
  }: {
    open?: boolean;
    align?: 'start' | 'center' | 'end';
    side?: 'top' | 'bottom' | 'left' | 'right';
    portal?: boolean;
    collisionPadding?: number;
    trigger?: Snippet<[{ toggle: () => void; open: boolean; props: Record<string, unknown> }]>;
    content?: Snippet<[{ close: () => void }]>;
    contentClass?: string;
    contentMaxHeight?: string;
    class?: string;
  } = $props();

  function toggle() {
    const openBeforeClick = open;
    queueMicrotask(() => {
      if (open === openBeforeClick) open = !openBeforeClick;
    });
  }

  function close() {
    open = false;
  }
</script>

<div class="relative inline-block {className}">
  <Menu.Root bind:open>
    <Menu.Trigger>
      {#snippet child({ props })}
        {@render trigger?.({ toggle, open, props })}
      {/snippet}
    </Menu.Trigger>
    <Menu.Content
      {align}
      {side}
      {portal}
      {collisionPadding}
      class={contentClass}
      maxHeight={contentMaxHeight}
      aria-label={m.ui_dropdownMenu_ariaLabel()}
    >
      {@render content?.({ close })}
    </Menu.Content>
  </Menu.Root>
</div>
