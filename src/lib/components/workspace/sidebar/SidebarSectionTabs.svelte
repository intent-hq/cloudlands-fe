<script lang="ts">
  import Fa from 'svelte-fa';
  import * as Tabs from '$lib/components/ui/tabs';
  import { Tooltip } from '$lib/components/ui/tooltip';
  import { writable } from 'svelte/store';
  import { prefersReducedMotion } from '$lib/utils/reduced-motion';
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
  import { getSidebarFlyout } from './sidebar-flyout-context';

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
  type SectionTab = (typeof TAB_DEFINITIONS)[number];
  let tabViewport = $state<HTMLDivElement | null>(null);
  const flyout = getSidebarFlyout();

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
  const savedSelection = $derived(
    [...normalizeSelectedTabs($selected$, $collaborator$, $people$.length > 0)][0],
  );
  const selected = $derived(
    orientation === 'vertical' && flyout?.open && tabs.some((tab) => tab.id === flyout?.tabId)
      ? (flyout.tabId ?? savedSelection)
      : savedSelection,
  );

  $effect(() => {
    const viewport = tabViewport;
    const activeId = selected;
    if (orientation !== 'horizontal' || !viewport) return;
    let frame = 0;
    const reveal = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const tab = viewport.querySelector<HTMLElement>(`[data-sidebar-section-tab="${activeId}"]`);
        if (!tab || !viewport.clientWidth) return;
        const item = tab.getBoundingClientRect();
        const bounds = viewport.getBoundingClientRect();
        const offset =
          item.left < bounds.left + 4
            ? item.left - bounds.left - 4
            : item.right > bounds.right - 4
              ? item.right - bounds.right + 4
              : 0;
        if (offset)
          viewport.scrollBy({
            left: offset,
            behavior: prefersReducedMotion() ? 'instant' : 'smooth',
          });
      });
    };
    reveal();
    const observer = new ResizeObserver(reveal);
    observer.observe(viewport);
    const list = viewport.querySelector('[role="tablist"]');
    if (list) observer.observe(list);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  });

  function activate(tabId: string) {
    store.dispatch(setMultiSelectSidebarSelectedTabs(workspaceId, [tabId]));
    onActivate?.(tabId);
  }
</script>

<Tabs.Root
  value={selected}
  onValueChange={activate}
  {orientation}
  variant={orientation === 'horizontal' ? 'icon' : 'default'}
  size="default"
  class="w-full"
  data-sidebar-section-tabs={orientation}
>
  {#snippet children()}
    {#snippet trigger(tab: SectionTab)}
      {@const unread = tab.id === 'agents' && $unread$}
      <Tabs.Trigger
        value={tab.id}
        aria-label={unread
          ? m.workspace_multiSelectSidebar_agentsTabUnread_ariaLabel({ label: tab.label })
          : tab.label}
        aria-controls={panelId ? `${panelId}-${tab.id}` : undefined}
        class="relative w-full min-w-0 gap-0 px-0"
        data-sidebar-section-tab={tab.id}
        onpointerenter={(event) => {
          if (orientation === 'vertical' && event.pointerType !== 'touch')
            flyout?.preview(tab.id, event.currentTarget);
        }}
        onfocus={(event) => {
          if (orientation === 'vertical') flyout?.preview(tab.id, event.currentTarget, true);
        }}
        onkeyup={(event) => {
          if (orientation === 'vertical' && (event.key === 'Enter' || event.key === ' ')) {
            flyout?.preview(tab.id, event.currentTarget);
            activate(tab.id);
          }
        }}
        onclick={(event) => {
          if (orientation === 'vertical') flyout?.preview(tab.id, event.currentTarget);
          if (selected === tab.id) activate(tab.id);
        }}
      >
        <Fa icon={tab.icon} class={orientation === 'horizontal' ? 'size-4.5' : 'size-4'} />
        {#if unread}
          <span
            class="sidebar-tab-unread absolute top-1.5 right-1.5 size-1.5 rounded-full"
            aria-hidden="true"
            data-sidebar-tab-unread-dot
          ></span>
        {/if}
      </Tabs.Trigger>
    {/snippet}
    {#if orientation === 'vertical'}
      <Tabs.List
        aria-label={m.workspace_layout_ariaLabel()}
        class="flex! w-full flex-col gap-1 bg-transparent p-0"
      >
        {#each tabs as tab (tab.id)}
          <Tooltip
            content={tab.label}
            side="right"
            disabled={!!flyout}
            delayDuration={400}
            class="flex size-9"
          >
            {@render trigger(tab)}
          </Tooltip>
        {/each}
      </Tabs.List>
    {:else}
      <div
        bind:this={tabViewport}
        class="scrollbar-none min-w-0 overflow-x-auto overscroll-x-contain rounded-(--radius-large)"
        data-sidebar-tab-scroll
      >
        <Tabs.List
          aria-label={m.workspace_layout_ariaLabel()}
          class="w-max min-w-full max-w-none justify-between overflow-visible"
        >
          {#each tabs as tab (tab.id)}
            <Tooltip content={tab.label} delayDuration={400} class="flex size-10 shrink-0">
              {@render trigger(tab)}
            </Tooltip>
          {/each}
        </Tabs.List>
      </div>
    {/if}
  {/snippet}
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
