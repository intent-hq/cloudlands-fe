<script lang="ts">
  /**
   * PanelEmptyState - Empty state for panels without tabs
   *
   * Shows quick action buttons, keyboard shortcuts, and recently closed items.
   */

  import Fa from 'svelte-fa';
  import { getContext } from 'svelte';
  import { m } from '$shared/paraglide/messages.js';
  import { writable } from 'svelte/store';
  import {
    faArrowRotateLeft,
    faFile,
    faGlobe,
    faRobot,
    faTerminal,
  } from '@fortawesome/free-solid-svg-icons';
  import type { IconDefinition } from '@fortawesome/fontawesome-common-types';
  import type { PanelLayoutManager, PanelTab } from '$features/layout/panel-layout-adapter';
  import ResourceIconTile from '$lib/components/shared/ResourceIconTile.svelte';
  import {
    getResourceIconKind,
    RESOURCE_ICON_BY_KIND,
    type ResourceIconKind,
  } from '$lib/components/shared/resource-icon';

  import { openCheatSheet } from '$store/renderer/slices/shortcuts-cheatsheet/shortcuts-cheatsheet-slice';
  import { formatShortcut } from '$lib/utils/shortcuts';
  import { openPalette } from '$store/renderer/slices/palette/palette-slice';
  import { toggleSidebar } from '$store/renderer/slices/ui-layout/ui-layout-slice';
  import {
    selectRecentlyClosed,
    selectFocusedPanelId,
  } from '$store/renderer/slices/panel-layout/panel-layout-selectors';
  import { selectAllWorkspaceAgents } from '$store/renderer/slices/workspace-agents/workspace-agents-selectors';
  import { selectTerminalsForWorkspace } from '$store/renderer/slices/terminals/terminals-selectors';

  import { store as appStore } from '$store/renderer/store';
  import { selectEffectiveShortcut } from '$store/renderer/slices/user-preferences/user-preferences-selectors';

  interface Props {
    workspaceId: string;
    panelId: string;
    onCreateAgent?: (panelId?: string) => void;
    onCreateAgentWithSpecialist?: (specialistId: string | null, panelId?: string) => void;
    onCreateNote?: (panelId?: string) => void;
    onCreateTerminal?: (panelId?: string) => void;
    onOpenBrowser?: (panelId?: string) => void;
  }

  let {
    workspaceId: _workspaceId,
    panelId,
    onCreateAgent,
    onCreateAgentWithSpecialist,
    onCreateNote,
    onCreateTerminal,
    onOpenBrowser,
  }: Props = $props();

  // Get panel layout manager from context
  const getLayoutManager = getContext<() => PanelLayoutManager>('panelLayoutManager');
  const layoutManager = $derived(getLayoutManager?.());

  // Wrap workspaceId in a writable store so selectors react to prop changes
  // (initial value only; the $effect below keeps it in sync)
  // svelte-ignore state_referenced_locally
  const workspaceIdStore = writable(_workspaceId);
  $effect(() => {
    workspaceIdStore.set(_workspaceId);
  });

  // Get recently closed tabs via Redux selector (reactive)
  const recentlyClosed$ = selectRecentlyClosed(workspaceIdStore);
  const workspaceAgents$ = selectAllWorkspaceAgents(workspaceIdStore);
  const workspaceTerminals$ = selectTerminalsForWorkspace(workspaceIdStore);
  // Defensively drop agent/terminal recents whose entity is gone so deleted
  // agents and closed terminals don't linger in the empty-state list even if
  // the prune dispatch was somehow missed. Non-agent/terminal recents pass
  // through unchanged.
  const recentItems = $derived.by(() => {
    const closed = $recentlyClosed$ ?? [];
    if (closed.length === 0) return [];
    const validAgentIds = new Set<string>(($workspaceAgents$ ?? []).map((a) => String(a.id)));
    const validTerminalIds = new Set<string>(($workspaceTerminals$ ?? []).map((t) => t.id));
    const filtered = closed.filter((item) => {
      if (item.tab.type === 'agent') {
        return item.tab.agentId ? validAgentIds.has(item.tab.agentId) : true;
      }
      if (item.tab.type === 'terminal') {
        return item.tab.terminalId ? validTerminalIds.has(item.tab.terminalId) : true;
      }
      return true;
    });
    return filtered.slice(0, 5);
  });

  // Get icon for tab type
  function getTabIcon(type: PanelTab['type']) {
    switch (type) {
      case 'agent':
        return faRobot;
      case 'note':
        return RESOURCE_ICON_BY_KIND.note;
      case 'terminal':
        return faTerminal;
      case 'browser':
        return faGlobe;
      case 'file':
      case 'diff':
        return faFile;
      default:
        return faFile;
    }
  }

  // Format timestamp
  function formatTime(timestamp: number): string {
    const now = Date.now();
    const diff = now - timestamp;
    if (diff < 60000) return m.layout_panelEmptyState_justNow_label();
    if (diff < 3600000)
      return m.layout_panelEmptyState_minutesAgo_label({ minutes: Math.floor(diff / 60000) });
    if (diff < 86400000)
      return m.layout_panelEmptyState_hoursAgo_label({ hours: Math.floor(diff / 3600000) });
    return m.layout_panelEmptyState_daysAgo_label({ days: Math.floor(diff / 86400000) });
  }

  function handleReopenItem() {
    layoutManager?.reopenClosedTab();
  }

  function handleCreateAgent() {
    if (onCreateAgent) {
      onCreateAgent(panelId);
      return;
    }
    onCreateAgentWithSpecialist?.(null, panelId);
  }

  function handleCreatePanel() {
    const panelId = selectFocusedPanelId.select(appStore.state, _workspaceId);
    if (panelId) {
      layoutManager?.splitPanel(panelId, 'horizontal');
    }
  }

  type CreationAction = {
    id: string;
    label: string;
    icon: IconDefinition;
    resourceKind?: ResourceIconKind;
    action: () => void;
  };

  // Browser is capability-gated by PanelLayout, so its card only appears when
  // the host provides a working handler.
  const creationActions = $derived<CreationAction[]>([
    {
      id: 'agent',
      label: m.layout_panelEmptyState_agent_label(),
      icon: faRobot,
      action: handleCreateAgent,
    },
    {
      id: 'note',
      label: m.layout_panelEmptyState_note_label(),
      icon: RESOURCE_ICON_BY_KIND.note,
      resourceKind: 'note',
      action: () => onCreateNote?.(panelId),
    },
    {
      id: 'terminal',
      label: m.layout_panelEmptyState_terminal_label(),
      icon: faTerminal,
      action: () => onCreateTerminal?.(panelId),
    },
    ...(onOpenBrowser
      ? [
          {
            id: 'browser',
            label: m.layout_panelEmptyState_browser_label(),
            icon: faGlobe,
            action: () => onOpenBrowser?.(panelId),
          },
        ]
      : []),
  ]);
  const newTabShortcut$ = selectEffectiveShortcut('navigation.new-tab');
  const commandPaletteShortcut$ = selectEffectiveShortcut('global.command-palette-alt');
  const reopenTabShortcut$ = selectEffectiveShortcut('navigation.reopen-tab');
  const toggleSidebarShortcut$ = selectEffectiveShortcut('panel.toggle-sidebar');
  const keyboardShortcutsShortcut$ = selectEffectiveShortcut('global.keyboard-shortcuts');
  const utilityActions = $derived([
    {
      key: $newTabShortcut$,
      label: m.layout_panelEmptyState_newPanel_label(),
      action: handleCreatePanel,
    },
    {
      key: $commandPaletteShortcut$,
      label: m.layout_panelEmptyState_commandPalette_label(),
      action: () => appStore.dispatch(openPalette()),
    },
    {
      key: $reopenTabShortcut$,
      label: m.layout_panelEmptyState_reopenClosed_label(),
      action: handleReopenItem,
    },
    {
      key: $toggleSidebarShortcut$,
      label: m.layout_panelEmptyState_toggleSidebar_label(),
      action: () => appStore.dispatch(toggleSidebar()),
    },
    {
      key: $keyboardShortcutsShortcut$,
      label: m.layout_panelEmptyState_allShortcuts_label(),
      action: () => appStore.dispatch(openCheatSheet('global')),
    },
  ]);
