<script lang="ts">
  import Fa from 'svelte-fa';
  import { faCheck } from '@fortawesome/free-solid-svg-icons';
  import * as Menu from '$lib/components/ui/menu';
  import {
    isSeparator,
    type SidebarMenuEntry,
  } from '$lib/components/ui/sidebar-context-menu/types';

  let { items }: { items: SidebarMenuEntry[] } = $props();
</script>

{#snippet renderItems(entries: SidebarMenuEntry[])}
  {#each entries as entry, index (`${isSeparator(entry) ? 'separator' : entry.id}-${index}`)}
    {#if isSeparator(entry)}
      <Menu.Separator />
    {:else if entry.submenu?.length}
      <Menu.Sub>
        <Menu.SubTrigger disabled={entry.disabled}>
          {#if entry.icon}
            <Fa icon={entry.icon} class="w-3.5 shrink-0 text-muted-foreground opacity-70" />
          {/if}
          <span class="min-w-0 flex-1 truncate">{entry.label}</span>
          {#if entry.checked}
            <Fa icon={faCheck} class="w-3.5 shrink-0 text-muted-foreground opacity-70" />
          {/if}
        </Menu.SubTrigger>
        <Menu.SubContent>
          {@render renderItems(entry.submenu)}
        </Menu.SubContent>
      </Menu.Sub>
    {:else}
      <Menu.Item
        disabled={entry.disabled}
        destructive={entry.destructive}
        onclick={() => entry.onClick()}
      >
        {#if entry.icon}
          <Fa icon={entry.icon} class="w-3.5 shrink-0 text-muted-foreground opacity-70" />
        {/if}
        <span class="min-w-0 flex-1 truncate">{entry.label}</span>
        {#if entry.checked}
          <Fa icon={faCheck} class="w-3.5 shrink-0 text-muted-foreground opacity-70" />
        {/if}
      </Menu.Item>
    {/if}
  {/each}
{/snippet}

{@render renderItems(items)}
