<script lang="ts">
  import Fa from 'svelte-fa';
  import * as Tabs from '$lib/components/ui/tabs';
  import { Tooltip } from '$lib/components/ui/tooltip';
  import { cn } from '$lib/utils';
  import AgentAvatarWithState from '$features/agent/components/agent-avatar/AgentAvatarWithState.svelte';
  import { getAvatarStateForSession } from '$features/agent/components/agent-avatar/avatar-state';
  import { writable } from 'svelte/store';
  import { prefersReducedMotion } from '$lib/utils/reduced-motion';
  import { scrollFade } from '$lib/actions/scroll-fade';
  import { store } from '$store/renderer/store';
  import {
    selectHiddenSidebarTabIds,
    selectMultiSelectSidebarSelectedTabIds,
  } from '$store/renderer/slices/sidebar-nav/sidebar-nav-selectors';
  import {
    activateSidebarSectionRequested,
    setMultiSelectSidebarSelectedTabs,
    setSidebarTabHidden,
  } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
  import SidebarContextMenu from '$lib/components/ui/sidebar-context-menu/SidebarContextMenu.svelte';
  import {
    getSidebarContextPosition,
    type SidebarContextPosition,
    type SidebarMenuEntry,
  } from '$lib/components/ui/sidebar-context-menu/types';
  import { navigateToSettings } from '$lib/utils/workspace-navigation';
  import {
    selectIsPlainFolderWorkspace,
    selectIsWorkspaceCollaborator,
    selectWorkspaceSavedScriptContext,
  } from '$store/renderer/slices/workspace/workspace-selectors';
  import { selectWorkspacePeopleTilePeople } from '$store/renderer/slices/presence/presence-selectors';
  import { selectWorkspacePeopleInvites } from '$store/renderer/slices/workspace-share/workspace-share-selectors';
  import {
    resolveExistingWorkspaceDefaultAgent,
    selectAllWorkspaceAgents,
    selectWorkspaceHasUnreadForegroundAgents,
  } from '$store/renderer/slices/workspace-agents/workspace-agents-selectors';
  import {
    TAB_DEFINITIONS,
    GIT_ONLY_TAB_IDS,
    HIDEABLE_TAB_IDS,
    OWNER_ONLY_TAB_IDS,
    normalizeSelectedTabs,
    orderSelectedTabs,
    toggleSelectedTab,
    type TabId,
  } from '../multi-select-sidebar-tabs';
  import { selectWorkspaceHasBrowserTabs } from '$store/renderer/slices/panel-layout/panel-layout-selectors';
  import { selectTerminalsForWorkspace } from '$store/renderer/slices/terminals/terminals-selectors';
  import { selectWorkspaceScriptEntries } from '$store/renderer/slices/scripts/scripts-selectors';
  import { isLiveScriptStatus } from '$features/scripts/utils/script-status';
  import { m } from '$shared/paraglide/messages.js';
  import { getSidebarFlyout } from './sidebar-flyout-context';

  let {
    workspaceId,
    orientation = 'horizontal',
    onActivate,
    panelId,
    panelLayoutId = workspaceId,
  }: {
    workspaceId: string;
    orientation?: 'horizontal' | 'vertical';
    onActivate?: (tabId: string) => void;
    panelId?: string;
    panelLayoutId?: string;
  } = $props();
  type SectionTab = (typeof TAB_DEFINITIONS)[number];
  let tabViewport = $state<HTMLDivElement | null>(null);
  let pointerSelection = false;
  let extendSelection = false;
  const flyout = getSidebarFlyout();

  const workspaceId$ = writable('');
  $effect.pre(() => workspaceId$.set(workspaceId));
  const selected$ = selectMultiSelectSidebarSelectedTabIds(workspaceId$);
  const collaborator$ = selectIsWorkspaceCollaborator(workspaceId$);
  const scriptContext$ = selectWorkspaceSavedScriptContext(workspaceId$);
  const plainFolder$ = selectIsPlainFolderWorkspace(workspaceId$);
  const people$ = selectWorkspacePeopleTilePeople(workspaceId$);
  const invites$ = selectWorkspacePeopleInvites(workspaceId$);
  const showPeople = $derived($people$.length > 0 || $invites$.length > 0);
  const unread$ = selectWorkspaceHasUnreadForegroundAgents(workspaceId$);
  const agents$ = selectAllWorkspaceAgents(workspaceId$);
  const mainAgent = $derived(resolveExistingWorkspaceDefaultAgent($agents$, workspaceId));
  const hasBrowserTabs$ = selectWorkspaceHasBrowserTabs(workspaceId$);
  const terminals$ = selectTerminalsForWorkspace(workspaceId$);
  const scripts$ = selectWorkspaceScriptEntries(workspaceId$);
  const shellInUse = $derived(
    (!$collaborator$ && $terminals$.length > 0) ||
      $scripts$.some((script) => isLiveScriptStatus(script.runtime.status)),
  );
  const hidden$ = selectHiddenSidebarTabIds();
  let menu = $state<(SidebarContextPosition & { tabId: TabId }) | null>(null);
  const availableTabs = $derived(
    TAB_DEFINITIONS.filter(
      ({ id }) =>
        (id !== 'people' || showPeople) &&
        !($plainFolder$ && GIT_ONLY_TAB_IDS.has(id)) &&
        !($collaborator$ && OWNER_ONLY_TAB_IDS.has(id) && !(id === 'shell' && $scriptContext$)),
    ),
  );
  const savedSelection = $derived(
    orderSelectedTabs(
      normalizeSelectedTabs(
        $selected$,
        $collaborator$,
        showPeople,
        !!$scriptContext$,
        $plainFolder$,
      ),
    ),
  );
  // A hidden section keeps its icon while it is open (a link can open it), so it can be closed.
  const tabs = $derived(
    availableTabs.filter(
      ({ id }) => !$hidden$.includes(id) || savedSelection.includes(id as TabId),
    ),
  );

  function openMenu(tabId: TabId, event: MouseEvent | KeyboardEvent): boolean {
    const position = getSidebarContextPosition(event);
    if (!position) return false;
    menu = { ...position, tabId };
    return true;
  }

  function hideTab(tabId: TabId) {
    if (savedSelection.includes(tabId)) {
      const rest = savedSelection.filter((id) => id !== tabId);
      store.dispatch(
        setMultiSelectSidebarSelectedTabs(workspaceId, rest.length > 0 ? rest : ['agents']),
      );
    }
    store.dispatch(setSidebarTabHidden(tabId, true));
  }

  function menuItems(tabId: TabId): SidebarMenuEntry[] {
    const settings: SidebarMenuEntry = {
      id: 'sidebar-settings',
      label: m.workspace_multiSelectSidebar_sidebarSettings_label(),
      onClick: () => void navigateToSettings({ tab: 'display', hash: 'sidebar-icons' }),
    };
    if (!HIDEABLE_TAB_IDS.has(tabId)) return [settings];
    return [
      {
        id: 'hide-tab',
        label: m.workspace_multiSelectSidebar_hideTab_label(),
        onClick: () => hideTab(tabId),
      },
      { type: 'separator' },
      settings,
    ];
  }
  // The collapsed rail previews one pane; the saved group shows again once the preview closes.
  const selectedIds = $derived(
    orientation === 'vertical' && flyout?.open && tabs.some((tab) => tab.id === flyout?.tabId)
      ? [flyout.tabId as TabId]
      : savedSelection,
  );
  const selected = $derived(selectedIds[0] ?? 'agents');

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

  function selectSections(tabIds: readonly string[]) {
    store.dispatch(setMultiSelectSidebarSelectedTabs(workspaceId, [...tabIds]));
  }

  function activate(tabId: string, toggle = false) {
    const id = tabId as TabId;
    if (toggle) {
      // Shift adds or removes a pane; it never opens main content or empties the sidebar.
      selectSections(toggleSelectedTab(savedSelection, id));
      return;
    }
    if (orientation === 'vertical') {
      // A rail preview keeps the saved group when the pane already belongs to it.
      if (!savedSelection.includes(id)) selectSections([id]);
    } else {
      const alreadySelected = savedSelection.length === 1 && savedSelection[0] === id;
      selectSections([id]);
      if (!alreadySelected) return;
    }
    store.dispatch(activateSidebarSectionRequested(workspaceId, tabId, panelLayoutId));
    onActivate?.(tabId);
  }
