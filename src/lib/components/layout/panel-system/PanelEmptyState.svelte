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
  import { faFile, faGlobe, faRobot, faTerminal } from '@fortawesome/free-solid-svg-icons';
  import type { IconDefinition } from '@fortawesome/fontawesome-common-types';
  import type { PanelLayoutManager, PanelTab } from '$features/layout/panel-layout-adapter';
  import { getResourceIconKind, RESOURCE_ICON_BY_KIND } from '$lib/components/shared/resource-icon';

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
  import { effectiveShortcutReadable } from '$lib/utils/effective-shortcuts';

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
    const resourceKind = getResourceIconKind(type);
    if (resourceKind) return RESOURCE_ICON_BY_KIND[resourceKind];

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

  function handleReopenItem() {
    layoutManager?.reopenLastClosed();
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
    key: string;
    action: () => void;
  };

  const newAgentShortcut$ = effectiveShortcutReadable('workspace.new-agent');
  const newNoteShortcut$ = effectiveShortcutReadable('workspace.new-note');
  const newTerminalShortcut$ = effectiveShortcutReadable('workspace.new-terminal');
  const newBrowserShortcut$ = effectiveShortcutReadable('workspace.new-browser');

  // Browser is capability-gated by PanelLayout, so its card only appears when
  // the host provides a working handler.
  const creationActions = $derived<CreationAction[]>([
    {
      id: 'agent',
      label: m.layout_panelEmptyState_agent_label(),
      icon: faRobot,
      key: $newAgentShortcut$,
      action: handleCreateAgent,
    },
    {
      id: 'note',
      label: m.layout_panelEmptyState_note_label(),
      icon: RESOURCE_ICON_BY_KIND.note,
      key: $newNoteShortcut$,
      action: () => onCreateNote?.(panelId),
    },
    {
      id: 'terminal',
      label: m.layout_panelEmptyState_terminal_label(),
      icon: faTerminal,
      key: $newTerminalShortcut$,
      action: () => onCreateTerminal?.(panelId),
    },
    ...(onOpenBrowser
      ? [
          {
            id: 'browser',
            label: m.layout_panelEmptyState_browser_label(),
            icon: faGlobe,
            key: $newBrowserShortcut$,
            action: () => onOpenBrowser?.(panelId),
          },
        ]
      : []),
  ]);
  const newPanelShortcut$ = effectiveShortcutReadable('navigation.new-tab');
  const commandPaletteShortcut$ = effectiveShortcutReadable('global.command-palette-alt');
  const reopenTabShortcut$ = effectiveShortcutReadable('navigation.reopen-tab');
  const toggleSidebarShortcut$ = effectiveShortcutReadable('panel.toggle-sidebar');
  const keyboardShortcutsShortcut$ = effectiveShortcutReadable('global.keyboard-shortcuts');
  const utilityActions = $derived([
    {
      key: $newPanelShortcut$,
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
  class="empty-state flex h-full items-center justify-center overflow-y-auto bg-sidebar px-6 py-8 text-foreground"
  data-panel-empty-state
>
  <section
    class="empty-state-content type-caption min-w-0 w-full max-w-[20rem]"
    aria-label={m.layout_panelEmptyState_createInEmptyPanel_ariaLabel()}
  >
    <div class="creation-list flex flex-col gap-0.5">
      {#each creationActions as action (action.id)}
        <button
          class="creation-action empty-state-row grid min-h-7 min-w-0 w-full max-w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 px-2 py-1 text-left font-medium text-foreground transition-colors hover:text-muted-foreground focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-ring motion-reduce:transition-none"
          onclick={action.action}
          title={m.layout_panelEmptyState_newItem_tooltip({ label: action.label })}
          aria-label={m.layout_panelEmptyState_newItem_tooltip({ label: action.label })}
        >
          <span class="flex min-w-0 items-center gap-x-2">
            <span class="flex shrink-0 items-center" aria-hidden="true">
              <Fa icon={action.icon} class="size-[1em]" />
            </span>
            <span class="min-w-0 truncate font-medium">
              {m.layout_panelEmptyState_newItem_tooltip({ label: action.label })}
            </span>
          </span>
          <kbd
            class="shortcut-key shrink-0 justify-self-end whitespace-nowrap text-right text-muted-foreground"
          >
            {formatShortcut(action.key)}
          </kbd>
        </button>
      {/each}
    </div>

    {#if recentItems.length > 0}
      <div class="recent-list mt-5 flex flex-col gap-0.5">
        <button
          class="reopen-hint empty-state-row grid min-h-7 min-w-0 w-full max-w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 px-2 py-1 text-left font-normal text-muted-foreground transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-ring motion-reduce:transition-none"
          onclick={handleReopenItem}
          title={m.layout_panelEmptyState_reopenLastClosed_label()}
        >
          <span class="min-w-0 truncate">{m.layout_panelEmptyState_reopenLastClosed_label()}</span>
          <kbd
            class="shortcut-key shrink-0 justify-self-end whitespace-nowrap text-right text-muted-foreground"
          >
            {formatShortcut($reopenTabShortcut$)}
          </kbd>
        </button>
        {#each recentItems as item (item.tab.id + '-' + item.closedAt)}
          <button
            class="recent-item empty-state-row grid min-h-7 min-w-0 w-full max-w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center px-2 py-1 text-left font-normal text-muted-foreground transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-ring motion-reduce:transition-none"
            onclick={handleReopenItem}
            title={m.layout_panelEmptyState_reopen_tooltip({ title: item.tab.title })}
          >
            <span class="flex min-w-0 items-center gap-x-2">
              <span class="flex shrink-0 items-center opacity-70" aria-hidden="true">
                <Fa icon={getTabIcon(item.tab.type)} class="size-[1em]" />
              </span>
              <span class="min-w-0 truncate">{item.tab.title}</span>
            </span>
          </button>
        {/each}
      </div>
    {/if}

    <div class="shortcut-list mt-5 flex flex-col gap-0.5">
      {#each utilityActions as action (action.label)}
        <button
          class="shortcut-item empty-state-row grid min-h-7 min-w-0 w-full max-w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 px-2 py-1 text-left font-normal text-muted-foreground transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-ring motion-reduce:transition-none"
          onclick={action.action}
          title={action.label}
          aria-label={action.label}
        >
          <span class="min-w-0 truncate">{action.label}</span>
          <kbd
            class="shortcut-key shrink-0 justify-self-end whitespace-nowrap text-right text-muted-foreground"
          >
            {formatShortcut(action.key)}
          </kbd>
        </button>
      {/each}
    </div>
  </section>
</div>

<style>
  .creation-action {
    color: hsl(var(--foreground));
  }

  .creation-action:hover {
    color: hsl(var(--muted-foreground));
  }

  .shortcut-key {
    color: hsl(var(--muted-foreground));
    font-weight: 500;
  }

  .creation-action:active,
  .reopen-hint:active,
  .shortcut-item:active {
    transform: scale(0.98);
  }

  .recent-item:active {
    transform: scale(0.99);
  }
</style>
