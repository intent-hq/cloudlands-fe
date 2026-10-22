<script lang="ts">
  import Fa from 'svelte-fa';
  import * as Tabs from '$lib/components/ui/tabs';
  import Tooltip from '$lib/components/ui/tooltip/Tooltip.svelte';
  import { writable } from 'svelte/store';
  import { store } from '$store/renderer/store';
  import { selectMultiSelectSidebarSelectedTabIds } from '$store/renderer/slices/sidebar-nav/sidebar-nav-selectors';
  import { setMultiSelectSidebarSelectedTabs } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
  import { selectIsWorkspaceCollaborator } from '$store/renderer/slices/workspace/workspace-selectors';
  import { selectWorkspacePeopleTilePeople } from '$store/renderer/slices/presence/presence-selectors';
  import { selectWorkspaceHasUnreadForegroundAgents } from '$store/renderer/slices/workspace-agents/workspace-agents-selectors';
  import {
    TAB_DEFINITIONS,
    OWNER_ONLY_TAB_IDS,
    normalizeSelectedTabs,
  } from '../multi-select-sidebar-tabs';
  import { m } from '$shared/paraglide/messages.js';

  let {
    workspaceId,
    orientation = 'horizontal',
    onActivate,
    panelId,
  }: {
    workspaceId: string;
    orientation?: 'horizontal' | 'vertical';
    onActivate?: (tabId: string) => void;
    panelId?: string;
  } = $props();

  const workspaceId$ = writable('');
  $effect.pre(() => workspaceId$.set(workspaceId));
  const selected$ = selectMultiSelectSidebarSelectedTabIds(workspaceId$);
  const collaborator$ = selectIsWorkspaceCollaborator(workspaceId$);
  const people$ = selectWorkspacePeopleTilePeople(workspaceId$);
  const unread$ = selectWorkspaceHasUnreadForegroundAgents(workspaceId$);
  const tabs = $derived(
    TAB_DEFINITIONS.filter(
      ({ id }) =>
        (id !== 'people' || $people$.length > 0) && !($collaborator$ && OWNER_ONLY_TAB_IDS.has(id)),
    ),
  );
  const selected = $derived(
    [...normalizeSelectedTabs($selected$, $collaborator$, $people$.length > 0)][0],
  );

  function activate(tabId: string) {
    store.dispatch(setMultiSelectSidebarSelectedTabs(workspaceId, [tabId]));
    onActivate?.(tabId);
  }
</script>

<Tabs.Root
  value={selected}
  onValueChange={activate}
  {orientation}
  class="w-full"
  data-sidebar-section-tabs={orientation}
>
  <Tabs.List
    aria-label={m.workspace_layout_ariaLabel()}
    class={orientation === 'vertical'
      ? 'flex! w-full flex-col gap-1! bg-transparent! p-0!'
      : 'flex! w-full gap-0.5! bg-transparent! p-0.5!'}
  >
    {#each tabs as tab (tab.id)}
      {@const unread = tab.id === 'agents' && $unread$}
      <Tooltip
        content={tab.label}
        side={orientation === 'vertical' ? 'right' : 'bottom'}
        delayDuration={400}
        class={orientation === 'vertical' ? 'flex size-9' : 'flex min-w-0 flex-1'}
      >
        <Tabs.Trigger
          value={tab.id}
          aria-label={unread
            ? m.workspace_multiSelectSidebar_agentsTabUnread_ariaLabel({ label: tab.label })
            : tab.label}
          aria-controls={panelId ? `${panelId}-${tab.id}` : undefined}
          class="relative h-9! w-full min-w-0! gap-0! rounded-md! px-0! text-sm!"
          data-sidebar-section-tab={tab.id}
          onclick={() => {
            if (selected === tab.id) onActivate?.(tab.id);
          }}
        >
          <Fa icon={tab.icon} class="size-4" />
          {#if unread}
            <span
              class="sidebar-tab-unread absolute top-1.5 right-1.5 size-1.5 rounded-full"
              aria-hidden="true"
              data-sidebar-tab-unread-dot
            ></span>
          {/if}
        </Tabs.Trigger>
      </Tooltip>
    {/each}
  </Tabs.List>
</Tabs.Root>

<style>
  .sidebar-tab-unread {
    background-color: hsl(var(--workspace-status-unread));
  }

  @media (forced-colors: active) {
    .sidebar-tab-unread {
      background-color: CanvasText;
    }
  }
</style>