</script>

<Tabs.Root
  value={selected}
  selectedValues={selectedIds}
  activationMode="manual"
  {orientation}
  variant={orientation === 'horizontal' ? 'icon' : 'underline'}
  size="default"
  class="w-full"
  data-sidebar-section-tabs={orientation}
>
  {#snippet children()}
    {#snippet trigger(tab: SectionTab)}
      {@const unread = tab.id === 'agents' && $unread$}
      {@const inUse =
        (tab.id === 'browser' && $hasBrowserTabs$) || (tab.id === 'shell' && shellInUse)}
      <Tabs.Trigger
        value={tab.id}
        aria-label={unread
          ? m.workspace_multiSelectSidebar_agentsTabUnread_ariaLabel({ label: tab.label })
          : inUse
            ? m.workspace_multiSelectSidebar_tabInUse_ariaLabel({ label: tab.label })
            : tab.label}
        aria-controls={panelId ? `${panelId}-${tab.id}` : undefined}
        class={cn(
          'relative min-w-0 gap-0 px-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
          orientation === 'horizontal'
            ? cn(
                'w-full',
                selectedIds.includes(tab.id) ? 'text-foreground' : 'text-muted-foreground',
              )
            : cn(
                'size-9 rounded-(--radius-medium) border-0',
                selectedIds.includes(tab.id) && 'bg-selected dark:bg-surface-4',
              ),
        )}
        data-sidebar-section-tab={tab.id}
        onpointerdown={() => {
          pointerSelection = true;
        }}
        onpointercancel={() => {
          pointerSelection = false;
        }}
        onpointerup={() => {
          pointerSelection = false;
        }}
        onpointerleave={() => {
          pointerSelection = false;
        }}
        onpointerenter={(event) => {
          if (orientation === 'vertical' && event.pointerType !== 'touch')
            flyout?.preview(tab.id, event.currentTarget);
        }}
        onfocus={(event) => {
          if (orientation === 'vertical') flyout?.preview(tab.id, event.currentTarget, true);
          else if (
            !pointerSelection &&
            !extendSelection &&
            savedSelection.length === 1 &&
            savedSelection[0] !== tab.id &&
            event.currentTarget.matches(':focus-visible')
          )
            // Arrow focus follows a single pane; a multi-pane group changes only on activation.
            selectSections([tab.id]);
        }}
        oncontextmenu={(event) => openMenu(tab.id, event)}
        onkeydown={(event) => {
          if (openMenu(tab.id, event)) return;
          extendSelection = event.shiftKey;
          queueMicrotask(() => {
            extendSelection = false;
          });
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          if (orientation === 'vertical') flyout?.preview(tab.id, event.currentTarget);
          activate(tab.id, event.shiftKey);
        }}
        onclick={(event) => {
          pointerSelection = false;
          if (orientation === 'vertical') flyout?.preview(tab.id, event.currentTarget);
          activate(tab.id, event.shiftKey);
        }}
      >
        {#if tab.id === 'agents' && mainAgent}
          <span
            class="pointer-events-none inline-flex"
            aria-hidden="true"
            data-sidebar-main-agent={mainAgent.id}
          >
            <AgentAvatarWithState
              agentId={mainAgent.id}
              specialist={mainAgent.metadata?.specialist ?? mainAgent.agentMetadata?.specialist}
              variant={orientation === 'horizontal' ? 'standard' : 'compact'}
              state={getAvatarStateForSession(mainAgent, { hasUnread: false })}
            />
          </span>
        {:else}
          <Fa icon={tab.icon} class={orientation === 'horizontal' ? 'size-4' : 'size-3.5'} />
        {/if}
        {#if unread}
          <span
            class="sidebar-tab-unread absolute top-1.5 right-1.5 size-1.5 rounded-full"
            aria-hidden="true"
            data-sidebar-tab-unread-dot
          ></span>
        {:else if inUse}
          <span
            class="sidebar-tab-in-use absolute top-1.5 right-1.5 size-1.5 rounded-full bg-muted-foreground"
            aria-hidden="true"
            data-sidebar-tab-in-use-dot
          ></span>
        {/if}
      </Tabs.Trigger>
    {/snippet}
    {#if orientation === 'vertical'}
      <Tabs.List
        aria-label={m.workspace_layout_ariaLabel()}
        aria-multiselectable={selectedIds.length > 1 || undefined}
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
        use:scrollFade={{ axis: 'x', enabled: !flyout?.collapsed }}
        class="scrollbar-none min-w-0 overflow-x-auto overscroll-x-contain rounded-(--radius-large)"
        data-sidebar-tab-scroll
      >
        <Tabs.List
          aria-label={m.workspace_layout_ariaLabel()}
          aria-multiselectable={selectedIds.length > 1 || undefined}
          class="w-max min-w-full max-w-none justify-start gap-1 overflow-visible bg-selected dark:bg-surface-4"
        >
          {#each tabs as tab (tab.id)}
            <Tooltip
              content={tab.label}
              delayDuration={400}
              class="flex h-10 min-w-10 max-w-16 flex-1"
            >
              {@render trigger(tab)}
            </Tooltip>
          {/each}
        </Tabs.List>
      </div>
    {/if}
  {/snippet}
</Tabs.Root>

{#if menu}
  <SidebarContextMenu
    x={menu.x}
    y={menu.y}
    returnFocus={menu.returnFocus}
    items={menuItems(menu.tabId)}
    onClickOutside={() => (menu = null)}
  />
{/if}

<style>
  .sidebar-tab-unread {
    background-color: hsl(var(--workspace-status-unread));
  }

  @media (forced-colors: active) {
    .sidebar-tab-unread,
    .sidebar-tab-in-use {
      background-color: CanvasText;
    }
  }
</style>
