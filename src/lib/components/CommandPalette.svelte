<script lang="ts">
  /**
   * Global Modal Command Palette (Cmd/Ctrl+K)
   *
   * App-wide palette for commands, files, workspace search, notes and headings.
   * Distinct from lib/components/commands/CommandPalette.svelte which is an
   * inline slash command suggester for text inputs.
   */
  import { onMount, untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import { fly } from 'svelte/transition';
  import { navigateToSettings } from '$lib/utils/workspace-navigation';
  import Fa from 'svelte-fa';
  import {
    faSearch,
    faFile,
    faCog,
    faFolderOpen,
    faTerminal,
    faCommentDots,
    faFileAlt,
    faCodeBranch,
    faPlus,
    faGlobe,
  } from '@fortawesome/free-solid-svg-icons';
  import { invoke } from '$lib/electron-bridge';
  import { workspaceStore } from '$features/workspace/workspace.store.svelte';
  import { browserStore } from '$features/browser/browser.store.svelte';
  import { createLogger } from '$lib/utils/client-logger';
  import { Skeleton } from './ui/skeleton';
  import { sessionStoreData } from '$features/agent/browser';
  import { notesStore } from '$features/notes/notes.store.svelte';
  import { fileTrackingStore } from '$features/file-tracking/file-tracking.store.svelte';
  import { terminalManager } from '$features/terminal/terminal-manager.svelte';
  import { terminalHistoryTracker } from '$features/terminal/terminal-history-tracker';
  import AuggieAvatar from '$lib/components/ui/auggie-avatar/AuggieAvatar.svelte';
  import { extractContentFromBlocks } from '$shared/types/agent-message.conversion';
  import type { Note } from '$shared/types';
  import { track } from '$lib/services/analytics';

  const logger = createLogger('CommandPalette');

  // Helper to build breadcrumbs for a note
  function buildNoteBreadcrumbs(note: Note, allNotes: Note[]): string {
    const noteMap = new Map(allNotes.map((n) => [n.id as string, n]));
    const breadcrumbs: string[] = [];
    let currentNote: Note | undefined = note;
    const visited = new Set<string>();

    // Walk up the parent chain
    while (currentNote?.parentId && !visited.has(currentNote.id as string)) {
      visited.add(currentNote.id as string);
      const parent = noteMap.get(currentNote.parentId as string);
      if (parent) {
        breadcrumbs.unshift(parent.title || 'Untitled');
        currentNote = parent;
      } else {
        break;
      }
    }

    return breadcrumbs.join(' / ');
  }

  // Types for workspace objects
  type WorkspaceObjectType = 'agent' | 'note' | 'change' | 'terminal' | 'file' | 'browser';

  interface WorkspaceObject {
    id: string;
    type: WorkspaceObjectType;
    label: string;
    description?: string;
    icon: any;
    timestamp?: number;
    path?: string;
    url?: string; // For browser URLs
    _time?: string;
    breadcrumbs?: string; // For notes with parent hierarchy
  }

  interface Props {
    isOpen: boolean;

    workspaceId?: string;
    onClose: () => void;
    /** Callback when a file is selected. Includes openInAdjacentPanel for cmd+Enter support. */
    onSelectFile?: (detail: { path: string; line?: number; openInAdjacentPanel?: boolean }) => void;
  }

  let { isOpen = $bindable(false), workspaceId, onClose, onSelectFile }: Props = $props();

  let searchQuery = $state('');
  let selectedIndex = $state(0);
  let searchResults: any[] = $state([]);
  let inputRef: HTMLInputElement | undefined = $state(undefined);
  let isLoadingFiles = $state(false);
  let activeFilter: WorkspaceObjectType | 'workspace' | null = $state(null); // Filter by type

  // Prefix mapping for filtering
  const FILTER_PREFIXES: Record<string, WorkspaceObjectType | 'workspace'> = {
    '@': 'agent',
    '#': 'note',
    '>': 'terminal',
    '~': 'change',
    '/': 'file',
    '*': 'workspace',
    '^': 'browser',
  };

  // Derived: parse search query for filter prefix
  let parsedQuery = $derived.by(() => {
    const query = searchQuery.trim();
    if (!query) return { filter: null, searchTerm: '' };

    const firstChar = query[0];
    if (FILTER_PREFIXES[firstChar]) {
      return {
        filter: FILTER_PREFIXES[firstChar],
        searchTerm: query.slice(1).trim(),
      };
    }

    return { filter: null, searchTerm: query };
  });

  // Update activeFilter when parsed query changes
  $effect(() => {
    activeFilter = parsedQuery.filter;
  });

  // Debounce timer for file queries
  let fileQueryTimeout: ReturnType<typeof setTimeout> | null = null;
  // Request ID to cancel stale responses
  let currentFileRequestId = 0;
  // RAF handle for deferred result computation
  let resultComputeRaf: number | null = null;

  // Workspace objects state
  let agents: WorkspaceObject[] = $state([]);
  let notes: WorkspaceObject[] = $state([]);
  let changes: WorkspaceObject[] = $state([]);
  let terminals: WorkspaceObject[] = $state([]);
  let browserUrls: WorkspaceObject[] = $state([]);
  let recentItems: WorkspaceObject[] = $state([]);

  // Commands available in command mode
  const commands = [
    { id: 'new-workspace', label: 'New Workspace', icon: faFolderOpen, shortcut: '⌘T' },
    { id: 'settings', label: 'Settings', icon: faCog, shortcut: '⌘,' },
    { id: 'install-cli', label: "Install 'intent' command in PATH", icon: faTerminal },
    { id: 'new-agent', label: 'New Agent Chat', icon: faCommentDots },
    { id: 'new-terminal', label: 'New Terminal', icon: faTerminal },
    { id: 'new-note', label: 'New Note', icon: faFileAlt },
    { id: 'open-url', label: 'Open URL in Browser', icon: faGlobe },
  ];

  // MRU (Most Recently Used) tracking for all object types
  const MRU_STORAGE_KEY = 'palette-mru-all';
  const MAX_RECENT_ITEMS = 3;

  interface MRUEntry {
    type: WorkspaceObjectType;
    id: string;
    timestamp: number;
  }

  function getMRUEntries(): MRUEntry[] {
    try {
      const raw = localStorage.getItem(MRU_STORAGE_KEY);
      if (!raw) return [];
      return JSON.parse(raw) as MRUEntry[];
    } catch {
      return [];
    }
  }

  function saveMRUEntries(entries: MRUEntry[]) {
    try {
      localStorage.setItem(MRU_STORAGE_KEY, JSON.stringify(entries));
    } catch {}
  }

  function recordMRUItem(type: WorkspaceObjectType, id: string) {
    const entries = getMRUEntries();
    // Remove existing entry for this item
    const filtered = entries.filter((e) => !(e.type === type && e.id === id));
    // Add new entry at the beginning
    filtered.unshift({ type, id, timestamp: Date.now() });
    // Keep only latest 50 entries
    const trimmed = filtered.slice(0, 50);
    saveMRUEntries(trimmed);
  }

  // Format relative time (e.g., "2h ago", "yesterday", "Dec 5")
  function formatRelativeTime(dateStr: string | undefined): string {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return 'yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;

    // For older dates, show the date
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  // Load workspace objects when workspace changes
  $effect(() => {
    if (!workspaceId) {
      // Use untrack to avoid effect loops when resetting state
      untrack(() => {
        agents = [];
        notes = [];
        changes = [];
        terminals = [];
        browserUrls = [];
        recentItems = [];
      });
      return;
    }

    // Capture workspaceId to use in callbacks (avoids reactive reads in async contexts)
    const wsId = workspaceId;

    // Initialize browser store for this workspace (untracked to avoid triggering effects)
    untrack(() => {
      browserStore.initialize(wsId);
    });

    // Load agents from sessionStoreData
    // Use untrack when updating state inside subscription to avoid triggering this effect
    const unsubscribe = sessionStoreData.subscribe((state: any) => {
      const sessions = state.sessions || [];
      const newAgents = sessions
        .filter((s: any) => s.workspaceId === wsId && !s.id?.startsWith('terminal-'))
        .map((s: any) => {
          // Get the latest message content
          const messages = s.messages || [];
          const latestMessage = messages.length > 0 ? messages[messages.length - 1] : null;
          let description = '';
          if (latestMessage?.contentBlocks) {
            // Extract text from content blocks
            const content = extractContentFromBlocks(latestMessage.contentBlocks);
            // Truncate to ~60 chars
            description = content.length > 60 ? content.slice(0, 60) + '...' : content;
          }

          return {
            id: s.id,
            type: 'agent' as const,
            label: s.name || 'Untitled Agent',
            description,
            icon: faCommentDots,
            timestamp: new Date(s.updatedAt || s.createdAt).getTime(),
            _time: formatRelativeTime(s.updatedAt || s.createdAt),
          };
        })
        .sort((a: any, b: any) => (b.timestamp || 0) - (a.timestamp || 0));
      // Update state inside untrack to prevent re-triggering this effect
      untrack(() => {
        agents = newAgents;
      });
    });

    // Load notes from notesStore
    // Use untrack to read stores and update state to avoid triggering this effect
    untrack(() => {
      const notesMap = notesStore.notes;
      const allNotes = Array.from(notesMap.values()).filter(
        (n) => n.workspaceId === wsId && !n.isArchived,
      );
      notes = allNotes
        .map((n) => ({
          id: n.id,
          type: 'note' as const,
          label: n.title,
          description: n.tags?.join(', '),
          breadcrumbs: buildNoteBreadcrumbs(n, allNotes),
          icon: faFileAlt,
          timestamp: new Date(n.updatedAt).getTime(),
          _time: formatRelativeTime(n.updatedAt),
        }))
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

      // Load changes from fileTrackingStore
      const trackedChanges = fileTrackingStore.changes;
      changes = trackedChanges.slice(0, 10).map((c) => ({
        id: c.id,
        type: 'change' as const,
        label: c.relativePath.split('/').pop() || c.relativePath,
        description: `+${c.stats.additions || 0} -${c.stats.deletions || 0}`,
        icon: faCodeBranch,
        path: c.relativePath,
        timestamp: new Date(c.attribution.timestamp).getTime(),
        _time: formatRelativeTime(new Date(c.attribution.timestamp).toISOString()),
      }));

      // Load terminals from terminalManager
      const terminalMetadata = terminalManager.loadTerminalMetadata(wsId);
      terminals = terminalMetadata
        .map((t: any) => {
          // Get the latest command from history tracker
          const lastCommand = terminalHistoryTracker.getLastCommand(t.terminalId);
          const description = lastCommand
            ? lastCommand.length > 60
              ? lastCommand.slice(0, 60) + '...'
              : lastCommand
            : undefined;

          return {
            id: t.terminalId,
            type: 'terminal' as const,
            label: t.title || `Terminal ${t.terminalId.slice(-4)}`,
            description,
            icon: faTerminal,
            timestamp: new Date(t.createdAt).getTime(),
            _time: formatRelativeTime(t.createdAt),
          };
        })
        .sort((a: any, b: any) => (b.timestamp || 0) - (a.timestamp || 0));

      // Load browser URLs from browserStore
      const recentUrls = browserStore.recentUrls;
      browserUrls = recentUrls.map((url) => {
        // Extract domain from URL for display
        let domain = url.url;
        try {
          const urlObj = new URL(url.url);
          domain = urlObj.hostname;
        } catch {
          // If URL parsing fails, use the full URL
        }

        return {
          id: url.url,
          type: 'browser' as const,
          label: url.title || domain,
          description: url.url,
          url: url.url,
          icon: faGlobe,
          timestamp: new Date(url.lastVisited).getTime(),
          _time: formatRelativeTime(url.lastVisited),
        };
      });
    });

    return () => {
      unsubscribe();
    };
  });

  // Build recent items from MRU - separate derived state to avoid infinite loop
  $effect(() => {
    if (!workspaceId) {
      untrack(() => {
        recentItems = [];
      });
      return;
    }

    const mruEntries = getMRUEntries();
    // Use untrack to read the reactive state without creating dependencies
    const allObjects = untrack(() => [
      ...agents,
      ...notes,
      ...changes,
      ...terminals,
      ...browserUrls,
    ]);
    const newRecentItems = mruEntries
      .slice(0, MAX_RECENT_ITEMS)
      .map((entry) => allObjects.find((obj) => obj.type === entry.type && obj.id === entry.id))
      .filter((obj): obj is WorkspaceObject => obj !== undefined);
    // Update state in untrack to avoid effect loops
    untrack(() => {
      recentItems = newRecentItems;
    });
  });

  // Lightweight fuzzy scorer: returns -Infinity if not a subsequence match
  function fuzzyScore(haystackRaw: string, needleRaw: string): number {
    const haystack = (haystackRaw || '').toLowerCase();
    const needle = (needleRaw || '').toLowerCase();
    if (!needle) return 0;
    if (haystack === needle) return 1000;
    if (haystack.startsWith(needle)) return 200 + Math.max(0, 20 - needle.length);

    let i = 0;
    let score = 0;
    let streak = 0;
    for (const ch of needle) {
      const idx = haystack.indexOf(ch, i);
      if (idx === -1) return -Infinity;
      // Word boundary bonus
      const prev = idx > 0 ? haystack[idx - 1] : ' ';
      if (prev === ' ' || prev === '/' || prev === '-' || prev === '_' || prev === '.') score += 5;
      // Consecutive match bonus
      streak = idx === i ? streak + 1 : 1;
      score += streak * 2;
      // Prefer earlier matches slightly
      score += Math.max(0, 3 - idx);
      i = idx + 1;
    }
    return score;
  }

  // Grouped results state (only files need async loading)
  let groupFiles: any[] = $state([]);

  // IPC helper to query files and map to palette items (with fuzzy/MRU)
  async function queryFiles(pattern: string): Promise<any[]> {
    if (!workspaceId) return [];
    try {
      const resp = (await invoke('workspace:list-files', {
        workspaceId,
        pattern: (pattern || '').trim(),
        limit: 50,
      })) as any;
      const files = Array.isArray(resp) ? resp : resp?.files || [];
      const mapped = files.map((file: any) => ({
        id: file.path,
        label: file.name || (file.path?.split('/').pop() ?? file.path),
        path: file.path,
        icon: faFile,
        description: file.relativePath || file.path,
      }));
      const q = (pattern || '').trim();
      if (q) {
        const mru = getMRUMap();
        return (mapped as any[])
          .map((m: any) => ({
            ...m,
            _score: fuzzyScore(`${m.label} ${m.description || m.path}`, q),
            _mru: m.path ? mru.get(m.path) || 0 : 0,
          }))
          .filter((m: any) => m._score !== -Infinity)
          .sort(
            (a: any, b: any) =>
              (b._score as number) - (a._score as number) ||
              (b._mru as number) - (a._mru as number),
          )
          .map(({ _score, _mru, ...rest }: any) => rest)
          .slice(0, 8);
      } else {
        return rankByMRU(mapped).slice(0, 8);
      }
    } catch (error) {
      logger.error('Failed to list workspace files:', error);
      return [];
    }
  }

  // Debounce constant
  const FILE_QUERY_DEBOUNCE_MS = 150;

  // Keep file group in sync with current query/workspace (debounced)
  $effect(() => {
    const q = (searchQuery || '').trim();
    const wsId = workspaceId;

    // Clear any pending debounce timer
    if (fileQueryTimeout) {
      clearTimeout(fileQueryTimeout);
      fileQueryTimeout = null;
    }

    // Increment request ID to invalidate any in-flight requests
    const requestId = ++currentFileRequestId;

    // If no workspace, clear files immediately (untracked write)
    if (!wsId) {
      untrack(() => {
        groupFiles = [];
        isLoadingFiles = false;
      });
      return;
    }

    // Set loading state immediately when query changes (untracked write)
    untrack(() => {
      isLoadingFiles = true;
    });

    // Debounce the actual IPC call
    fileQueryTimeout = setTimeout(async () => {
      try {
        const files = await queryFiles(q);
        // Only update if this is still the current request (untracked to avoid effect loop)
        if (requestId === currentFileRequestId) {
          untrack(() => {
            groupFiles = files;
            isLoadingFiles = false;
          });
        }
      } catch (error) {
        if (requestId === currentFileRequestId) {
          untrack(() => {
            isLoadingFiles = false;
          });
        }
      }
    }, FILE_QUERY_DEBOUNCE_MS);

    return () => {
      // Cleanup: cancel pending timeout
      if (fileQueryTimeout) {
        clearTimeout(fileQueryTimeout);
        fileQueryTimeout = null;
      }
    };
  });

  // Compute results - extracted to function so it can be called deferred
  function computeResults(q: string, files: any[]) {
    const flat: any[] = [];
    let idx = 0;
    const MAX_ITEMS_PER_GROUP = 3;

    // Helper to add items with index and optional limit
    const addItems = (
      items: any[],
      groupLabel?: string,
      shortcutKey?: string,
      itemType?: WorkspaceObjectType,
    ) => {
      if (groupLabel && items.length > 0) {
        flat.push({ _groupLabel: groupLabel, _shortcutKey: shortcutKey, _idx: idx++ });
      }

      // Apply limit if not searching and not filtered to this type
      const shouldLimit = !q && (!activeFilter || activeFilter !== itemType);
      const itemsToShow = shouldLimit ? items.slice(0, MAX_ITEMS_PER_GROUP) : items;

      for (const item of itemsToShow) {
        item._idx = idx++;
        flat.push(item);
      }

      // Add "show more" button if items were limited
      if (shouldLimit && items.length > MAX_ITEMS_PER_GROUP && itemType) {
        flat.push({
          _showMore: true,
          _itemType: itemType,
          _count: items.length - MAX_ITEMS_PER_GROUP,
          _idx: idx++,
        });
      }
    };

    // If searching, show filtered results across all types
    if (q) {
      // Filter all items by query
      const allItems = [
        ...commands.filter((c) => c.id !== 'new-workspace'),
        ...agents,
        ...notes,
        ...changes,
        ...terminals,
        ...browserUrls,
        ...files,
        ...(workspaceStore.items || [])
          .filter((w: any) => w.id !== workspaceId)
          .map((w: any) => ({
            id: w.id,
            label: w.title || w.id,
            icon: faFolderOpen,
            description: w.repositoryPath
              ? w.repositoryPath.split('/').pop() || w.repositoryPath
              : undefined,
            _workspace: true,
            _time: formatRelativeTime(w.updatedAt),
          })),
      ];

      const filtered = allItems
        .map((item: any) => ({
          ...item,
          _score: fuzzyScore(`${item.label} ${item.description || ''}`, q),
        }))
        .filter((item: any) => item._score !== -Infinity)
        .sort((a: any, b: any) => (b._score as number) - (a._score as number))
        .map(({ _score, ...rest }: any) => rest)
        .slice(0, 20);

      addItems(filtered);
      return flat;
    }

    // Not searching - show organized groups
    // 1. New actions row (horizontal pills) with New Workspace on the right - no label
    const newWs = commands.find((c) => c.id === 'new-workspace');
    const newActions = workspaceId
      ? commands.filter((c) => ['new-agent', 'new-terminal', 'new-note'].includes(c.id))
      : [];

    // Show "New" row if we have workspace-specific actions OR new workspace button
    if (!activeFilter && (newActions.length > 0 || newWs)) {
      flat.push({ _newActionsRow: true, _idx: idx++ });

      // Add workspace-specific new actions
      for (const action of newActions) {
        const actionItem = action as any;
        actionItem._idx = idx++;
        actionItem._newAction = true;
        flat.push(actionItem);
      }

      // Add New Workspace on the right
      if (newWs) {
        const wsItem = newWs as any;
        wsItem._idx = idx++;
        wsItem._newAction = true;
        wsItem._newWorkspace = true; // Special flag to style it differently
        flat.push(wsItem);
      }
    }

    // 3. Recent items (3 most recent)
    if (recentItems.length > 0 && !activeFilter) {
      addItems(recentItems, 'Recent');
    }

    // 4. Agents (separate group)
    if (agents.length > 0 && (!activeFilter || activeFilter === 'agent')) {
      addItems(agents, 'Agents', '@', 'agent');
    }

    // 5. Context / Notes (separate group)
    if (notes.length > 0 && (!activeFilter || activeFilter === 'note')) {
      addItems(notes, 'Context', '#', 'note');
    }

    // 6. Changes (separate group)
    if (changes.length > 0 && (!activeFilter || activeFilter === 'change')) {
      addItems(changes, 'Changes', '~', 'change');
    }

    // 7. Terminals (separate group)
    if (terminals.length > 0 && (!activeFilter || activeFilter === 'terminal')) {
      addItems(terminals, 'Terminals', '>', 'terminal');
    }

    // 8. Browser URLs (separate group)
    if (browserUrls.length > 0 && (!activeFilter || activeFilter === 'browser')) {
      addItems(browserUrls, 'Browser', '^', 'browser');
    }

    // 9. Files (separate group)
    if (files.length > 0 && (!activeFilter || activeFilter === 'file')) {
      addItems(files, 'Files', '/', 'file');
    }

    // 10. Other Spaces (with border above) - only show when not filtering or filtering for workspaces
    if (!activeFilter || activeFilter === 'workspace') {
      const wsItems = (workspaceStore.items || [])
        .filter((w: any) => w.id !== workspaceId)
        .sort((a: any, b: any) => {
          const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
          const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
          return bTime - aTime;
        })
        .map((w: any) => ({
          id: w.id,
          label: w.title || w.id,
          icon: faFolderOpen,
          description: w.repositoryPath
            ? w.repositoryPath.split('/').pop() || w.repositoryPath
            : undefined,
          _workspace: true,
          _time: formatRelativeTime(w.updatedAt),
        }));
      if (wsItems.length > 0) {
        // Add a border marker before the group
        flat.push({ _borderAbove: true, _idx: idx++ });
        addItems(wsItems, 'Other Spaces', '*');
      }
    }

    return flat;
  }

  // PERF: Debounce timer for rapid typing
  let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  const SEARCH_DEBOUNCE_MS = 16; // ~1 frame, prevents excessive RAF calls during fast typing

  // Recompute flat results - debounced and deferred via RAF to not block typing
  $effect(() => {
    // Use the parsed search term (with prefix stripped)
    const q = parsedQuery.searchTerm;
    const files = groupFiles;
    // Track activeFilter to trigger recomputation when it changes
    activeFilter;

    // Cancel any pending computation
    if (resultComputeRaf !== null) {
      cancelAnimationFrame(resultComputeRaf);
      resultComputeRaf = null;
    }
    if (searchDebounceTimer !== null) {
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = null;
    }

    // PERF: Debounce rapid typing, then defer to RAF
    searchDebounceTimer = setTimeout(() => {
      searchDebounceTimer = null;
      resultComputeRaf = requestAnimationFrame(() => {
        resultComputeRaf = null;
        const flat = computeResults(q, files);
        // Use untrack for all state updates to avoid effect loops
        untrack(() => {
          searchResults = flat;
          // Keep selection within bounds
          const currentIdx = selectedIndex;
          const clampedIdx = Math.max(0, Math.min(currentIdx, flat.length - 1));
          if (clampedIdx !== currentIdx) {
            selectedIndex = clampedIdx;
          }
        });
      });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      if (resultComputeRaf !== null) {
        cancelAnimationFrame(resultComputeRaf);
        resultComputeRaf = null;
      }
      if (searchDebounceTimer !== null) {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = null;
      }
    };
  });

  // MRU utilities for files
  function getMRUMap(): Map<string, number> {
    try {
      const raw = localStorage.getItem('palette-mru-files');
      if (!raw) return new Map();
      const obj = JSON.parse(raw) as Record<string, number>;
      return new Map(Object.entries(obj));
    } catch {
      return new Map();
    }
  }

  function saveMRUMap(map: Map<string, number>) {
    const obj: Record<string, number> = {};
    for (const [k, v] of map.entries()) obj[k] = v;
    try {
      localStorage.setItem('palette-mru-files', JSON.stringify(obj));
    } catch {}
  }

  function recordMRUFile(path: string) {
    const map = getMRUMap();
    map.set(path, Date.now());
    // Keep only latest 200 entries
    if (map.size > 200) {
      const sorted = Array.from(map.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 200);
      const trimmed = new Map(sorted);
      saveMRUMap(trimmed);
    } else {
      saveMRUMap(map);
    }
  }

  function rankByMRU<T extends { path?: string }>(items: T[]): T[] {
    const map = getMRUMap();
    return items.slice().sort((a, b) => {
      const ta = a.path ? map.get(a.path) || 0 : 0;
      const tb = b.path ? map.get(b.path) || 0 : 0;
      return tb - ta;
    });
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      // Clear search query (which clears filter) first if active, otherwise close
      if (searchQuery) {
        searchQuery = '';
      } else {
        onClose?.();
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      // Skip group labels and new action items
      let nextIndex = selectedIndex + 1;
      while (
        nextIndex < searchResults.length &&
        (searchResults[nextIndex]._groupLabel ||
          searchResults[nextIndex]._newAction ||
          searchResults[nextIndex]._showMore)
      ) {
        nextIndex++;
      }
      selectedIndex = Math.min(nextIndex, searchResults.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      // Skip group labels and new action items
      let prevIndex = selectedIndex - 1;
      while (
        prevIndex >= 0 &&
        (searchResults[prevIndex]._groupLabel ||
          searchResults[prevIndex]._newAction ||
          searchResults[prevIndex]._showMore)
      ) {
        prevIndex--;
      }
      selectedIndex = Math.max(prevIndex, 0);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      // Cmd+Enter opens in adjacent panel
      const openInAdjacentPanel = e.metaKey || e.ctrlKey;
      selectItem(searchResults[selectedIndex], { openInAdjacentPanel });
    }
  }

  // Keep focus inside the palette when open (simple trap)
  function handleContainerKeyDown(e: KeyboardEvent) {
    if (e.key === 'Tab') {
      e.preventDefault();
      queueMicrotask(() => inputRef?.focus());
    }
  }

  function selectItem(item: any, options?: { openInAdjacentPanel?: boolean }) {
    if (!item) return;
    // Skip group labels
    if (item._groupLabel) return;

    const openInAdjacentPanel = options?.openInAdjacentPanel ?? false;

    // Handle "show more" button - insert the appropriate prefix
    if (item._showMore) {
      const prefix = Object.keys(FILTER_PREFIXES).find(
        (key) => FILTER_PREFIXES[key] === item._itemType,
      );
      if (prefix) {
        searchQuery = prefix;
        // Focus input so user can continue typing
        queueMicrotask(() => inputRef?.focus());
      }
      return;
    }

    // Track command palette usage
    try {
      let actionType: string;
      if (item.type) {
        actionType = item.type; // 'agent', 'note', 'change', 'terminal', 'browser', 'file'
      } else if ('_workspace' in item) {
        actionType = 'workspace';
      } else if (item.path) {
        actionType = 'file';
      } else {
        actionType = 'command';
      }
      track('Used Command Palette', {
        action_type: actionType,
        query_length: searchQuery.length,
      });
    } catch (e) {
      logger.error('Failed to track command palette usage:', e);
    }

    let shouldClose = true;

    // Handle workspace objects
    if (item.type) {
      recordMRUItem(item.type, item.id);

      switch (item.type) {
        case 'agent':
          window.dispatchEvent(
            new CustomEvent('workspace:open-agent', {
              detail: { agentId: item.id, openInAdjacentPanel },
            }),
          );
          break;
        case 'note':
          window.dispatchEvent(
            new CustomEvent('workspace:open-note', {
              detail: { noteId: item.id, openInAdjacentPanel },
            }),
          );
          break;
        case 'change':
          if (item.path) {
            onSelectFile?.({ path: item.path, openInAdjacentPanel });
          }
          break;
        case 'terminal':
          window.dispatchEvent(
            new CustomEvent('workspace:open-terminal', { detail: { terminalId: item.id } }),
          );
          break;
        case 'browser':
          if (item.url) {
            window.dispatchEvent(
              new CustomEvent('workspace:open-browser-url', { detail: { url: item.url } }),
            );
          }
          break;
        case 'file':
          if (item.path) {
            onSelectFile?.({ path: item.path, line: item.line, openInAdjacentPanel });
            recordMRUFile(item.path);
          }
          break;
      }
    } else if ('_workspace' in item) {
      goto(`/workspace/${item.id}`);
    } else if (item.path) {
      onSelectFile?.({ path: item.path, line: item.line, openInAdjacentPanel });
      if (item.path) recordMRUFile(item.path);
    } else {
      const close = handleCommand(item.id);
      if (close === false) shouldClose = false;
    }

    if (shouldClose) onClose?.();
  }

  function handleCommand(commandId: string): boolean {
    switch (commandId) {
      case 'new-workspace':
        window.dispatchEvent(new CustomEvent('app:open-new-space-modal', { detail: {} }));
        return true;
      case 'settings':
        navigateToSettings();
        return true;
      case 'install-cli':
        invoke('shell:install-cli')
          .then((result: any) => {
            if (result?.success) {
              window.dispatchEvent(
                new CustomEvent('app:show-toast', {
                  detail: { message: result.message || 'CLI installed successfully', type: 'success' },
                }),
              );
            } else {
              window.dispatchEvent(
                new CustomEvent('app:show-toast', {
                  detail: { message: result?.message || 'Failed to install CLI', type: 'error' },
                }),
              );
            }
          })
          .catch((err: any) => {
            window.dispatchEvent(
              new CustomEvent('app:show-toast', {
                detail: { message: 'Failed to install CLI: ' + err.message, type: 'error' },
              }),
            );
          });
        return true;
      case 'new-agent':
        window.dispatchEvent(new CustomEvent('app:new-agent'));
        return true;
      case 'new-terminal':
        window.dispatchEvent(new CustomEvent('app:new-terminal'));
        return true;
      case 'new-note':
        window.dispatchEvent(new CustomEvent('app:new-note'));
        return true;
      case 'open-url':
        // Open a browser panel with default URL
        if (workspaceId) {
          window.dispatchEvent(
            new CustomEvent('workspace:open-browser-url', {
              detail: { url: 'about:blank' },
            }),
          );
        }
        return true;
      default:
        return true;
    }
  }

  onMount(() => {
    if (inputRef) {
      inputRef.focus();
    }
  });

  $effect(() => {
    if (isOpen && inputRef) {
      // Focus input when palette opens
      queueMicrotask(() => inputRef?.focus());
    }
  });

  $effect(() => {
    if (isOpen && inputRef) {
      inputRef.focus();
      // Reset state when opening - use untrack to avoid triggering other effects
      untrack(() => {
        searchQuery = '';
        groupFiles = [];
        isLoadingFiles = false;
      });
    }
  });
</script>

{#if isOpen}
  <!-- Backdrop -->
  <div
    class="fixed inset-0 z-50 bg-black/15 cursor-pointer"
    role="button"
    aria-label="Close"
    tabindex="0"
    onclick={onClose}
    onkeydown={(e) => {
      const k = e.key.toLowerCase();
      if (k === 'escape' || k === 'enter' || k === ' ') {
        e.preventDefault();
        onClose();
      }
    }}
  ></div>
{/if}

{#if isOpen}
  <!-- Command Palette -->
  <div
    class="fixed top-[12%] left-1/2 -translate-x-1/2 w-full max-w-[560px] z-50"
    role="dialog"
    aria-modal="true"
    aria-label="Quick actions"
    tabindex="-1"
    onkeydown={handleContainerKeyDown}
    transition:fly={{ y: 6, duration: 200 }}
  >
    <div
      class="bg-background overflow-hidden"
      style="box-shadow: 0 0 0 1px rgba(0,0,0,0.04), 0 4px 24px rgba(0,0,0,0.12), 0 8px 48px rgba(0,0,0,0.08);"
      role="document"
      tabindex="-1"
    >
      <!-- Search Input -->
      <div class="flex items-center gap-2.5 px-3 h-10">
        <Fa icon={faSearch} class="text-[14px] text-foreground/30" />

        <input
          bind:this={inputRef}
          bind:value={searchQuery}
          onkeydown={handleKeyDown}
          type="text"
          placeholder="Type @ # > ~ / * to filter..."
          class="flex-1 bg-transparent outline-none text-[15px] text-foreground placeholder:text-foreground/35 focus:outline-none! focus:ring-0!"
          autocorrect="off"
          autocapitalize="off"
          spellcheck="false"
        />
        <div
          aria-live="polite"
          style="position:absolute;left:-9999px;top:auto;width:1px;height:1px;overflow:hidden;"
        >
          {searchResults.length} results
        </div>

        <kbd
          class="text-[11px] px-1.5 py-1 rounded-[5px] bg-foreground/6 text-foreground/40 font-medium border border-foreground/6"
        >
          ESC
        </kbd>
      </div>

      <!-- Divider -->
      <div class="h-px bg-foreground/[0.06]"></div>

      <!-- Results -->
      {#if searchResults.length > 0 || isLoadingFiles}
        <div class="max-h-[480px] overflow-y-auto py-1">
          {#each searchResults as item, index (item._idx !== undefined ? item._idx : `fallback-${index}`)}
            {#if item._borderAbove}
              <!-- Border above section -->
              <div class="h-px bg-foreground/[0.06] my-1.5"></div>
            {:else if item._newActionsRow}
              <!-- New Actions Row (horizontal pills) - no label -->
              <div class="px-3 py-1.5 flex gap-2 justify-between items-center">
                <!-- Left side: workspace-specific actions -->
                <div class="flex gap-2">
                  {#each searchResults.filter((r) => r._newAction && !r._newWorkspace) as action}
                    <button
                      class="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-foreground/[0.08]
                             bg-foreground/[0.02] hover:bg-foreground/[0.04] hover:border-foreground/[0.12]
                             transition-colors duration-100"
                      onclick={() => selectItem(action)}
                    >
                      <Fa icon={faPlus} class="text-[11px] text-foreground/40" />
                      <span class="text-[13px] font-medium text-foreground/70">
                        {action.label.replace('New ', '')}
                      </span>
                    </button>
                  {/each}
                </div>

                <!-- Right side: New Workspace -->
                {#each searchResults.filter((r) => r._newWorkspace) as wsAction}
                  <button
                    class="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-foreground/[0.08]
                           bg-foreground/[0.02] hover:bg-foreground/[0.04] hover:border-foreground/[0.12]
                           transition-colors duration-100"
                    onclick={() => selectItem(wsAction)}
                  >
                    <Fa icon={faPlus} class="text-[11px] text-foreground/40" />
                    <span class="text-[13px] font-medium text-foreground/70">
                      {wsAction.label.replace('New ', '')}
                    </span>
                  </button>
                {/each}
              </div>
            {:else if item._groupLabel}
              <!-- Group Label with shortcut key -->
              <div class="px-3 pt-2 pb-1 {index > 0 ? 'mt-0.5' : ''}">
                <div
                  class="flex items-center justify-between text-[11px] font-semibold text-foreground/40 uppercase tracking-wide"
                >
                  <span>{item._groupLabel}</span>
                  {#if item._shortcutKey}
                    <kbd
                      class="text-[10px] px-1.5 py-0.5 rounded bg-foreground/[0.04] text-foreground/30 font-mono normal-case"
                    >
                      {item._shortcutKey}
                    </kbd>
                  {/if}
                </div>
              </div>
            {:else if item._showMore}
              <!-- Show More Button -->
              <button
                class="w-full px-3 py-1.5 flex items-center justify-center gap-2 text-left transition-colors duration-50
                       hover:bg-foreground/[0.03]"
                onclick={() => selectItem(item)}
              >
                <span class="text-[13px] text-foreground/40">
                  Show {item._count} more {item._itemType}s...
                </span>
              </button>
            {:else if !item._newAction}
              <!-- Regular Item -->
              <button
                class="w-full px-3 py-1.5 flex items-start gap-3 text-left transition-colors duration-50
                       {selectedIndex === index
                  ? 'bg-foreground/[0.04]'
                  : 'hover:bg-foreground/[0.03]'}"
                onclick={() => selectItem(item)}
                onmouseenter={() => (selectedIndex = index)}
              >
                <!-- Icon or Avatar -->
                {#if item.type === 'agent'}
                  <div class="flex-none mt-0.5">
                    <AuggieAvatar faceSeed={item.id} colorSeed={item.id} size={18} />
                  </div>
                {:else}
                  <Fa icon={item.icon} class="text-[15px] text-foreground/25 flex-none mt-0.5" />
                {/if}

                <div class="flex-1 min-w-0 flex flex-col gap-0.5">
                  <!-- First line: label and time -->
                  <div class="flex items-center gap-2.5">
                    <span class="text-[14px] font-medium text-foreground/80 truncate"
                      >{item.label}</span
                    >
                    {#if item._time}
                      <span class="text-[11px] text-foreground/30 flex-none ml-auto"
                        >{item._time}</span
                      >
                    {/if}
                  </div>

                  <!-- Second line: description or breadcrumbs -->
                  {#if item.description || item.breadcrumbs || item.path}
                    <div class="text-[12px] text-foreground/40 truncate">
                      {#if item.type === 'note' && item.breadcrumbs}
                        {item.breadcrumbs}
                      {:else if item.type === 'change' || item.type === 'file'}
                        <span class="text-foreground/35">{item.path || item.description}</span>
                      {:else}
                        {item.description}
                      {/if}
                    </div>
                  {/if}
                </div>

                {#if item.shortcut}
                  <kbd
                    class="text-[11px] px-1.5 py-0.5 rounded-[4px] bg-foreground/[0.05] text-foreground/35 font-medium"
                  >
                    {item.shortcut}
                  </kbd>
                {/if}

                {#if selectedIndex === index && !item._groupLabel}
                  <span class="text-foreground/25 text-[13px]">↵</span>
                {/if}
              </button>
            {/if}
          {/each}

          <!-- Loading skeletons for files -->
          {#if isLoadingFiles && workspaceId}
            {#each Array(3) as _, i}
              <div class="w-full px-3 h-[32px] flex items-center gap-3">
                <Skeleton class="w-4 h-4 rounded flex-none" />
                <Skeleton class="h-4 rounded" style="width: {100 + i * 40}px;" />
              </div>
            {/each}
          {/if}
        </div>
      {:else if searchQuery && !isLoadingFiles}
        <div class="px-3 py-6 text-center">
          <p class="text-[13px] text-foreground/35">No results found for "{searchQuery}"</p>
        </div>
      {:else if !searchQuery}
        <div class="px-3 py-6 text-center">
          <p class="text-[13px] text-foreground/30">Start typing to search...</p>
        </div>
      {/if}

      <!-- Footer -->
      <div class="h-px bg-foreground/[0.05]"></div>
      <div class="px-3 h-[30px] flex items-center gap-5 text-[11px] text-foreground/35">
        <span class="flex items-center gap-1.5">
          <kbd
            class="px-1.5 py-0.5 rounded-[4px] bg-foreground/[0.04] text-foreground/40 font-medium"
            >↑↓</kbd
          >
          <span>Navigate</span>
        </span>
        <span class="flex items-center gap-1.5">
          <kbd
            class="px-1.5 py-0.5 rounded-[4px] bg-foreground/[0.04] text-foreground/40 font-medium"
            >↵</kbd
          >
          <span>Select</span>
        </span>
        <span class="flex items-center gap-1.5">
          <kbd
            class="px-1.5 py-0.5 rounded-[4px] bg-foreground/[0.04] text-foreground/40 font-medium"
            >ESC</kbd
          >
          <span>Close</span>
        </span>
      </div>
    </div>
  </div>
{/if}
