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
    faRobot,
    faQuoteLeft,
    faTerminal,
  } from '@fortawesome/free-solid-svg-icons';
  import { faNote } from '$lib/icons/faNote';
  import { cn } from '$lib/utils';
  import { OPTION_LIST_ROW_CLASS } from '$lib/styles/option-list-row';
  import { pushEscapeLayer } from '$lib/utils/escapeLayers';
  import { Button } from '$lib/components/ui/button';
  import { menuItem } from '$lib/components/ui/menu';
  import { IntentMarkLoader } from '$lib/components/ui/indicators';
  import Portal from '$lib/components/ui/Portal.svelte';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import { m } from '$shared/paraglide/messages.js';
  import { TooltipShortcut } from '$lib/components/ui/tooltip';
  import {
    addSearchedItem,
    type PanelContextItem,
    type SelectionContextItem,
  } from '$store/renderer/slices/multi-panel-context/multi-panel-context-slice';

  import {
    getMentionSystem,
    type MentionCandidate,
    type SearchContext,
  } from '$lib/services/mentions';
  import type { Workspace } from '$shared/types';
  import { Input } from '$lib/components/ui/input';
  import { store as appStore } from '$store/renderer/store';

  interface Props {
    panels: PanelContextItem[];
    selections?: SelectionContextItem[];
    disabled?: boolean;
    workspace?: Workspace | null;
    /** The current agent's ID - its panel will be shown but disabled */
    currentAgentId?: string;
    onToggle?: (id: string) => void;
    onToggleSelection?: (id: string) => void;
    /**
     * Called after a mention chip (terminal/script) is inserted into the editor,
     * allowing an embedding menu to close. Toggling checkbox items or adding
     * searched files/notes keeps the picker open for multi-selection.
     */
    onPick?: () => void;
    /** Callback to insert a mention chip into the editor (for types not in PanelContextItem) */
    onInsertMention?: (mention: {
      id: string;
      label: string;
      type: string;
      uri: string;
      meta?: Record<string, unknown>;
    }) => void;
    renderTrigger?: boolean;
    /** Render only the picker body inside an owning rich popover/dialog. */
    embedded?: boolean;
    /** Allows the owning dialog to reference the picker's visible description. */
    descriptionId?: string;
    /** Mounted picker body, for an embedding popover's placement and dismissal. */
    bodyRef?: HTMLDivElement | null;
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
    onPick,
    onInsertMention,
    renderTrigger = true,
    embedded = false,
    descriptionId,
    bodyRef = $bindable(null),
    class: className = '',
  }: Props = $props();

  let isOpen = $state(false);
  let triggerRef = $state<HTMLButtonElement | null>(null);
  let externalAnchor = $state<HTMLElement | null>(null);
  let searchInputRef = $state<{ focus: () => void } | null>(null);
  let popoverStyle = $state('');

  // Search state
  let searchQuery = $state('');
  let searchResults = $state<MentionCandidate[]>([]);
  let isSearching = $state(false);
  let searchFailed = $state(false);
  let activeSearchIndex = $state(0);
  let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let searchGeneration = 0;
  const pickerId = $props.id();
  const searchListId = `${pickerId}-results`;

  // Show search results when there's a query, otherwise show open panels
  let showSearchResults = $derived(searchQuery.trim().length > 0);
  const activeResult = $derived(
    !isSearching && !searchFailed && showSearchResults
      ? searchResults[activeSearchIndex]
      : undefined,
  );
  function resultId(result: MentionCandidate) {
    return `${pickerId}-result-${encodeURIComponent(`${result.type}:${result.id}`)}`;
  }
  async function handleSearchKeyDown(event: KeyboardEvent) {
    if (!activeResult || !['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Enter') {
      handleSelectSearchResult(activeResult);
      return;
    }
    activeSearchIndex =
      (activeSearchIndex + (event.key === 'ArrowDown' ? 1 : -1) + searchResults.length) %
      searchResults.length;
    await tick();
    if (activeResult)
      document.getElementById(resultId(activeResult))?.scrollIntoView?.({ block: 'nearest' });
  }

  // Count of checked panels and selections for badge
  let checkedPanelCount = $derived(panels.filter((p) => p.checked).length);
  let checkedSelectionCount = $derived(selections.filter((s) => s.checked).length);
  let checkedCount = $derived(checkedPanelCount + checkedSelectionCount);

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

  export async function open(anchor?: HTMLElement) {
    if (disabled) return;
    externalAnchor = anchor ?? null;
    isOpen = true;
    updatePosition();
    await tick();
    if (isOpen) searchInputRef?.focus();
  }

  async function toggleOpen() {
    if (isOpen) {
      isOpen = false;
      externalAnchor = null;
      resetSearch();
      return;
    }
    await open();
  }

  function resetSearch() {
    searchGeneration += 1;
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    searchDebounceTimer = null;
    searchQuery = '';
    searchResults = [];
    isSearching = false;
    searchFailed = false;
  }

  function updatePosition() {
    const anchor = externalAnchor ?? triggerRef;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const spaceBelow = viewportHeight - rect.bottom;
    const estimatedHeight = 350;
    const width = Math.min(320, window.innerWidth - 16);
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    const above = spaceBelow < estimatedHeight && rect.top > spaceBelow;
    const maxHeight = Math.max(0, (above ? rect.top : spaceBelow) - 12);
    const bounds = `left: ${left}px; width: ${width}px; max-height: ${maxHeight}px;`;

    // Position above the button
    if (above) {
      popoverStyle = `position: fixed; bottom: ${viewportHeight - rect.top + 4}px; ${bounds}`;
    } else {
      popoverStyle = `position: fixed; top: ${rect.bottom + 4}px; ${bounds}`;
    }
  }

  function handleClickOutside(e: MouseEvent) {
    if (!isOpen) return;
    const target = e.target as Node;
    if (triggerRef?.contains(target) || bodyRef?.contains(target)) return;
    isOpen = false;
    externalAnchor = null;
    resetSearch();
  }

  // Escape layer: while the popover is open it is the topmost overlay, so
  // Escape closes only the popover
  $effect(() => {
    if (!isOpen) return;
    return pushEscapeLayer(() => {
      const returnTarget = externalAnchor ?? triggerRef;
      isOpen = false;
      externalAnchor = null;
      resetSearch();
      returnTarget?.focus();
    });
  });

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
      externalAnchor = null;
      resetSearch();
      onPick?.();
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
    appStore.dispatch(
      addSearchedItem({
        id: result.id,
        type: itemType,
        label: result.label,
        filePath: result.uri || undefined,
        noteId: result.type === 'note' || result.type === 'note-range' ? result.id : undefined,
      }),
    );

    // Clear search but keep popover open so user can add more items
    resetSearch();
    searchInputRef?.focus();
  }

  async function performSearch(query: string, generation: number) {
    if (!workspace || !query.trim()) {
      if (generation === searchGeneration) {
        searchResults = [];
        isSearching = false;
      }
      return;
    }

    try {
      const mentionSystem = getMentionSystem();
      const context: SearchContext = {
        workspaceId: workspace.id,
      };
      const results = await mentionSystem.search(query, context);
      if (generation === searchGeneration) {
        searchResults = results;
        activeSearchIndex = 0;
      }
    } catch (error) {
      console.error('Search failed:', error);
      if (generation === searchGeneration) {
        searchResults = [];
        searchFailed = true;
      }
    } finally {
      if (generation === searchGeneration) isSearching = false;
    }
  }

  function handleSearchInput(e: Event) {
    const target = e.target as HTMLInputElement;
    searchQuery = target.value;
    searchFailed = false;
    const generation = ++searchGeneration;

    if (searchDebounceTimer) {
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = null;
    }

    if (!searchQuery.trim()) {
      searchResults = [];
      isSearching = false;
      return;
    }

    isSearching = true;
    const query = searchQuery;
    searchDebounceTimer = setTimeout(() => {
      searchDebounceTimer = null;
      void performSearch(query, generation);
    }, 250);
  }

  onMount(() => {
    document.addEventListener('mousedown', handleClickOutside, true);
    if (embedded) void tick().then(() => searchInputRef?.focus());
    return () => {
      searchGeneration += 1;
      document.removeEventListener('mousedown', handleClickOutside, true);
      if (searchDebounceTimer) {
        clearTimeout(searchDebounceTimer);
      }
    };
  });