</script>

<div
  class="empty-state flex h-full items-center justify-center overflow-y-auto bg-sidebar px-6 py-10 text-foreground"
  data-panel-empty-state
>
  <section
    class="empty-state-content w-full max-w-[36rem]"
    aria-label={m.layout_panelEmptyState_createInEmptyPanel_ariaLabel()}
  >
    <div class="creation-grid grid gap-1.5">
      {#each creationActions as action (action.id)}
        <button
          class="creation-card type-body flex min-h-16 cursor-pointer items-center gap-2.5 rounded-md border border-transparent bg-muted/30 px-3 py-2.5 text-left text-foreground transition-transform duration-150 focus-visible:outline-none motion-reduce:transition-none"
          onclick={action.action}
          title={m.layout_panelEmptyState_newItem_tooltip({ label: action.label })}
          aria-label={m.layout_panelEmptyState_newItem_tooltip({ label: action.label })}
        >
          {#if action.resourceKind}
            <ResourceIconTile kind={action.resourceKind} variant="emphasized" />
          {:else}
            <span
              class="flex size-6 shrink-0 items-center justify-center rounded-md bg-background/70 text-muted-foreground"
              data-panel-empty-leading-surface
            >
              <Fa icon={action.icon} class="size-4" />
            </span>
          {/if}
          <span class="min-w-0 truncate font-medium">
            {m.layout_panelEmptyState_newItem_tooltip({ label: action.label })}
          </span>
        </button>
      {/each}
    </div>

    {#if recentItems.length > 0}
      <div class="mt-4 pt-3">
        <div class="type-caption mb-1 flex items-center gap-1.5 px-1 text-muted-foreground">
          <Fa icon={faArrowRotateLeft} class="size-3" />
          <span>{m.layout_panelEmptyState_recentlyClosed_label()}</span>
        </div>
        {#each recentItems as item (item.tab.id + '-' + item.closedAt)}
          {@const resourceKind = getResourceIconKind(item.tab.type)}
          <button
            class="recent-item type-caption flex w-full cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-left text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none motion-reduce:transition-none"
            onclick={handleReopenItem}
            title={m.layout_panelEmptyState_reopen_tooltip({ title: item.tab.title })}
          >
            {#if resourceKind}
              <ResourceIconTile kind={resourceKind} />
            {:else}
              <Fa icon={getTabIcon(item.tab.type)} class="size-3 shrink-0 opacity-70" />
            {/if}
            <span class="flex-1 truncate">{item.tab.title}</span>
            <span class="shrink-0 opacity-70">{formatTime(item.closedAt)}</span>
          </button>
        {/each}
      </div>
    {/if}

    <div class="shortcut-grid mt-5 grid gap-x-5 gap-y-0.5 pt-3">
      {#each utilityActions as action (action.key)}
        <button
          class="shortcut-item type-caption flex cursor-pointer items-center justify-between gap-3 rounded-md px-1 py-1.5 text-left text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none motion-reduce:transition-none"
          onclick={action.action}
          title={action.label}
        >
          <span>{action.label}</span>
          <kbd class="shortcut-key shrink-0 text-muted-foreground">
            {formatShortcut(action.key)}
          </kbd>
        </button>
      {/each}
    </div>
  </section>
</div>

<style>
  .empty-state-content {
    container-type: inline-size;
  }

  .creation-grid,
  .shortcut-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  @container (min-width: 32rem) {
    .creation-grid {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }

    .shortcut-grid {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }

  .shortcut-key {
    font-size: 0.6875rem;
    font-weight: 500;
    line-height: 1rem;
  }

  .creation-card:active,
  .shortcut-item:active {
    transform: scale(0.98);
  }

  .recent-item:active {
    transform: scale(0.99);
  }
</style>
