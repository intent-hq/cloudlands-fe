<script lang="ts">
  /**
   * One owner group in the sidebar browser list (monorepo#2857): a
   * collapsible header (agent display name or "Unclaimed") over the group's
   * tabs. Hidden (user-closed) owned tabs render dimmed with a restore
   * affordance instead of the liveness dot.
   */
  import { faWindowRestore } from '@fortawesome/free-solid-svg-icons';
  import { formatNumber } from '$lib/i18n/format';
  import SidebarGroupHeader from './sidebar/SidebarGroupHeader.svelte';
  import Fa from 'svelte-fa';
  import { Button } from '$lib/components/ui/button';
  import { m } from '$shared/paraglide/messages.js';
  import type { SidebarBrowserGroup } from './sidebar-browser-groups';

  interface Props {
    group: SidebarBrowserGroup;
    onOpenTab: (tabId: string, panelId: string) => void;
    onRestoreTab: (tabId: string) => void;
  }

  let { group, onOpenTab, onRestoreTab }: Props = $props();

  // Expanded by default; collapse state is ephemeral UI state.
  let expanded = $state(true);

  const groupLabel = $derived(group.ownerName ?? m.browser_panel_unclaimedGroup_label());
</script>

<div class="flex min-w-0 flex-col" data-sidebar-browser-group={group.ownerAgentId ?? 'unclaimed'}>
  <SidebarGroupHeader
    title={groupLabel}
    meta={formatNumber(group.entries.length)}
    {expanded}
    onclick={() => (expanded = !expanded)}
  />
  {#if expanded}
    <div class="flex min-w-0 flex-col gap-0.5 pl-1">
      {#each group.entries as entry (entry.tab.id)}
        {#if entry.hidden}
          <!-- Whole-row clickable like the visible rows (monorepo#3169); the same
               plain-variant Button box as the visible row keeps identical
               dot/text x-offsets (fe#1554). The restore icon is a decorative
               hover hint — the row itself is the button. -->
          <Button
            variant="plain"
            class="group/hidden flex h-7 w-full cursor-pointer items-center justify-start gap-2 rounded-md px-2 py-0 text-left hover:bg-muted focus-visible:bg-muted"
            onclick={() => onRestoreTab(entry.tab.id)}
            tooltip={m.browser_panel_restoreTab_tooltip()}
            aria-label={m.browser_panel_restoreTab_ariaLabel({ title: entry.tab.title })}
            title={entry.tab.browserUrl || undefined}
            data-sidebar-browser-hidden-tab={entry.tab.id}
          >
            <span class="size-2 shrink-0 rounded-full bg-muted-foreground/20" aria-hidden="true"
            ></span>
            <span class="min-w-0 flex-1 opacity-60">
              <span
                class="block truncate text-sm font-medium text-muted-foreground"
                title={entry.tab.title}>{entry.tab.title}</span
              >
            </span>
            <span
              class="shrink-0 text-muted-foreground opacity-0 group-hover/hidden:opacity-100 group-focus-visible/hidden:opacity-100"
              aria-hidden="true"
            >
              <Fa icon={faWindowRestore} size="xs" />
            </span>
          </Button>
        {:else}
          <Button
            variant="plain"
            class="flex h-7 w-full cursor-pointer items-center justify-start gap-2 rounded-md px-2 py-0 text-left hover:bg-muted focus-visible:bg-muted"
            onclick={() => entry.panelId && onOpenTab(entry.tab.id, entry.panelId)}
            title={entry.tab.browserUrl || undefined}
            data-sidebar-browser-tab={entry.tab.id}
            data-active={entry.active || undefined}
          >
            <span
              class="size-2 shrink-0 rounded-full {entry.active
                ? 'bg-success'
                : 'bg-muted-foreground/40'}"
              aria-hidden="true"
            ></span>
            <span class="min-w-0 flex-1">
              <span
                class="block truncate text-sm font-medium text-foreground"
                title={entry.tab.title}>{entry.tab.title}</span
              >
            </span>
          </Button>
        {/if}
      {/each}
    </div>
  {/if}
</div>
