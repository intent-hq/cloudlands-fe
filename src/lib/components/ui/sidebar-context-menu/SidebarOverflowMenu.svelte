<script lang="ts">
  import DropdownMenu from '$lib/components/ui/dropdown-menu.svelte';
  import KebabIcon from '$lib/components/icons/KebabIcon.svelte';
  import SidebarDropdownMenuItems from './SidebarDropdownMenuItems.svelte';
  import type { SidebarMenuEntry } from './types';

  let {
    items,
    ariaLabel,
    open = $bindable(false),
    orientation = 'vertical',
    class: className = '',
  }: {
    items: SidebarMenuEntry[];
    ariaLabel: string;
    open?: boolean;
    orientation?: 'horizontal' | 'vertical';
    class?: string;
  } = $props();
</script>

<DropdownMenu bind:open align="end">
  {#snippet trigger({ props })}
    <button
      {...props}
      type="button"
      class={className}
      aria-label={ariaLabel}
      onclick={(event) => {
        event.stopPropagation();
        (props.onclick as ((event: MouseEvent) => void) | undefined)?.(event);
      }}
      oncontextmenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      {#if orientation === 'horizontal'}
        <span aria-hidden="true">⋯</span>
      {:else}
        <KebabIcon class="size-3.5" />
      {/if}
    </button>
  {/snippet}
  {#snippet content()}
    <SidebarDropdownMenuItems {items} />
  {/snippet}
</DropdownMenu>
