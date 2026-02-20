<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import {
    faFile,
    faFolder,
    faCode,
    faStickyNote,
    faCube,
    faHashtag,
  } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import type { Workspace } from '../../../../shared/types';
  import {
    searchFiles,
    getNotes,
    getEditorSelection,
    type FileSearchResult,
    type Note,
    type EditorSelection,
  } from './context-api';
  import { createLogger } from '$lib/utils/client-logger';
  import { faNote } from '$lib/icons/faNote';

  const logger = createLogger('MentionAutocomplete');

  export interface MentionItem {
    id: string;
    type: 'file' | 'folder' | 'note' | 'workspace' | 'symbol' | 'selection';
    label: string;
    path?: string;
    description?: string;
    icon?: any;
    content?: string;
    range?: { start: number; end: number };
    metadata?: any;
  }

  interface Props {
    query: string;
    workspace?: Workspace;
    maxResults?: number;
    onSelect: (item: MentionItem) => void;
    onClose: () => void;
  }

  let { query = '', workspace, maxResults = 10, onSelect, onClose }: Props = $props();

  let suggestions: MentionItem[] = $state([]);
  let selectedIndex = $state(0);
  let containerElement: HTMLDivElement;
  let searchTimeout: NodeJS.Timeout;

  // Icon mapping for different types
  const iconMap = {
    file: faFile,
    folder: faFolder,
    note: faNote,
    workspace: faCube,
    symbol: faHashtag,
    selection: faCode,
  };

  // Search for suggestions based on query
  async function searchSuggestions() {
    if (!workspace) {
      suggestions = [];
      return;
    }

    try {
      const results: MentionItem[] = [];

      // Search files
      if (!query || 'file'.includes(query.toLowerCase())) {
        const files = await searchFilesInWorkspace(query);
        results.push(...files.slice(0, 5));
      }

      // Search notes
      if (!query || 'note'.includes(query.toLowerCase())) {
        const notes = await searchNotesInWorkspace(query);
        results.push(...notes.slice(0, 3));
      }

      // Add workspace context
      if (!query || 'workspace'.includes(query.toLowerCase())) {
        results.push({
          id: `workspace-${workspace.id}`,
          type: 'workspace',
          label: workspace.path?.split('/').pop() || 'Current Space',
          description: 'Include entire space context',
          icon: iconMap.workspace,
        });
      }

      // Add current selection if available
      const selection = await getCurrentSelection();
      if (selection && (!query || 'selection'.includes(query.toLowerCase()))) {
        results.push(selection);
      }

      suggestions = results.slice(0, maxResults);
      selectedIndex = 0;
    } catch (error) {
      logger.error('Failed to search suggestions:', error);
      suggestions = [];
    }
  }

  async function searchFilesInWorkspace(searchQuery: string): Promise<MentionItem[]> {
    if (!workspace) return [];

    try {
      // Use the context API
      const files = await searchFiles(workspace.id, searchQuery || '', 5);

      return files.map((file: FileSearchResult) => ({
        id: `file-${file.path}`,
        type: 'file' as const,
        label: file.name,
        path: file.path,
        description: file.relativePath,
        icon: iconMap.file,
      }));
    } catch (error) {
      logger.error('Failed to search files:', error);
      return [];
    }
  }

  async function searchNotesInWorkspace(searchQuery: string): Promise<MentionItem[]> {
    if (!workspace) return [];

    try {
      const notes = await getNotes(workspace.id);

      // Filter notes based on query
      const filtered = notes
        .filter((note: Note) => {
          if (!searchQuery) return true;
          const query = searchQuery.toLowerCase();
          return (
            note.title?.toLowerCase().includes(query) || note.content?.toLowerCase().includes(query)
          );
        })
        .slice(0, 3);

      return filtered.map((note: Note) => ({
        id: `note-${note.id}`,
        type: 'note' as const,
        label: note.title || 'Untitled Note',
        description: note.content?.substring(0, 100) + '...',
        icon: iconMap.note,
        metadata: { noteId: note.id },
      }));
    } catch (error) {
      logger.error('Failed to search notes:', error);
      return [];
    }
  }

  async function getCurrentSelection(): Promise<MentionItem | null> {
    try {
      // Check if there's a current code selection
      const selection = await getEditorSelection(workspace?.id);

      if (selection && selection.text) {
        return {
          id: `selection-${Date.now()}`,
          type: 'selection',
          label: 'Current Selection',
          description: `${selection.text.substring(0, 50)}...`,
          content: selection.text,
          range: selection.range,
          path: selection.file,
          icon: iconMap.selection,
        };
      }
    } catch (error) {
      logger.debug('No current selection available');
    }

    return null;
  }

  // Debounced search
  $effect(() => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      searchSuggestions();
    }, 150);
  });

  // Keyboard navigation
  function handleKeyDown(e: KeyboardEvent) {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        selectedIndex = Math.min(selectedIndex + 1, suggestions.length - 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        selectedIndex = Math.max(selectedIndex - 1, 0);
        break;
      case 'Enter':
        e.preventDefault();
        if (suggestions[selectedIndex]) {
          onSelect(suggestions[selectedIndex]);
        }
        break;
      case 'Escape':
        e.preventDefault();
        onClose();
        break;
      case 'Tab':
        e.preventDefault();
        if (suggestions[selectedIndex]) {
          onSelect(suggestions[selectedIndex]);
        }
        break;
    }
  }

  // Click outside to close
  function handleClickOutside(e: MouseEvent) {
    if (containerElement && !containerElement.contains(e.target as Node)) {
      onClose();
    }
  }

  onMount(() => {
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleClickOutside);
  });

  onDestroy(() => {
    document.removeEventListener('keydown', handleKeyDown);
    document.removeEventListener('mousedown', handleClickOutside);
    clearTimeout(searchTimeout);
  });