</script>

{#if renderTrigger}
  <TooltipShortcut label={m.chat_contextPicker_fromPanels_label()} shortcut={['@']} side="top">
    <Button
      bind:ref={triggerRef}
      variant="ghost-light"
      size="icon-xs"
      onclick={toggleOpen}
      {disabled}
      aria-label={m.chat_contextPicker_addContext_ariaLabel()}
      aria-haspopup="dialog"
      aria-expanded={isOpen}
      aria-controls={isOpen ? `${pickerId}-dialog` : undefined}
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
{/if}

{#snippet pickerBody()}
  <div
    bind:this={bodyRef}
    id={`${pickerId}-dialog`}
    class={cn(
      'flex max-h-[min(400px,var(--bits-popover-content-available-height,calc(100dvh_-_1rem)))] flex-col overflow-hidden pb-2',
      embedded
        ? 'min-h-0 w-full min-w-0'
        : 'rounded-(--radius-medium) border border-border bg-popover text-popover-foreground shadow-(--elevation-overlay)',
    )}
    style={embedded ? undefined : popoverStyle}
    role={embedded ? undefined : 'dialog'}
    aria-label={m.chat_contextPicker_selectPanels_ariaLabel()}
    aria-describedby={embedded ? undefined : (descriptionId ?? `${pickerId}-description`)}
    data-context-picker-body
    data-embedded={embedded ? '' : undefined}
  >
    <!-- Header -->
    <div class="shrink-0 px-3 py-2">
      <div class="type-body font-medium">{m.chat_contextPicker_context_title()}</div>
      <div id={descriptionId ?? `${pickerId}-description`} class="type-caption text-subtle">
        {m.chat_contextPicker_selectFiles_description()}
      </div>
    </div>

    <!-- Search input -->
    <div class="shrink-0 px-2">
      <div class="relative">
        <Fa
          icon={faSearch}
          class="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-subtle"
        />
        <Input
          bind:this={searchInputRef}
          type="text"
          placeholder={m.chat_contextPicker_addFiles_placeholder()}
          aria-label={m.chat_contextPicker_addFiles_placeholder()}
          aria-busy={isSearching}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={Boolean(activeResult)}
          aria-controls={activeResult ? searchListId : undefined}
          aria-activedescendant={activeResult ? resultId(activeResult) : undefined}
          value={searchQuery}
          oninput={handleSearchInput}
          onkeydown={handleSearchKeyDown}
          class="pl-7"
          noFocusStyle
        />
        {#if isSearching}
          <IntentMarkLoader
            size={12}
            class="absolute right-2.5 top-1/2 -translate-y-1/2 text-subtle"
          />
        {/if}
      </div>
    </div>

    <!-- Content area -->
    <div class="mt-1 max-h-[280px] min-h-0 overflow-y-auto px-2">
      {#if showSearchResults}
        <!-- Search results -->
        {#if isSearching}
          <!-- Skeleton loader while searching -->
          <div class="py-1">
            {#each [0, 1, 2] as i (i)}
              <div class="flex items-center gap-2.5 px-3 py-2">
                <div class="h-3.5 w-3.5 rounded bg-muted animate-pulse"></div>
                <div class="flex-1 space-y-1.5">
                  <div class="h-4 w-3/4 rounded bg-muted animate-pulse"></div>
                  <div class="h-3 w-1/2 rounded bg-muted animate-pulse"></div>
                </div>
              </div>
            {/each}
          </div>
        {:else if searchFailed}
          <div class="flex items-center gap-2 px-3 py-4">
            <span class="type-caption text-muted-foreground" role="alert">
              {m.chat_contextPicker_searchFailed_error()}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onclick={() => {
                searchFailed = false;
                isSearching = true;
                searchInputRef?.focus();
                void performSearch(searchQuery, ++searchGeneration);
              }}>{m.ui_errorToast_retry_label()}</Button
            >
          </div>
        {:else if searchResults.length === 0}
          <div class="type-caption px-3 py-4 text-left text-subtle">
            {m.chat_contextPicker_noResults_label()}
          </div>
        {:else}
          <div
            class="py-1"
            role="listbox"
            id={searchListId}
            aria-label={m.chat_contextPicker_addFiles_placeholder()}
          >
            {#each searchResults as result, index (`${result.type}:${result.id}`)}
              <Button
                type="button"
                variant="plain"
                id={resultId(result)}
                role="option"
                aria-selected={index === activeSearchIndex}
                tabindex={-1}
                onpointerdown={(event) => event.preventDefault()}
                onpointermove={() => (activeSearchIndex = index)}
                onclick={() => handleSelectSearchResult(result)}
                wrapContent={false}
                class={cn(
                  menuItem(),
                  index === activeSearchIndex && 'bg-selected',
                  'flex h-auto w-full items-start justify-start gap-2 hover:bg-hover cursor-pointer transition-colors text-left',
                )}
              >
                <span class="flex h-lh shrink-0 items-center text-sm" aria-hidden="true">
                  <Fa icon={getIconForType(result.type)} class="h-3.5 w-3.5 text-subtle" />
                </span>
                <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div class="text-sm truncate font-medium">{result.label}</div>
                  {#if result.subtitle || result.description}
                    <div class="text-xs text-muted-foreground truncate">
                      {result.subtitle || result.description}
                    </div>
                  {/if}
                </div>
              </Button>
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
                <div class="border-t border-border my-1"></div>
              {/if}

              <!-- Panels in this group -->
              {#each group.panels as panel (panel.id)}
                {@const isCurrentAgent = panel.type === 'agent' && panel.agentId === currentAgentId}
                <label
                  for={`${pickerId}-panel-${panel.id}`}
                  class={cn(
                    OPTION_LIST_ROW_CLASS,
                    'flex h-auto w-full items-center justify-start gap-2 transition-colors',
                    isCurrentAgent
                      ? 'opacity-50 cursor-not-allowed'
                      : 'hover:bg-muted/40 cursor-pointer',
                  )}
                >
                  <Checkbox
                    id={`${pickerId}-panel-${panel.id}`}
                    checked={panel.checked}
                    size="sm"
                    disabled={isCurrentAgent}
                    onCheckedChange={() => !isCurrentAgent && handleToggleItem(panel.id)}
                    class="!mr-1"
                  />
                  <Fa icon={getIconForType(panel.type)} class="h-3.5 w-3.5 text-subtle" />
                  <span class="flex-1 truncate text-left">{panel.label}</span>
                  {#if isCurrentAgent}
                    <span class="type-caption text-muted-foreground"
                      >{m.chat_contextPicker_you_badge()}</span
                    >
                  {:else if panel.isActive}
                    <span class="type-caption text-muted-foreground"
                      >{m.chat_contextPicker_active_badge()}</span
                    >
                  {/if}
                </label>
              {/each}

              <!-- Selections in this group -->
              {#each group.selections as selection (selection.id)}
                <label
                  for={`${pickerId}-selection-${selection.id}`}
                  class={cn(
                    OPTION_LIST_ROW_CLASS,
                    'flex h-auto w-full items-center justify-start gap-2 hover:bg-hover cursor-pointer transition-colors',
                  )}
                >
                  <Checkbox
                    id={`${pickerId}-selection-${selection.id}`}
                    checked={selection.checked}
                    size="sm"
                    onCheckedChange={() => handleToggleSelectionItem(selection.id)}
                  />
                  <Fa icon={faQuoteLeft} class="h-3.5 w-3.5 text-ghost" />
                  <span class="flex-1 truncate text-left">{truncateText(selection.text)}</span>
                </label>
              {/each}
            {/each}
          </div>
        {:else}
          <div class="type-caption px-3 py-4 text-left text-subtle">
            {m.chat_contextPicker_noPanels_label()}
          </div>
        {/if}
      {/if}
    </div>
  </div>
{/snippet}

{#if embedded}
  {@render pickerBody()}
{:else if isOpen}
  <Portal zIndex={60}>
    {@render pickerBody()}
  </Portal>
{/if}
