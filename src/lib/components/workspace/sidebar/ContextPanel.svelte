<script lang="ts">
  /**
   * ContextPanel - Enhanced sidebar panel for context items
   *
   * Displays notes with their linked context items (Linear issues, GitHub issues, etc.)
   * nested underneath. Includes the AddContextSection for adding new items.
   * Also displays user-defined MCP servers with per-workspace toggles.
   */
  import type { ContextItem, ContextProvider } from '$features/context/types';
  import { getDispatch } from '$lib/store/utils/svelte-context';
  import {
    initContextForWorkspace,
    addContextItem,
    removeContextItem,
  } from '$lib/store/slices/context/context-slice';
  import { selectTopLevelContextItems } from '$lib/store/slices/context/context-selectors';
  import { v4 as uuidv4 } from 'uuid';
  import { getPanelLayoutManager } from '$features/layout/panel-layout-adapter';
  import { selectActiveTab } from '$lib/store/slices/panel-layout/panel-layout-selectors';
  import { handleLink } from '$features/navigation/link-handler';
  import { writable } from 'svelte/store';
  import type { IssueSelectionData } from '$lib/components/workspace/initializer/IssueSuggestions.svelte';
  import { createLogger } from '$lib/utils/client-logger';
  import type { Note } from '$shared/types';
  import AddContextSection from './AddContextSection.svelte';
  import ContextItemRow from './ContextItemRow.svelte';
  import McpServersSection from './McpServersSection.svelte';
  import SkillsSection from './SkillsSection.svelte';
  import NotesPanel from './NotesPanel.svelte';
  import { ContextPickerModal } from './context-picker';

  const logger = createLogger('ContextPanel');

  interface Props {
    notes: Note[];
    workspaceId: string;
    selectedNoteId?: string | null;
    onOpenNote?: (noteId: string) => void;
    onOpenAgent?: (agentId: string) => void;
    onReorderNotes?: (noteIds: string[]) => void;
    onCreateNote?: () => void;
    loading?: boolean;
    showAddSection?: boolean;
    class?: string;
  }

  let {
    notes = [],
    workspaceId,
    selectedNoteId = null,
    onOpenNote,
    onOpenAgent,
    onReorderNotes,
    onCreateNote,
    loading = false,
    showAddSection = true,
    class: className,
  }: Props = $props();

  // Picker modal state (legacy - for ContextPickerModal)
  let pickerOpen = $state(false);
  let pickerProvider = $state<ContextProvider>('linear');

  const dispatch = getDispatch();

  // Initialize context store for this workspace
  let lastInitWorkspaceId: string | undefined;
  $effect(() => {
    if (workspaceId && workspaceId !== lastInitWorkspaceId) {
      lastInitWorkspaceId = workspaceId;
      dispatch(initContextForWorkspace(workspaceId));
    }
  });

  // Get context items that aren't linked to any note
  const topLevelItems$ = selectTopLevelContextItems(workspaceId);
  const standaloneContextItems = $derived($topLevelItems$);

  /**
   * Helper to create a fully-formed ContextItem with id + timestamps,
   * then dispatch it to the store. Returns the new item (with id).
   */
  function dispatchAddItem(
    itemData: Omit<ContextItem, 'id' | 'createdAt' | 'updatedAt'>,
  ): ContextItem {
    const now = new Date().toISOString();
    const newItem: ContextItem = {
      ...itemData,
      id: uuidv4(),
      createdAt: now,
      updatedAt: now,
    } as ContextItem;
    dispatch(addContextItem(workspaceId, newItem));
    return newItem;
  }

  // Reactive writable store that mirrors workspaceId for Redux selectors
  const workspaceIdStore = writable(workspaceId);
  $effect(() => {
    workspaceIdStore.set(workspaceId);
  });

  // Use reactive selector subscription for focused tab to track which context item is open
  const activeTab$ = selectActiveTab(workspaceIdStore);
  const focusedContextItemId = $derived($activeTab$?.contextItemId ?? null);

  // Check if a context item is currently active (open in the focused panel)
  // Uses context item ID for unique matching instead of URL
  function isItemActive(item: ContextItem): boolean {
    if (!focusedContextItemId) return false;
    return focusedContextItemId === item.id;
  }

  // Handle opening URLs in external browser (explicit "Open in Browser" action)
  function handleExternalOpen(item: ContextItem) {
    if (item.url) {
      handleLink(item.url, { workspaceId: workspaceId as import('$shared/types/branded-ids').WorkspaceId, forceExternal: true });
    }
  }

  // Handle clicking a context item
  function handleContextItemClick(item: ContextItem) {
    if (item.type === 'note' && 'noteId' in item) {
      onOpenNote?.(item.noteId);
    } else if (item.type === 'browser-url' && item.url) {
      // Open browser URLs in a panel, pass context item ID so URL updates sync back
      const layoutManager = getPanelLayoutManager(workspaceId);
      layoutManager.openBrowserPanel(item.url, item.id);
    } else if (item.url) {
      // Open other context items (Linear, GitHub, Sentry) in embedded browser panel
      handleLink(item.url, { workspaceId: workspaceId as import('$shared/types/branded-ids').WorkspaceId });
    }
  }

  // Handle item selection from picker
  function handlePickerSelect(item: {
    type: string;
    title: string;
    url: string;
    identifier: string;
    metadata?: Record<string, unknown>;
  }) {
    logger.info('Context item selected', { item });

    // Add to context store based on type - use type assertion to satisfy discriminated union
    if (item.type === 'linear-issue') {
      dispatchAddItem({
        type: 'linear-issue',
        provider: 'linear',
        title: item.title,
        url: item.url,
        identifier: item.identifier,
        teamKey: (item.metadata?.teamKey as string) || undefined,
        teamName: (item.metadata?.teamName as string) || undefined,
      } as Omit<
        import('$features/context/types').LinearIssueContextItem,
        'id' | 'createdAt' | 'updatedAt'
      >);
    } else if (item.type === 'sentry-issue') {
      dispatchAddItem({
        type: 'sentry-issue',
        provider: 'sentry',
        title: item.title,
        url: item.url,
        shortId: item.identifier,
        project: (item.metadata?.project as string) || undefined,
      } as Omit<
        import('$features/context/types').SentryIssueContextItem,
        'id' | 'createdAt' | 'updatedAt'
      >);
    } else if (item.type === 'browser-url') {
      dispatchAddItem({
        type: 'browser-url',
        provider: 'browser',
        title: item.title,
        url: item.url,
      } as Omit<
        import('$features/context/types').BrowserUrlContextItem,
        'id' | 'createdAt' | 'updatedAt'
      >);
    }
  }

  // Handle integration picker selection (from IssueSuggestions)
  function handleIntegrationSelect(_text: string, metadata?: IssueSelectionData) {
    if (!metadata) return;

    logger.info('Integration item selected', { metadata });

    if (metadata.type === 'linear') {
      dispatchAddItem({
        type: 'linear-issue',
        provider: 'linear',
        title: metadata.title,
        url: metadata.url || '',
        identifier: metadata.identifier,
        teamKey: metadata.teamKey,
      } as Omit<
        import('$features/context/types').LinearIssueContextItem,
        'id' | 'createdAt' | 'updatedAt'
      >);
    } else if (metadata.type === 'github') {
      // Parse identifier format: "owner/repo#number"
      const match = metadata.identifier.match(/^(.+?)#(\d+)$/);
      const repo = match?.[1] || metadata.identifier;
      const number = match ? parseInt(match[2], 10) : 0;

      dispatchAddItem({
        type: 'github-issue',
        provider: 'github',
        title: metadata.title,
        url: metadata.url || '',
        repo,
        number,
      } as Omit<
        import('$features/context/types').GitHubIssueContextItem,
        'id' | 'createdAt' | 'updatedAt'
      >);
    } else if (metadata.type === 'sentry') {
      dispatchAddItem({
        type: 'sentry-issue',
        provider: 'sentry',
        title: metadata.title,
        url: metadata.url || '',
        shortId: metadata.identifier,
        project: metadata.projectName,
      } as Omit<
        import('$features/context/types').SentryIssueContextItem,
        'id' | 'createdAt' | 'updatedAt'
      >);
    } else if (metadata.type === 'browser') {
      dispatchAddItem({
        type: 'browser-url',
        provider: 'browser',
        title: metadata.title,
        url: metadata.url || metadata.identifier,
      } as Omit<
        import('$features/context/types').BrowserUrlContextItem,
        'id' | 'createdAt' | 'updatedAt'
      >);
    }
  }

  // Reference to the add context button for positioning the picker
  let addContextAnchor: HTMLDivElement | undefined = $state();
</script>

<!-- Context Picker Modal (legacy) -->
<ContextPickerModal
  provider={pickerProvider}
  {workspaceId}
  isOpen={pickerOpen}
  onClose={() => (pickerOpen = false)}
  onSelect={handlePickerSelect}
/>

<div class="flex flex-col h-full px-2 {className ?? ''}">
  <!-- Add Context Section -->
  {#if showAddSection}
    <div bind:this={addContextAnchor} class="mb-1.5">
      <AddContextSection
        onAddNote={onCreateNote}
        onSelectIntegration={handleIntegrationSelect}
        onOpenBrowser={() => {
          const defaultUrl = 'about:blank';
          // Add to context store and get the new item ID
          const contextItem = dispatchAddItem({
            type: 'browser-url',
            provider: 'browser',
            title: 'Browser',
            url: defaultUrl,
          } as Omit<
            import('$features/context/types').BrowserUrlContextItem,
            'id' | 'createdAt' | 'updatedAt'
          >);
          // Open browser panel with context item ID for URL sync
          const layoutManager = getPanelLayoutManager(workspaceId);
          layoutManager.openBrowserPanel(defaultUrl, contextItem.id);
        }}
      />
    </div>
  {/if}

  <!-- Notes Panel with context items integrated -->
  <div class="flex-1 min-h-0 overflow-auto">
    <NotesPanel
      {notes}
      {workspaceId}
      {selectedNoteId}
      {onOpenNote}
      {onOpenAgent}
      {onReorderNotes}
      onCreateNote={undefined}
      {loading}
    />

    <!-- Standalone context items (rendered in same list flow) -->
    {#if standaloneContextItems.length > 0}
      {#each standaloneContextItems as item (item.id)}
        <ContextItemRow
          {item}
          isActive={isItemActive(item)}
          onClick={handleContextItemClick}
          onExternalOpen={handleExternalOpen}
          onDelete={(item) => dispatch(removeContextItem(workspaceId, item.id))}
        />
      {/each}
    {/if}

    <!-- MCP Servers Section -->
    <McpServersSection {workspaceId} />

    <!-- Skills Section -->
    <SkillsSection {workspaceId} />
  </div>
</div>