</script>

<div
  bind:this={containerElement}
  class="mention-autocomplete"
  role="listbox"
  aria-label="Mention suggestions"
>
  {#if suggestions.length > 0}
    <div class="suggestions-list">
      {#each suggestions as item, index (item.id)}
        <button
          class="suggestion-item"
          class:selected={index === selectedIndex}
          role="option"
          aria-selected={index === selectedIndex}
          onclick={() => onSelect(item)}
          onmouseenter={() => (selectedIndex = index)}
        >
          <div class="suggestion-icon">
            <Fa icon={item.icon || iconMap[item.type]} size="sm" />
          </div>
          <div class="suggestion-content">
            <div class="suggestion-label">{item.label}</div>
            {#if item.description}
              <div class="suggestion-description">{item.description}</div>
            {/if}
          </div>
          <div class="suggestion-type">
            {item.type}
          </div>
        </button>
      {/each}
    </div>
  {:else if query}
    <div class="no-results">
      No results for "{query}"
    </div>
  {:else}
    <div class="suggestions-hint">
      Type to search files, notes, or use "space" for full context
    </div>
  {/if}
</div>

<style>
  .mention-autocomplete {
    position: absolute;
    bottom: 100%;
    left: 0;
    right: 0;
    margin-bottom: 8px;
    background: var(--popover);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    max-height: 300px;
    overflow-y: auto;
    z-index: 55;
  }

  .suggestions-list {
    padding: 4px;
  }

  .suggestion-item {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 8px 12px;
    background: transparent;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    text-align: left;
    transition: background 0.15s;
  }

  .suggestion-item:hover,
  .suggestion-item.selected {
    background: var(--accent);
  }

  .suggestion-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    color: var(--muted-foreground);
  }

  .suggestion-content {
    flex: 1;
    min-width: 0;
  }

  .suggestion-label {
    font-size: 14px;
    font-weight: 500;
    color: var(--foreground);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .suggestion-description {
    font-size: 12px;
    color: var(--muted-foreground);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    margin-top: 2px;
  }

  .suggestion-type {
    font-size: 11px;
    padding: 2px 6px;
    background: var(--muted);
    color: var(--muted-foreground);
    border-radius: 4px;
    text-transform: uppercase;
    font-weight: 500;
  }

  .no-results,
  .suggestions-hint {
    padding: 12px;
    text-align: center;
    color: var(--muted-foreground);
    font-size: 13px;
  }
</style>
