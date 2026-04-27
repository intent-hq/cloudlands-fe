<script lang="ts">
  /**
   * PanelEmptyState - Empty state for panels without tabs
   *
   * Shows quick action buttons, keyboard shortcuts, and recently closed items.
   */

  import { getContext } from 'svelte';
  import { writable } from 'svelte/store';
  import type { PanelLayoutManager, PanelTab } from '$features/layout/panel-layout-adapter';
  import Fa from 'svelte-fa';
  import { faPlus, faTerminal, faGlobe, faFile, faRobot } from '@fortawesome/free-solid-svg-icons';
  import { faNote } from '$lib/icons/faNote';
  import { dispatch, getReduxStore } from '$lib/store/redux-dispatch-bridge';
  import { openCheatSheet } from '$lib/store/slices/shortcuts-cheatsheet/shortcuts-cheatsheet-slice';
  import { SHORTCUTS, formatShortcut } from '$lib/utils/shortcuts';
  import { openPalette } from '$lib/store/slices/palette/palette-slice';
  import { selectRecentlyClosed } from '$lib/store/slices/panel-layout/panel-layout-selectors';
  import { selectFocusedPanelId } from '$lib/store/slices/panel-layout/panel-layout-selectors';
  import CreateAgentSection from '$lib/components/workspace/CreateAgentSection.svelte';

  interface Props {
    workspaceId: string;
    onCreateAgent?: () => void;
    onCreateAgentWithSpecialist?: (specialistId: string | null) => void;
    onCreateNote?: () => void;
    onCreateTerminal?: () => void;
    onOpenBrowser?: () => void;
  }

  let {
    workspaceId: _workspaceId,
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
  const workspaceIdStore = writable(_workspaceId);
  $effect(() => {
    workspaceIdStore.set(_workspaceId);
  });

  // Get recently closed tabs via Redux selector (reactive)
  const recentlyClosed$ = selectRecentlyClosed(workspaceIdStore);
  const recentItems = $derived($recentlyClosed$?.slice(0, 5) ?? []);

  // Get icon for tab type
  function getTabIcon(type: PanelTab['type']) {
    switch (type) {
      case 'agent':
        return faRobot;
      case 'note':
        return faNote;
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
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
  }

  function handleReopenItem() {
    layoutManager?.reopenClosedTab();
  }

  // Quick action buttons (agent handled separately when specialist picker is available)
  const nonAgentQuickActions = [
    { id: 'note', label: 'Note', icon: faNote, action: () => onCreateNote?.() },
    { id: 'terminal', label: 'Terminal', icon: faTerminal, action: () => onCreateTerminal?.() },
    { id: 'browser', label: 'Browser', icon: faGlobe, action: () => onOpenBrowser?.() },
  ];
  const agentQuickAction = { id: 'agent', label: 'Agent', icon: faRobot, action: () => onCreateAgent?.() };

  // Keyboard shortcuts to display with their actions
  const keyboardShortcuts = [
    {
      key: SHORTCUTS.REOPEN_TAB.key,
      label: SHORTCUTS.REOPEN_TAB.label,
      action: () => layoutManager?.reopenClosedTab(),
    },
    {
      key: SHORTCUTS.COMMAND_PALETTE.key,
      label: SHORTCUTS.COMMAND_PALETTE.label,
      action: () => dispatch(openPalette()),
    },
    {
      key: 'mod+shift+]',
      label: 'Cycle through panels',
    },
    {
      key: SHORTCUTS.NEW_AGENT.key,
      label: SHORTCUTS.NEW_AGENT.label,
      action: () => onCreateAgent?.(),
    },
    {
      key: SHORTCUTS.SPLIT_PANEL_HORIZONTAL.key,
      label: SHORTCUTS.SPLIT_PANEL_HORIZONTAL.label,
      action: () => {
        const panelId = selectFocusedPanelId.select(getReduxStore().getState(), _workspaceId);
        if (panelId) {
          layoutManager?.splitPanel(panelId, 'horizontal');
        }
      },
    },
    {
      key: 'mod+?',
      label: 'Keyboard Shortcuts',
      action: () => dispatch(openCheatSheet('global')),
    },
  ];
</script>

<div
  class="empty-state flex flex-col items-center justify-center h-full px-6 -mt-3 overflow-y-auto"
>
  <div class="w-full max-w-[27rem] space-y-6">
    <!-- Quick action buttons row -->
    <div class="flex items-center justify-center gap-1 flex-wrap">
      <!-- Agent action: use specialist picker when available -->
      {#if onCreateAgentWithSpecialist}
        <CreateAgentSection
          onCreate={onCreateAgent}
          onCreateWithSpecialist={onCreateAgentWithSpecialist}
          compact
        />
      {:else}
        <button
          class="quick-action flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors cursor-pointer"
          onclick={agentQuickAction.action}
          title="New Agent"
        >
          <Fa icon={faPlus} class="w-2.5 h-2.5 opacity-50" />
          <Fa icon={faRobot} class="w-3 h-3" />
          <span class="font-medium">Agent</span>
        </button>
      {/if}
      {#each nonAgentQuickActions as action (action.id)}
        <button
          class="quick-action flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors cursor-pointer"
          onclick={action.action}
          title="New {action.label}"
        >
          <Fa icon={faPlus} class="w-2.5 h-2.5 opacity-50" />
          <Fa icon={action.icon} class="w-3 h-3" />
          <span class="font-medium">{action.label}</span>
        </button>
      {/each}
    </div>

    <!-- Recently closed items -->
    {#if recentItems.length > 0}
      <div class="space-y-0.5">
        {#each recentItems as item (item.tab.id + '-' + item.closedAt)}
          <button
            class="recent-item w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-xs text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors cursor-pointer"
            onclick={handleReopenItem}
            title="Reopen {item.tab.title}"
          >
            <Fa icon={getTabIcon(item.tab.type)} class="w-3 h-3 flex-shrink-0 opacity-60" />
            <span class="truncate flex-1">{item.tab.title}</span>
            <span class="text-ui text-subtle flex-shrink-0"
              >{formatTime(item.closedAt)}</span
            >
          </button>
        {/each}
      </div>
    {/if}

    <!-- Keyboard shortcuts grid -->
    <div class="grid grid-cols-2 gap-x-6 gap-y-1">
      {#each keyboardShortcuts as shortcut (shortcut.key)}
        <button
          class="shortcut-item flex items-center justify-between gap-2 px-2 py-1 text-xs rounded {shortcut.action
            ? 'hover:bg-muted/40 transition-colors cursor-pointer'
            : ''}"
          onclick={shortcut.action}
          title={shortcut.label}
        >
          <span class="text-subtle truncate">{shortcut.label}</span>
          <div
            class="shortcut-key flex-shrink-0 px-1.5 py-0.5 rounded bg-muted/50 text-ui text-subtle"
          >
            {formatShortcut(shortcut.key)}
          </div>
        </button>
      {/each}
    </div>
  </div>
</div>

<style>
  .empty-state {
    opacity: 0.85;
  }

  .quick-action:active {
    transform: scale(0.98);
  }

  .recent-item:active {
    transform: scale(0.99);
  }

  .shortcut-item:active {
    transform: scale(0.99);
  }
</style>
