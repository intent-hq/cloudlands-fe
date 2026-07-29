<script lang="ts">
  /**
   * Global Modal Command Palette (Cmd/Ctrl+K)
   *
   * App-wide palette for commands, files, workspace search, notes and headings.
   * This is the app-wide palette, not the inline slash-command suggester used
   * in text inputs.
   */
  import {
  onMount,
  untrack,
} from 'svelte';
  import { writable } from 'svelte/store';
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
  faPlay,
} from '@fortawesome/free-solid-svg-icons';
  import { backendRequest } from '$lib/client/live/backend-transport';
  import { createLogger } from '$lib/utils/client-logger';
  import { m } from '$shared/paraglide/messages.js';

  import { selectBrowserRecentUrls } from '$store/renderer/slices/browser/browser-selectors';
  import { initBrowserWorkspace } from '$store/renderer/slices/browser/browser-slice';
  import { selectWorkspaceItems } from '$store/renderer/slices/workspace/workspace-selectors';
  import { createAgentRequested } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
  import { createTerminalRequested } from '$store/renderer/slices/terminals/terminals-slice';
  import { createNoteRequested } from '$store/renderer/slices/note-read-tracking/note-read-tracking-slice';
  import { dispatchWindowEvent } from '$lib/utils/window-events';
  import {
  openWorkspaceBrowser,
  openWorkspaceNote,
} from '$store/renderer/slices/workspace-navigation/workspace-navigation-slice';
  import {
  commandPaletteNewFileRequested,
  openAgentTabRequested,
  openTerminalTabRequested,
} from '$store/renderer/slices/app-layout/app-layout-slice';
  import { resetOnboarding } from '$store/renderer/slices/onboarding/onboarding-slice';
  import { setShowCreateModal } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
  import {
  type WorkspaceObject,
  type WorkspaceObjectType,
  FILTER_PREFIXES,
  fuzzyScore,
  formatRelativeTime,
  parseQueryFilter,
  buildNoteBreadcrumbs,
  buildRecentItems,
} from '$store/renderer/slices/command-palette/command-palette-utils';
  import {
  recordPaletteFileMru,
  recordPaletteMruItem,
} from '$store/renderer/slices/palette/palette-slice';
  import {
  selectPaletteFileMru,
  selectPaletteMruEntries,
} from '$store/renderer/slices/palette/palette-selectors';
  import { computeResults } from '$store/renderer/slices/command-palette/command-palette-results';
  import { Skeleton } from './ui/skeleton';
  import { selectAllWorkspaceAgents } from '$store/renderer/slices/workspace-agents/workspace-agents-selectors';
  import { selectAllNotes } from '$store/renderer/slices/workspace-notes/workspace-notes-selectors';
  import { selectCurrentChanges } from '$store/renderer/slices/changes/changes-selectors';
  import { terminalManager } from '$features/terminal/terminal-manager.svelte';
  import { terminalHistoryTracker } from '$features/terminal/terminal-history-tracker';
  import AuggieAvatar from '$lib/components/ui/auggie-avatar/AuggieAvatar.svelte';
  import { extractContentFromBlocks } from '$shared/types/agent-message.conversion';
  import {
  compareWorkspaceActivityDisplayTimeDesc,
  getWorkspaceActivityDisplayTime,
} from '$shared/utils/workspace-activity-time';
  import { store as appStore } from '$store/renderer/store';

  const logger = createLogger('CommandPalette');

  interface Props {
    isOpen: boolean;
    initialQuery?: string;
    workspaceId?: string;
    onClose: () => void;
    /** Callback when a file is selected. Includes openInAdjacentPanel for cmd+Enter support. */
    onSelectFile?: (detail: { path: string; line?: number; openInAdjacentPanel?: boolean }) => void;
  }

  let {
    isOpen = $bindable(false),
    initialQuery = '',
    workspaceId,
    onClose,
    onSelectFile,
  }: Props = $props();

  const workspaceIdStore = writable('');
  $effect(() => {
    workspaceIdStore.set(workspaceId ?? '');
  });

  let searchQuery = $state('');
  const workspaceItems = selectWorkspaceItems();
  const currentChanges$ = selectCurrentChanges();
  const workspaceAgents$ = selectAllWorkspaceAgents(workspaceIdStore);
  const allNotes$ = selectAllNotes(workspaceIdStore);
  const browserRecentUrls$ = selectBrowserRecentUrls(workspaceIdStore);
  let selectedIndex = $state(0);
  let searchResults: any[] = $state([]);
  const paletteMruEntries$ = selectPaletteMruEntries();
  const paletteFileMru$ = selectPaletteFileMru();
  let inputRef: HTMLInputElement | undefined = $state(undefined);
  let isLoadingFiles = $state(false);
  let activeFilter: WorkspaceObjectType | 'workspace' | null = $state(null); // Filter by type

  // Derived: parse search query for filter prefix (uses extracted pure function)
  let parsedQuery = $derived(parseQueryFilter(searchQuery));

  // Go to Line mode: detect when query starts with ':'
  let isGoToLineMode = $derived(searchQuery.trimStart().startsWith(':'));
  let goToLineNumber = $derived.by(() => {
    if (!isGoToLineMode) return null;
    const num = parseInt(searchQuery.trimStart().slice(1).trim(), 10);
    return Number.isNaN(num) ? null : num;
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
  let agents: WorkspaceObject[] = $derived.by(() => {
    if (!workspaceId) return [];

    return $workspaceAgents$
      .filter((s) => !s.id?.startsWith('terminal-'))
      .map((s) => {
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
          label: s.name || m.lib_commandPalette_untitledAgent_fallback(),
          description,
          icon: faCommentDots,
          timestamp: new Date(s.updatedAt || s.createdAt).getTime(),
          _time: formatRelativeTime(s.updatedAt || s.createdAt),
        };
      })
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  });
  let notes: WorkspaceObject[] = $derived.by(() => {
    const activeNotes = $allNotes$.filter((n) => !n.isArchived);

    return activeNotes
      .map((n) => ({
        id: n.id,
        type: 'note' as const,
        label: n.title,
        description: n.tags?.join(', '),
        breadcrumbs: buildNoteBreadcrumbs(n, activeNotes),
        icon: faFileAlt,
        timestamp: new Date(n.updatedAt).getTime(),
        _time: formatRelativeTime(n.updatedAt),
      }))
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  });
  let changes: WorkspaceObject[] = $derived.by(() => {
    if (!workspaceId) return [];

    return $currentChanges$.slice(0, 10).map((c) => ({
      id: c.id,
      type: 'change' as const,
      label: c.relativePath.split('/').pop() || c.relativePath,
      description: `+${c.stats.additions || 0} -${c.stats.deletions || 0}`,
      icon: faCodeBranch,
      path: c.relativePath,
      timestamp: new Date(c.attribution.timestamp).getTime(),
      _time: formatRelativeTime(new Date(c.attribution.timestamp).toISOString()),
    }));
  });
  let terminals: WorkspaceObject[] = $state([]);
  let browserUrls: WorkspaceObject[] = $derived.by(() =>
    $browserRecentUrls$.map((url) => {
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
    }),
  );
  let recentItems: WorkspaceObject[] = $derived(
    workspaceId
      ? buildRecentItems([...agents, ...notes, ...changes, ...terminals, ...browserUrls], $paletteMruEntries$)
      : [],
  );

  // Commands available in command mode
  const commands = [
    {
      id: 'new-workspace',
      get label() {
        return m.lib_commandPalette_newWorkspace_command();
      },
      get pillLabel() {
        return m.lib_commandPalette_workspace_pill();
      },
      icon: faFolderOpen,
      shortcut: '⌘T',
    },
    {
      id: 'settings',
      get label() {
        return m.lib_commandPalette_settings_command();
      },
      icon: faCog,
      shortcut: '⌘,',
    },
    {
      id: 'new-agent',
      get label() {
        return m.lib_commandPalette_newAgentChat_command();
      },
      get pillLabel() {
        return m.lib_commandPalette_agentChat_pill();
      },
      icon: faCommentDots,
    },
    {
      id: 'new-terminal',
      get label() {
        return m.lib_commandPalette_newTerminal_command();
      },
      get pillLabel() {
        return m.lib_commandPalette_terminal_pill();
      },
      icon: faTerminal,
    },
    {
      id: 'new-note',
      get label() {
        return m.lib_commandPalette_newNote_command();
      },
      get pillLabel() {
        return m.lib_commandPalette_note_pill();
      },
      icon: faFileAlt,
    },
    {
      id: 'new-file',
      get label() {
        return m.lib_commandPalette_newFile_command();
      },
      get pillLabel() {
        return m.lib_commandPalette_file_pill();
      },
      icon: faFile,
      shortcut: '⌘N',
    },
    {
      id: 'open-url',
      get label() {
        return m.lib_commandPalette_openUrl_command();
      },
      icon: faGlobe,
    },
    {
      id: 'show-onboarding',
      get label() {
        return m.lib_commandPalette_showOnboarding_command();
      },
      icon: faPlay,
    },
  ];

  // Localized "Show N more …" labels per palette item type.
  function showMoreLabel(count: number, itemType: string): string {
    switch (itemType) {
      case 'agent':
        return m.lib_commandPalette_showMoreAgents_label({ count });
      case 'note':
        return m.lib_commandPalette_showMoreNotes_label({ count });
      case 'change':
        return m.lib_commandPalette_showMoreChanges_label({ count });
      case 'terminal':
        return m.lib_commandPalette_showMoreTerminals_label({ count });
      case 'browser':
        return m.lib_commandPalette_showMoreBrowsers_label({ count });
      default:
        return m.lib_commandPalette_showMoreFiles_label({ count });
    }
  }

  // MRU, formatRelativeTime, buildNoteBreadcrumbs, fuzzyScore, parseQueryFilter,
  // FILTER_PREFIXES, and WorkspaceObject types are now imported from
  // '$store/renderer/slices/command-palette/command-palette-utils'

  // Load workspace objects when workspace changes
  $effect(() => {
    if (!workspaceId) {
      untrack(() => {
        terminals = [];
      });
      return;
    }

    // Capture workspaceId to use in callbacks (avoids reactive reads in async contexts)
    const wsId = workspaceId;

    // Initialize browser store for this workspace (untracked to avoid triggering effects)
    untrack(() => {
      appStore.dispatch(initBrowserWorkspace(wsId));
    });

    // Load non-Redux terminal metadata for this workspace.
    untrack(() => {
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
            label: t.title || m.terminal_quakeOverlay_terminal_fallback(),
            description,
            icon: faTerminal,
            timestamp: new Date(t.createdAt).getTime(),
            _time: formatRelativeTime(t.createdAt),
          };
        })
        .sort((a: any, b: any) => (b.timestamp || 0) - (a.timestamp || 0));
    });
  });

  // fuzzyScore is now imported from command-palette-utils

  // Grouped results state (only files need async loading)
  let groupFiles: any[] = $state([]);

  // Daemon helper to query files (search.fileNames, PROTOCOL §5.15) and map to palette items (with fuzzy/MRU)
  async function queryFiles(pattern: string): Promise<any[]> {
    if (!workspaceId) return [];
    try {
      const resp = await backendRequest<{ files?: string[] }>('search.fileNames', {
        workspaceId,
        pattern: (pattern || '').trim(),
        limit: 50,
      });
      const files = Array.isArray(resp?.files) ? resp.files : [];
      const mapped = files.map((path: string) => ({
        id: path,
        label: path.split('/').pop() ?? path,
        path,
        icon: faFile,
        description: path,
      }));
      const q = (pattern || '').trim();
      if (q) {
        const mru = getMRUMap();
        return (
          (mapped as any[])
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
            .slice(0, 8)
        );
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

    // Clear any pending debounce timer and invalidate in-flight requests first,
    // including when switching into Go to Line mode.
    if (fileQueryTimeout) {
      clearTimeout(fileQueryTimeout);
      fileQueryTimeout = null;
    }
    const requestId = ++currentFileRequestId;

    // Skip file queries in Go to Line mode
    if (q.startsWith(':')) {
      untrack(() => {
        groupFiles = [];
        isLoadingFiles = false;
      });
      return;
    }

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
      } catch {
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

  // computeResults is now imported from command-palette-results.
  // This wrapper bridges component state to the pure function's input interface.
  function buildResults(q: string, files: any[]) {
    const wsItems = ($workspaceItems || [])
      .filter((w: any) => w.id !== workspaceId)
      .sort(compareWorkspaceActivityDisplayTimeDesc)
      .map((w: any) => {
        const activityTime = getWorkspaceActivityDisplayTime(w);
        return {
          id: w.id,
          label: w.title || w.id,
          icon: faFolderOpen,
          description: w.repositoryPath
            ? w.repositoryPath.split('/').pop() || w.repositoryPath
            : undefined,
          _workspace: true as const,
          _time: activityTime > 0 ? formatRelativeTime(new Date(activityTime)) : '',
        };
      });

    return computeResults({
      query: q,
      activeFilter,
      workspaceId,
      agents,
      notes,
      changes,
      terminals,
      browserUrls,
      recentItems,
      files,
      commands,
      workspaceItems: wsItems,
    });
  }

  // PERF: Debounce timer for rapid typing
  let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  const SEARCH_DEBOUNCE_MS = 16; // ~1 frame, prevents excessive RAF calls during fast typing

  // Recompute flat results - debounced and deferred via RAF to not block typing
  $effect(() => {
    // Use the parsed search term (with prefix stripped)
    const q = parsedQuery.searchTerm;
    // Skip result computation in Go to Line mode
    if ((searchQuery || '').trimStart().startsWith(':')) {
      // Cancel any pending debounce/RAF from a previous non-GoToLine query
      if (resultComputeRaf !== null) {
        cancelAnimationFrame(resultComputeRaf);
        resultComputeRaf = null;
      }
      if (searchDebounceTimer !== null) {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = null;
      }
      untrack(() => {
        searchResults = [];
      });
      return;
    }
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
        const flat = buildResults(q, files);
        // Use untrack for all state updates to avoid effect loops
        untrack(() => {
          searchResults = flat;
          // Keep selection on an actionable item.
          const currentIdx = Math.max(0, Math.min(selectedIndex, flat.length - 1));
          const nextSelectableIdx = findSelectableIndex(flat, currentIdx, 1);
          const prevSelectableIdx = findSelectableIndex(flat, currentIdx, -1);
          const resolvedIdx = nextSelectableIdx !== -1 ? nextSelectableIdx : prevSelectableIdx;

          if (resolvedIdx !== -1 && resolvedIdx !== selectedIndex) {
            selectedIndex = resolvedIdx;
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
    return new Map(Object.entries($paletteFileMru$));
  }

  function recordMRUFile(path: string) {
    appStore.dispatch(recordPaletteFileMru(path, Date.now()));
  }

  function rankByMRU<T extends { path?: string }>(items: T[]): T[] {
    const map = getMRUMap();
    return items.slice().sort((a, b) => {
      const ta = a.path ? map.get(a.path) || 0 : 0;
      const tb = b.path ? map.get(b.path) || 0 : 0;
      return tb - ta;
    });
  }

  function isSelectableResult(item: any): boolean {
    return (
      Boolean(item) &&
      !item._groupLabel &&
      !item._newActionsRow &&
      !item._borderAbove &&
      !item._showMore
    );
  }

  function findSelectableIndex(items: any[], startIndex: number, direction: 1 | -1): number {
    for (let index = startIndex; index >= 0 && index < items.length; index += direction) {
      if (isSelectableResult(items[index])) {
        return index;
      }
    }

    return -1;
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
      if (isGoToLineMode) return;
      const nextIndex = findSelectableIndex(searchResults, selectedIndex + 1, 1);
      if (nextIndex !== -1) {
        selectedIndex = nextIndex;
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (isGoToLineMode) return;
      const prevIndex = findSelectableIndex(searchResults, selectedIndex - 1, -1);
      if (prevIndex !== -1) {
        selectedIndex = prevIndex;
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      // Handle Go to Line mode
      if (isGoToLineMode) {
        if (goToLineNumber != null && goToLineNumber > 0) {
          dispatchWindowEvent('workspace:go-to-line', { line: goToLineNumber });
          onClose?.();
        }
        return;
      }
      // Cmd+Enter opens in adjacent panel
      const openInAdjacentPanel = e.metaKey || e.ctrlKey;
      const selectedItem = searchResults[selectedIndex];
      if (isSelectableResult(selectedItem)) {
        selectItem(selectedItem, { openInAdjacentPanel });
      }
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

    let shouldClose = true;

    // Handle workspace objects
    if (item.type) {
      appStore.dispatch(recordPaletteMruItem(item.type, item.id, Date.now()));

      switch (item.type) {
        case 'agent':
          if (workspaceId) {
            appStore.dispatch(
              openAgentTabRequested(workspaceId, { agentId: item.id, openInAdjacentPanel }),
            );
          }
          break;
        case 'note':
          if (workspaceId) {
            appStore.dispatch(
              openWorkspaceNote(workspaceId, item.id, { openInAdjacentPanel }),
            );
          }
          break;
        case 'change':
          if (item.path) {
            onSelectFile?.({ path: item.path, openInAdjacentPanel });
          }
          break;
        case 'terminal':
          if (workspaceId) {
            appStore.dispatch(
              openTerminalTabRequested(workspaceId, { terminalId: item.id }),
            );
          }
          break;
        case 'browser':
          if (item.url && workspaceId) {
            appStore.dispatch(openWorkspaceBrowser(workspaceId, item.url));
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
        appStore.dispatch(setShowCreateModal(true));
        return true;
      case 'settings':
        navigateToSettings();
        return true;
      case 'new-agent':
        if (workspaceId) {
          appStore.dispatch(createAgentRequested(workspaceId));
        }
        return true;
      case 'new-terminal':
        if (workspaceId) {
          appStore.dispatch(createTerminalRequested(workspaceId));
        }
        return true;
      case 'new-note':
        if (workspaceId) {
          appStore.dispatch(createNoteRequested(workspaceId));
        }
        return true;
      case 'new-file':
        if (workspaceId) {
          appStore.dispatch(commandPaletteNewFileRequested(workspaceId));
        }
        return true;
      case 'open-url':
        // Open a browser panel with default URL
        if (workspaceId) {
          appStore.dispatch(openWorkspaceBrowser(workspaceId, 'about:blank'));
        }
        return true;
      case 'show-onboarding':
        appStore.dispatch(resetOnboarding());
        goto('/workspace/new');
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

  // Main open/init effect — initialQuery read inside untrack to avoid reactive dependency
  $effect(() => {
    if (isOpen && inputRef) {
      inputRef.focus();
      untrack(() => {
        searchQuery = initialQuery || '';
        groupFiles = [];
        isLoadingFiles = false;
      });
    }
  });

  // Separate effect: propagate initialQuery changes while palette is already open
  // (e.g. user presses Cmd+G while palette is open with a search query)
  let prevInitialQuery = '';
  $effect(() => {
    // Read isOpen first — when closed, read initialQuery inside untrack()
    // to avoid creating a reactive dependency that re-runs this effect on
    // every parent re-render (e.g. during Vite HMR).
    if (!isOpen) {
      untrack(() => {
        prevInitialQuery = initialQuery || '';
      });
      return;
    }
    const currentInitialQuery = initialQuery || '';
    if (currentInitialQuery !== prevInitialQuery) {
      prevInitialQuery = currentInitialQuery;
      // Only update searchQuery if the initialQuery actually changed to a non-empty value
      if (currentInitialQuery !== '') {
        untrack(() => {
          searchQuery = currentInitialQuery;
        });
      }
    }
  });
</script>

{#if isOpen}
  <!-- Backdrop -->
  <div
    class="fixed inset-0 z-50 bg-black/15 cursor-pointer"
    role="button"
    aria-label={m.lib_commandPalette_close_ariaLabel()}
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
    aria-label={m.lib_commandPalette_quickActions_ariaLabel()}
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
          placeholder={isGoToLineMode
            ? m.lib_commandPalette_goToLine_placeholder()
            : m.lib_commandPalette_filter_placeholder()}
          class="flex-1 bg-transparent outline-none text-[15px] text-foreground placeholder:text-foreground/35 focus:outline-none! focus:ring-0!"
          autocorrect="off"
          autocapitalize="off"
          spellcheck="false"
        />
        <div
          aria-live="polite"
          style="position:absolute;left:-9999px;top:auto;width:1px;height:1px;overflow:hidden;"
        >
          {m.lib_commandPalette_resultsCount_status({ count: searchResults.length })}
        </div>

        <kbd
          class="text-ui px-1.5 py-1 rounded-[5px] bg-foreground/6 text-subtle font-medium border border-foreground/6"
        >
          {m.lib_commandPalette_esc_label()}
        </kbd>
      </div>

      <!-- Divider -->
      <div class="h-px bg-foreground/[0.06]"></div>

      <!-- Go to Line mode -->
      {#if isGoToLineMode}
        <div class="max-h-[480px] overflow-y-auto py-1">
          <div class="px-3 py-2">
            {#if goToLineNumber != null && goToLineNumber > 0}
              <button
                class="w-full px-3 py-2 flex items-center gap-3 text-left rounded-md bg-foreground/[0.04] hover:bg-foreground/[0.06] transition-colors duration-50"
                onclick={() => {
                  if (goToLineNumber != null && goToLineNumber > 0) {
                    dispatchWindowEvent('workspace:go-to-line', { line: goToLineNumber });
                  }
                  onClose?.();
                }}
              >
                <span class="text-[14px] font-medium text-foreground"
                  >{m.lib_commandPalette_goToLine_label({ line: goToLineNumber })}</span
                >
              </button>
            {:else}
              <p class="text-[13px] text-subtle px-3">{m.lib_commandPalette_invalidLine_message()}</p>
            {/if}
          </div>
        </div>
        <!-- Results -->
      {:else if searchResults.length > 0 || isLoadingFiles}
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
                      class="flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-colors duration-100
                             {selectedIndex === action._idx
                        ? 'border-foreground/[0.12] bg-foreground/[0.04]'
                        : 'border-foreground/[0.08] bg-foreground/[0.02] hover:bg-foreground/[0.04] hover:border-foreground/[0.12]'}"
                      onclick={() => selectItem(action)}
                      onmouseenter={() => (selectedIndex = action._idx)}
                    >
                      <Fa icon={faPlus} class="text-ui text-subtle" />
                      <span class="text-[13px] font-medium text-subtle">
                        {action.pillLabel ?? action.label}
                      </span>
                    </button>
                  {/each}
                </div>

                <!-- Right side: New Workspace -->
                {#each searchResults.filter((r) => r._newWorkspace) as wsAction}
                  <button
                    class="flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-colors duration-100
                           {selectedIndex === wsAction._idx
                      ? 'border-foreground/[0.12] bg-foreground/[0.04]'
                      : 'border-foreground/[0.08] bg-foreground/[0.02] hover:bg-foreground/[0.04] hover:border-foreground/[0.12]'}"
                    onclick={() => selectItem(wsAction)}
                    onmouseenter={() => (selectedIndex = wsAction._idx)}
                  >
                    <Fa icon={faPlus} class="text-ui text-subtle" />
                    <span class="text-[13px] font-medium text-subtle">
                      {wsAction.pillLabel ?? wsAction.label}
                    </span>
                  </button>
                {/each}
              </div>
            {:else if item._groupLabel}
              <!-- Group Label with shortcut key -->
              <div class="px-3 pt-2 pb-1 {index > 0 ? 'mt-0.5' : ''}">
                <div
                  class="flex items-center justify-between text-ui font-semibold text-muted-foreground uppercase tracking-wide"
                >
                  <span>{item._groupLabel}</span>
                  {#if item._shortcutKey}
                    <kbd
                      class="text-ui px-1.5 py-0.5 rounded bg-foreground/[0.04] text-foreground/30 font-mono normal-case"
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
                <span class="text-[13px] text-subtle">
                  {showMoreLabel(item._count, item._itemType)}
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
                    <AuggieAvatar agentId={item.id} size={18} />
                  </div>
                {:else}
                  <Fa icon={item.icon} class="text-[15px] text-foreground/25 flex-none mt-0.5" />
                {/if}

                <div class="flex-1 min-w-0 flex flex-col gap-0.5">
                  <!-- First line: label and time -->
                  <div class="flex items-center gap-2.5">
                    <span class="text-[14px] font-medium text-foreground truncate"
                      >{item.label}</span
                    >
                    {#if item._time}
                      <span class="text-ui text-subtle flex-none ml-auto">{item._time}</span>
                    {/if}
                  </div>

                  <!-- Second line: description or breadcrumbs -->
                  {#if item.description || item.breadcrumbs || item.path}
                    <div class="text-xs text-subtle truncate">
                      {#if item.type === 'note' && item.breadcrumbs}
                        {item.breadcrumbs}
                      {:else if item.type === 'change' || item.type === 'file'}
                        <span class="text-subtle">{item.path || item.description}</span>
                      {:else}
                        {item.description}
                      {/if}
                    </div>
                  {/if}
                </div>

                {#if item.shortcut}
                  <kbd
                    class="text-ui px-1.5 py-0.5 rounded-[4px] bg-foreground/[0.05] text-foreground/35 font-medium"
                  >
                    {item.shortcut}
                  </kbd>
                {/if}

                {#if selectedIndex === index && !item._groupLabel}
                  <span class="text-subtle text-[13px]">↵</span>
                {/if}
              </button>
            {/if}
          {/each}

          <!-- Loading skeletons for files -->
          {#if isLoadingFiles && workspaceId}
            {#each [0, 1, 2] as i}
              <div class="w-full px-3 h-[32px] flex items-center gap-3">
                <Skeleton class="w-4 h-4 rounded flex-none" />
                <Skeleton class="h-4 rounded" style="width: {100 + i * 40}px;" />
              </div>
            {/each}
          {/if}
        </div>
      {:else if searchQuery && !isLoadingFiles}
        <div class="px-3 py-6 text-center">
          <p class="text-[13px] text-subtle">{m.lib_commandPalette_noResults_message({ query: searchQuery })}</p>
        </div>
      {:else if !searchQuery}
        <div class="px-3 py-6 text-center">
          <p class="text-[13px] text-subtle">{m.lib_commandPalette_startTyping_message()}</p>
        </div>
      {/if}

      <!-- Footer -->
      <div class="h-px bg-foreground/[0.05]"></div>
      <div class="px-3 h-[30px] flex items-center gap-5 text-ui text-subtle">
        <span class="flex items-center gap-1.5">
          <kbd class="px-1.5 py-0.5 rounded-[4px] bg-foreground/[0.04] text-subtle font-medium"
            >↑↓</kbd
          >
          <span>{m.lib_commandPalette_navigate_label()}</span>
        </span>
        <span class="flex items-center gap-1.5">
          <kbd class="px-1.5 py-0.5 rounded-[4px] bg-foreground/[0.04] text-subtle font-medium"
            >↵</kbd
          >
          <span>{m.lib_commandPalette_select_label()}</span>
        </span>
        <span class="flex items-center gap-1.5">
          <kbd class="px-1.5 py-0.5 rounded-[4px] bg-foreground/[0.04] text-subtle font-medium"
            >{m.lib_commandPalette_esc_label()}</kbd
          >
          <span>{m.lib_commandPalette_footerClose_label()}</span>
        </span>
      </div>
    </div>
  </div>
{/if}
