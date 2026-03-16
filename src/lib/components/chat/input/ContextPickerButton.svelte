<script lang="ts">
  /**
   * ContextPickerButton
   *
   * An @ icon button that opens a popover showing available panels (files, notes, etc.)
   * that can be included as context in the chat message. Includes search functionality
   * to find files, notes, folders and other primitives.
   */

  import { onMount, tick } from 'svelte';
  import Fa from 'svelte-fa';
  import {
    faAt,
    faFileLines,
    faCodeBranch,
    faClipboard,
    faGlobe,
    faFolder,
    faSearch,
    faSpinner,
    faRobot,
    faQuoteLeft,
    faTerminal,
  } from '@fortawesome/free-solid-svg-icons';
  import { faNote } from '$lib/icons/faNote';
  import { cn } from '$lib/utils';
  import Button from '$lib/components/ui/button/button.svelte';
  import Portal from '$lib/components/ui/Portal.svelte';
  import Checkbox from '$lib/components/ui/checkbox/checkbox.svelte';
  import { TooltipShortcut } from '$lib/components/ui/tooltip';
  import {
    addSearchedItem,
    type PanelContextItem,
    type SelectionContextItem,
  } from '$lib/store/slices/multi-panel-context/multi-panel-context-slice';
  import { getDispatch } from '$lib/store/utils/utils';
  import {
    getMentionSystem,
    type MentionCandidate,
    type SearchContext,
  } from '$lib/services/mentions';
  import type { Workspace } from '$shared/types';
  import Input from '$lib/components/ui/input/input.svelte';

  interface Props {
    panels: PanelContextItem[];
    selections?: SelectionContextItem[];
    disabled?: boolean;
    workspace?: Workspace | null;
    /** The current agent's ID - its panel will be shown but disabled */
    currentAgentId?: string;
    onToggle?: (id: string) => void;
    onToggleSelection?: (id: string) => void;
    /** Callback to insert a mention chip into the editor (for types not in PanelContextItem) */
    onInsertMention?: (mention: { id: string; label: string; type: string; uri: string; meta?: Record<string, unknown> }) => void;
    class?: string;
  }

  let {
    panels = [],
    selections = [],
    disabled = false,
    workspace = null,
    currentAgentId,
    onToggle,
    onToggleSelection,
    onInsertMention,
    class: className = '',
  }: Props = $props();

  const contextDispatch = getDispatch();

  let isOpen = $state(false);
  let triggerRef = $state<HTMLButtonElement | null>(null);
  let popoverRef = $state<HTMLDivElement | null>(null);
  let searchInputRef = $state<{ focus: () => void } | null>(null);
  let popoverStyle = $state('');

  // Search state
  let searchQuery = $state('');
  let searchResults = $state<MentionCandidate[]>([]);
  let isSearching = $state(false);
  let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  // Count of checked panels and selections for badge
  let checkedPanelCount = $derived(panels.filter((p) => p.checked).length);
  let checkedSelectionCount = $derived(selections.filter((s) => s.checked).length);
  let checkedCount = $derived(checkedPanelCount + checkedSelectionCount);

  // Show search results when there's a query, otherwise show open panels
  let showSearchResults = $derived(searchQuery.trim().length > 0);

  // Group panels by panelId for display with headers
  interface PanelGroup {
    panelId: string;
    panelLabel: string;
    panels: PanelContextItem[];
    selections: SelectionContextItem[];
  }

  let groupedPanels = $derived.by((): PanelGroup[] => {
    const groups = new Map<string, PanelGroup>();

    // Group panels (active panels first)
    for (const panel of panels) {
      if (!groups.has(panel.panelId)) {
        groups.set(panel.panelId, {
          panelId: panel.panelId,
          panelLabel: panel.label, // Use the active panel's label as the group label
          panels: [],
          selections: [],
        });
      }
      groups.get(panel.panelId)!.panels.push(panel);
    }

    // Add selections to their respective groups
    for (const selection of selections) {
      if (!groups.has(selection.panelId)) {
        groups.set(selection.panelId, {
          panelId: selection.panelId,
          panelLabel: selection.sourceLabel,
          panels: [],
          selections: [],
        });
      }
      groups.get(selection.panelId)!.selections.push(selection);
    }

    // Convert to array and sort: groups with active panels first, then by label
    return Array.from(groups.values()).sort((a, b) => {
      const aHasActive = a.panels.some((p) => p.isActive);
      const bHasActive = b.panels.some((p) => p.isActive);
      if (aHasActive && !bHasActive) return -1;
      if (!aHasActive && bHasActive) return 1;
      return a.panelLabel.localeCompare(b.panelLabel);
    });
  });

  function handleToggleSelectionItem(id: string) {
    onToggleSelection?.(id);
  }

  function truncateText(text: string, maxLength: number = 50): string {
    const singleLine = text.replace(/\n/g, ' ').trim();
    if (singleLine.length <= maxLength) return singleLine;
    return singleLine.substring(0, maxLength) + '...';
  }

  function getIconForType(type: PanelContextItem['type'] | MentionCandidate['type']) {
    switch (type) {
      case 'file':
      case 'file-range':
        return faFileLines;
      case 'note':
      case 'note-range':
        return faNote;
      case 'diff':
        return faCodeBranch;
      case 'spec':
        return faClipboard;
      case 'browser':
        return faGlobe;
      case 'folder':
      case 'source-folder':
        return faFolder;
      case 'terminal':
        return faTerminal;
      case 'agent':
        return faRobot;
      default:
        return faFileLines;
    }
  }

  async function toggleOpen() {
    if (disabled) return;
    isOpen = !isOpen;
    if (isOpen) {
      updatePosition();
      // Focus search input after popover opens
      await tick();
      searchInputRef?.focus();
    } else {
      // Clear search when closing
      searchQuery = '';
      searchResults = [];
    }
  }

  function updatePosition() {
    if (!triggerRef) return;
    const rect = triggerRef.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const spaceBelow = viewportHeight - rect.top;
    const estimatedHeight = 350;

    // Position above the button
    if (spaceBelow < estimatedHeight) {
      popoverStyle = `position: fixed; bottom: ${viewportHeight - rect.top + 4}px; left: ${rect.left}px; min-width: 280px; max-width: 320px;`;
    } else {
      popoverStyle = `position: fixed; top: ${rect.bottom + 4}px; left: ${rect.left}px; min-width: 280px; max-width: 320px;`;
    }
  }

  function handleClickOutside(e: MouseEvent) {
    if (!isOpen) return;
    const target = e.target as Node;
    if (triggerRef?.contains(target) || popoverRef?.contains(target)) return;
    isOpen = false;
    searchQuery = '';
    searchResults = [];
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape' && isOpen) {
      e.preventDefault();
      isOpen = false;
      searchQuery = '';
      searchResults = [];
    }
  }

  function handleToggleItem(id: string) {
    onToggle?.(id);
  }

  function handleSelectSearchResult(result: MentionCandidate) {
    // For types that aren't panel context items (e.g. terminal, script), insert as a mention chip
    if (result.type === 'terminal' || result.type === 'script') {
      onInsertMention?.({
        id: result.id,
        label: result.label,
        type: result.type,
        uri: result.uri || `devspace://terminal/${encodeURIComponent(result.id)}`,
        meta: result.meta as Record<string, unknown> | undefined,
      });
      // Close popover after inserting mention
      isOpen = false;
      searchQuery = '';
      searchResults = [];
      return;
    }

    // Map the mention type to a PanelContextItem type
    let itemType: PanelContextItem['type'] = 'file';
    if (result.type === 'note' || result.type === 'note-range') {
      itemType = 'note';
    } else if (result.type === 'folder' || result.type === 'source-folder') {
      itemType = 'file'; // Treat folders as file context
    }

    // Add to the store as a checked context item
    contextDispatch(addSearchedItem({
      id: result.id,
      type: itemType,
      label: result.label,
      filePath: result.uri || undefined,
      noteId: result.type === 'note' || result.type === 'note-range' ? result.id : undefined,
    }));

    // Clear search but keep popover open so user can add more items
    searchQuery = '';
    searchResults = [];
  }

  async function performSearch(query: string) {
    if (!workspace || !query.trim()) {
      searchResults = [];
      return;
    }

    isSearching = true;
    try {
      const mentionSystem = getMentionSystem();
      const context: SearchContext = {
        workspaceId: workspace.id,
      };
      const results = await mentionSystem.search(query, context);
      searchResults = results;
    } catch (error) {
      console.error('Search failed:', error);
      searchResults = [];
    } finally {
      isSearching = false;
    }
  }

  function handleSearchInput(e: Event) {
    const target = e.target as HTMLInputElement;
    searchQuery = target.value;

    // Set loading state immediately when user types
    if (searchQuery.trim()) {
      isSearching = true;
    }

    // Debounce search
    if (searchDebounceTimer) {
      clearTimeout(searchDebounceTimer);
    }
    searchDebounceTimer = setTimeout(() => {
      performSearch(searchQuery);
    }, 250);
  }

  onMount(() => {
    document.addEventListener('mousedown', handleClickOutside, true);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside, true);
      if (searchDebounceTimer) {
        clearTimeout(searchDebounceTimer);
      }
    };
  });
</script>

<svelte:window onkeydown={handleKeyDown} />

<TooltipShortcut label="Context from open panels" shortcut={['@']} side="top">
  <Button
    bind:ref={triggerRef}
    variant="ghost-light"
    size="icon-xs"
    onclick={toggleOpen}
    {disabled}
    aria-label="Add Context"
    aria-haspopup="true"
    aria-expanded={isOpen}
    class={cn('shrink-0 relative', className)}
  >
    <Fa icon={faAt} size="sm" />
    {#if checkedCount > 0}
      <span
        class="absolute -top-1 -right-1 min-w-3.5 h-3.5 px-1 text-ui font-medium
               rounded-full bg-primary text-primary-foreground flex items-center justify-center"
      >
        {checkedCount}
      </span>
    {/if}
  </Button>
</TooltipShortcut>

{#if isOpen}
  <Portal zIndex={60}>
    <div
      bind:this={popoverRef}
      class={cn(
        'overflow-hidden rounded-lg border border-border',
        'bg-popover text-popover-foreground shadow-lg',
      )}
      style={popoverStyle}
      role="dialog"
      aria-label="Select context panels"
    >
      <!-- Header -->
      <div class="px-3 py-2">
        <div class="font-medium">Context</div>
        <div class="text-xs text-subtle">
          Select files and notes to include in your message
        </div>
      </div>

      <!-- Search input -->
      <div class="px-2">
        <div class="relative">
          <Fa
            icon={faSearch}
            class="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-subtle"
          />
          <Input
            bind:this={searchInputRef}
            type="text"
            placeholder="Add files or notes..."
            value={searchQuery}
            oninput={handleSearchInput}
            class="pl-7"
            noFocusStyle
          />
          {#if isSearching}
            <Fa
              icon={faSpinner}
              class="absolute right-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-subtle animate-spin"
            />
          {/if}
        </div>
      </div>

      <!-- Content area -->
      <div class="max-h-[280px] min-h-[120px] overflow-y-auto">
        {#if showSearchResults}
          <!-- Search results -->
          {#if isSearching}
            <!-- Skeleton loader while searching -->
            <div class="py-1">
              {#each Array(3) as _, i (i)}
                <div class="flex items-center gap-2.5 px-3 py-2">
                  <div class="h-3.5 w-3.5 rounded bg-muted animate-pulse"></div>
                  <div class="flex-1 space-y-1.5">
                    <div class="h-4 w-3/4 rounded bg-muted animate-pulse"></div>
                    <div class="h-3 w-1/2 rounded bg-muted animate-pulse"></div>
                  </div>
                </div>
              {/each}
            </div>
          {:else if searchResults.length === 0}
            <div class="px-3 py-4 text-center text-sm text-subtle">No results found</div>
          {:else}
            <div class="py-1">
              {#each searchResults as result (result.id)}
                <button
                  type="button"
                  onclick={() => handleSelectSearchResult(result)}
                  class="w-full flex items-center gap-2 px-3 py-2 text-sm
                         hover:bg-muted/40 cursor-pointer transition-colors text-left"
                >
                  <Fa
                    icon={getIconForType(result.type)}
                    class="h-3.5 w-3.5 text-subtle"
                  />
                  <div class="flex-1 min-w-0">
                    <div class="truncate font-medium">{result.label}</div>
                    {#if result.subtitle || result.description}
                      <div class="truncate text-xs text-subtle">
                        {result.subtitle || result.description}
                      </div>
                    {/if}
                  </div>
                </button>
              {/each}
            </div>
          {/if}
        {:else}
          <!-- Open panels and selections grouped by panel -->
          {#if groupedPanels.length > 0}
            <div class="py-1">
              {#each groupedPanels as group, groupIndex (group.panelId)}
                <!-- Border between groups -->
                {#if groupIndex > 0}
                  <div class="border-t border-border/50 my-1"></div>
                {/if}

                <!-- Panels in this group -->
                {#each group.panels as panel (panel.id)}
                  {@const isCurrentAgent =
                    panel.type === 'agent' && panel.agentId === currentAgentId}
                  <button
                    type="button"
                    onclick={() => !isCurrentAgent && handleToggleItem(panel.id)}
                    disabled={isCurrentAgent}
                    class={cn(
                      'w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors',
                      isCurrentAgent
                        ? 'opacity-50 cursor-not-allowed'
                        : 'hover:bg-muted/40 cursor-pointer',
                    )}
                  >
                    <Checkbox
                      checked={panel.checked}
                      size="sm"
                      disabled={isCurrentAgent}
                      onCheckedChange={() => !isCurrentAgent && handleToggleItem(panel.id)}
                      class="!mr-1"
                    />
                    <Fa
                      icon={getIconForType(panel.type)}
                      class="h-3.5 w-3.5 text-subtle"
                    />
                    <span class="flex-1 truncate text-left">{panel.label}</span>
                    {#if isCurrentAgent}
                      <span class="text-ui text-muted-foreground uppercase">You</span>
                    {:else if panel.isActive}
                      <span class="text-ui text-muted-foreground uppercase">Active</span>
                    {/if}
                  </button>
                {/each}

                <!-- Selections in this group -->
                {#each group.selections as selection (selection.id)}
                  <button
                    type="button"
                    onclick={() => handleToggleSelectionItem(selection.id)}
                    class="w-full flex items-center gap-2 px-3 py-2 text-sm
                           hover:bg-muted/40 cursor-pointer transition-colors"
                  >
                    <Checkbox
                      checked={selection.checked}
                      size="sm"
                      onCheckedChange={() => handleToggleSelectionItem(selection.id)}
                    />
                    <Fa icon={faQuoteLeft} class="h-3.5 w-3.5 text-ghost" />
                    <span class="flex-1 truncate text-left">{truncateText(selection.text)}</span>
                  </button>
                {/each}
              {/each}
            </div>
          {:else}
            <div class="px-3 py-4 text-center text-sm text-subtle">
              No other panels open. Search above to find files, notes, and more.
            </div>
          {/if}
        {/if}
      </div>
    </div>
  </Portal>
{/if}
