<script lang="ts">
  import { openDevConsole } from '$features/dev-console/dev-console-client';
  import { selectWorkspaceCreationVisible } from '$store/renderer/slices/principal/principal-selectors';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { ActionRow } from '$lib/components/ui/menu';
  import { EmptyState } from '$lib/components/patterns/screen';
  import { ShortcutChip } from '$lib/components/ui/kbd';
  /** App-wide palette for commands, files, workspace search, notes and headings. */
  import { onMount, tick, untrack } from 'svelte';
  import { writable } from 'svelte/store';
  import { goto } from '$app/navigation';
  import { fly } from '$lib/motion';
  import { navigateToSettings } from '$lib/utils/workspace-navigation';
  import Fa from 'svelte-fa';
  import {
    faSearch,
    faFile,
    faFolderOpen,
    faTerminal,
    faCommentDots,
    faFileAlt,
    faCodeBranch,
    faGlobe,
  } from '@fortawesome/free-solid-svg-icons';
  import { backendRequest } from '$lib/client/live/backend-transport';
  import { openMessage } from '$lib/utils/open-message';
  import { createNoteQuery, type NoteQueryUpdate } from '$lib/utils/palette-note-search';
  import { openPaletteNote } from '$lib/utils/palette-note-navigation';
  import { createTranscriptQuery } from '$lib/utils/palette-transcript-search';
  import { createLogger } from '$lib/utils/client-logger';
  import { m } from '$shared/paraglide/messages.js';
  import { isCmdClickModifier } from '$shared/utils/link-helpers';
  import { selectBrowserRecentUrls } from '$store/renderer/slices/browser/browser-selectors';
  import {
    selectLabsGitLabEnabled,
    selectLabsRemoteAgentsEnabled,
    selectLabsMultiplayerEnabled,
  } from '$store/renderer/slices/user-preferences/user-preferences-selectors';
  import {
    setLabsGitLabEnabled,
    setLabsRemoteAgentsEnabled,
    setLabsMultiplayerEnabled,
  } from '$store/renderer/slices/user-preferences/user-preferences-slice';
  import { initBrowserWorkspace } from '$store/renderer/slices/browser/browser-slice';
  import {
    selectHidesAgentLifecycleActions,
    selectIsWorkspaceCollaborator,
    selectWorkspaceItems,
  } from '$store/renderer/slices/workspace/workspace-selectors';
  import { createAgentRequested } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
  import { createTerminalRequested } from '$store/renderer/slices/terminals/terminals-slice';
  import { createNoteRequested } from '$store/renderer/slices/note-read-tracking/note-read-tracking-slice';
  import { dispatchWindowEvent } from '$lib/utils/window-events';
  import { invoke } from '$lib/electron-bridge';
  import { IPC_CHANNELS } from '$shared/ipc-registry';
  import { openWorkspaceBrowser } from '$store/renderer/slices/workspace-navigation/workspace-navigation-slice';
  import {
    commandPaletteNewFileRequested,
    openAgentTabRequested,
  } from '$store/renderer/slices/app-layout/app-layout-slice';
  import { openTab } from '$store/renderer/slices/panel-layout/panel-layout-slice';
  import {
    resetOnboarding,
    setOnboardingFullFlowRequested,
  } from '$store/renderer/slices/onboarding/onboarding-slice';
  import {
    setShowCreateModal,
    setStatsOverlayOpen,
  } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
  import {
    type WorkspaceObject,
    FILTER_PREFIXES,
    fuzzyScore,
    formatRelativeTime,
    parseQueryFilter,
    buildNoteBreadcrumbs,
    buildMessageTitleSegments,
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
  import CommandPaletteItemTitle from './CommandPaletteItemTitle.svelte';
  import CommandPaletteFilters from './CommandPaletteFilters.svelte';
  import { COMMAND_PALETTE_COMMANDS } from './command-palette-commands';
  import IntentNavigationIcon from '$lib/icons/IntentNavigationIcon.svelte';
  import { selectAllWorkspaceAgents } from '$store/renderer/slices/workspace-agents/workspace-agents-selectors';
  import { selectAllNotes } from '$store/renderer/slices/workspace-notes/workspace-notes-selectors';
  import { selectCurrentChanges } from '$store/renderer/slices/changes/changes-selectors';
  import { terminalManager } from '$features/terminal/terminal-manager.svelte';
  import { terminalHistoryTracker } from '$features/terminal/terminal-history-tracker';
  import AgentAvatar from '$features/agent/components/agent-avatar/AgentAvatar.svelte';
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
  const labsMultiplayerEnabled$ = selectLabsMultiplayerEnabled();
  const labsGitLabEnabled$ = selectLabsGitLabEnabled();
  const labsRemoteAgentsEnabled$ = selectLabsRemoteAgentsEnabled();
  // Collaborators (multiplayer w3) are refused on terminal + browser methods and
  // cannot create workspaces, so those commands and result groups are withheld.
  const isCollaborator$ = selectIsWorkspaceCollaborator(workspaceIdStore);
  const canCreate$ = selectWorkspaceCreationVisible();
  // Agent create is likewise refused (-32003) for a collaborator connection.
  const hidesAgentLifecycleActions$ = selectHidesAgentLifecycleActions(workspaceIdStore);
  const WORKSPACE_OWNER_ONLY_COMMAND_IDS: ReadonlySet<string> = new Set([
    'new-terminal',
    'open-url',
  ]);
  const commands = $derived(
    COMMAND_PALETTE_COMMANDS.filter(
      (command) =>
        !($isCollaborator$ && WORKSPACE_OWNER_ONLY_COMMAND_IDS.has(command.id)) &&
        !($hidesAgentLifecycleActions$ && command.id === 'new-agent') &&
        !(!$canCreate$ && command.id === 'new-workspace') &&
        !($labsMultiplayerEnabled$ && command.id === 'enable-experimental-multiplayer') &&
        !(!$labsMultiplayerEnabled$ && command.id === 'disable-experimental-multiplayer') &&
        !($labsGitLabEnabled$ && command.id === 'enable-experimental-gitlab') &&
        !(!$labsGitLabEnabled$ && command.id === 'disable-experimental-gitlab') &&
        !($labsRemoteAgentsEnabled$ && command.id === 'enable-experimental-remote-agents') &&
        !(!$labsRemoteAgentsEnabled$ && command.id === 'disable-experimental-remote-agents'),
    ),
  );
  const currentChanges$ = selectCurrentChanges(workspaceIdStore);
  const workspaceAgents$ = selectAllWorkspaceAgents(workspaceIdStore);
  const allNotes$ = selectAllNotes(workspaceIdStore);
  const browserRecentUrls$ = selectBrowserRecentUrls(workspaceIdStore);
  let selectedIndex = $state(0);
  let searchResults: any[] = $state([]);
  const paletteMruEntries$ = selectPaletteMruEntries();
  const paletteFileMru$ = selectPaletteFileMru();
  let inputRef: HTMLInputElement | undefined = $state(undefined);
  let resultsRef: HTMLDivElement | undefined = $state(undefined);
  let isLoadingFiles = $state(false);
  let parsedQuery = $derived(parseQueryFilter(searchQuery));
  let activeFilter = $derived(parsedQuery.filter);
  let filtersRef: { cycle: (direction: 1 | -1) => void } | undefined = $state();
  const resultCount = $derived(searchResults.filter(isSelectableResult).length);

  function applyFilter(prefix: string) {
    searchQuery = prefix + parsedQuery.searchTerm;
    selectedIndex = 0;
    resultsRef?.scrollTo?.({ top: 0 });
    void tick().then(() => inputRef?.focus());
  }

  let isGoToLineMode = $derived(searchQuery.trimStart().startsWith(':'));
  let goToLineNumber = $derived.by(() => {
    if (!isGoToLineMode) return null;
    const num = parseInt(searchQuery.trimStart().slice(1).trim(), 10);
    return Number.isNaN(num) ? null : num;
  });

  // Debounce timer for file queries
  let fileQueryTimeout: ReturnType<typeof setTimeout> | null = null;
  // Request ID to cancel stale responses
  let currentFileRequestId = 0;
  // RAF handle for deferred result computation
  let resultComputeRaf: number | null = null;

  let agents: WorkspaceObject[] = $derived.by(() => {
    if (!workspaceId) return [];

    return $workspaceAgents$
      .filter((s) => !s.id?.startsWith('terminal-') && !s.retiredAt)
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
    if (!workspaceId) return [];
    const activeNotes = $allNotes$.filter((n) => !n.isArchived);
    return activeNotes
      .map((n) => ({
        id: JSON.stringify([workspaceId, n.id]),
        noteId: n.id,
        workspaceId,
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
      timestamp: c.attribution.timestamp || 0,
      _time: formatRelativeTime(c.attribution.timestamp),
    }));
  });
  let loadedTerminals: WorkspaceObject[] = $state([]);
  let terminals: WorkspaceObject[] = $derived($isCollaborator$ ? [] : loadedTerminals);
  let browserUrls: WorkspaceObject[] = $derived.by(() =>
    ($isCollaborator$ ? [] : $browserRecentUrls$).map((url) => {
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
      ? buildRecentItems(
          [...agents, ...notes, ...changes, ...terminals, ...browserUrls],
          $paletteMruEntries$,
        )
      : [],
  );

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

  // Load workspace objects when the workspace changes. Terminal metadata
  // titles are localized at read time; a runtime language switch remounts the
  // palette via the root +layout.svelte {#key $resolvedLocale$} block, which
  // re-runs this effect, so no explicit locale tracking is needed here.
  $effect(() => {
    if (!workspaceId) {
      untrack(() => {
        loadedTerminals = [];
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
      loadedTerminals = terminalMetadata
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

  let groupFiles: any[] = $state([]);

  // Daemon helper to query files (search.fileNames, PROTOCOL §5.15) and map to palette items (with fuzzy/MRU)
  async function queryFiles(pattern: string, wsId: string): Promise<any[]> {
    try {
      const resp = await backendRequest<{ files?: string[] }>('search.fileNames', {
        workspaceId: wsId,
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

  const FILE_QUERY_DEBOUNCE_MS = 150;

  // Keep file group in sync with current query/workspace (debounced)
  $effect(() => {
    const q = parsedQuery.searchTerm;
    const wsId = workspaceId;

    // Clear any pending debounce timer and invalidate in-flight requests first,
    // including when switching into Go to Line mode.
    if (fileQueryTimeout) {
      clearTimeout(fileQueryTimeout);
      fileQueryTimeout = null;
    }
    const requestId = ++currentFileRequestId;

    if (!isOpen || isGoToLineMode || !wsId || (activeFilter && activeFilter !== 'file')) {
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
        const files = await queryFiles(q, wsId);
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
      ++currentFileRequestId;
      if (fileQueryTimeout) {
        clearTimeout(fileQueryTimeout);
        fileQueryTimeout = null;
      }
    };
  });

  // Transcript search state (search.messages, PROTOCOL §5.15); the debounced
  // query flow lives in $lib/utils/palette-transcript-search.
  let groupMessages: any[] = $state([]);
  let isLoadingMessages = $state(false);
  const transcriptQuery = createTranscriptQuery(({ items, loading }) => {
    untrack(() => {
      if (items !== undefined) groupMessages = items;
      isLoadingMessages = loading;
    });
  });

  // Keep transcript group in sync only while the palette is visible.
  $effect(() => {
    if (!isOpen) return transcriptQuery.clear();
    const term = parsedQuery.searchTerm;

    // Skip in Go to Line mode and when there is no search term to match
    if (isGoToLineMode || !term || (activeFilter && activeFilter !== 'message')) {
      transcriptQuery.clear();
      return;
    }

    transcriptQuery.query(term, workspaceId, []);

    return () => transcriptQuery.cancel();
  });

  // Global indexed note results complement local fuzzy title/tag discovery.
  let noteResults = $state<NoteQueryUpdate>({
    items: [],
    loading: false,
    capability: 'unknown',
    fallback: true,
  });
  const noteQuery = createNoteQuery((update) => {
    untrack(() => {
      noteResults = update;
    });
  });
  const indexedNotes = $derived(
    noteResults.items
      .filter((item) => !item.isArchived)
      .map((item) => ({
        ...item,
        workspaceName: item.workspaceId,
        ...buildMessageTitleSegments(
          ($workspaceItems || []).find((w) => w.id === item.workspaceId),
        ),
        isArchivedWorkspace: item.isArchivedWorkspace,
        icon: faFileAlt,
        _time: formatRelativeTime(item.updatedAt),
      })),
  );
  $effect(() => {
    if (!isOpen) {
      noteQuery.close();
      return;
    }
    const term = parsedQuery.searchTerm;
    if (isGoToLineMode || !term || (activeFilter && activeFilter !== 'note')) {
      noteQuery.clear();
      return;
    }
    noteQuery.query(term, workspaceId, []);
    // Cleanup also invalidates in-flight responses on unmount.
    return () => noteQuery.cancel();
  });
  function buildResults(q: string, files: any[], messages: any[], remoteNotes: WorkspaceObject[]) {
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
          _activityTime: activityTime,
        };
      });
    return computeResults({
      query: q,
      activeFilter,
      workspaceId,
      agents,
      notes,
      indexedNotes: remoteNotes,
      changes,
      terminals,
      browserUrls,
      recentItems,
      files,
      commands,
      workspaceItems: wsItems,
      messages,
    });
  }
  // PERF: Debounce timer for rapid typing
  let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  const SEARCH_DEBOUNCE_MS = 16; // ~1 frame, prevents excessive RAF calls during fast typing

  // Recompute flat results - debounced and deferred via RAF to not block typing
  $effect(() => {
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
    // Read before the deferred callback so live Labs changes refresh command results.
    commands;
    $workspaceItems; // Metadata updates presentation without restarting remote queries.
    const files = groupFiles;
    const messages = groupMessages.map((item) => ({
      ...item,
      ...buildMessageTitleSegments(($workspaceItems || []).find((w) => w.id === item.workspaceId)),
    }));
    const remoteNotes = indexedNotes;
    // Local-note updates and workspace switches must refresh local fallback/browsing too.
    notes;
    workspaceId;
    recentItems;
    activeFilter;

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
        const flat = buildResults(q, files, messages, remoteNotes);
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

  function scrollToSelection() {
    void tick().then(() => {
      resultsRef
        ?.querySelector<HTMLElement>(`[data-palette-index="${selectedIndex}"]`)
        ?.scrollIntoView?.({ block: 'nearest' });
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
      if (isGoToLineMode) return;
      const nextIndex = findSelectableIndex(searchResults, selectedIndex + 1, 1);
      if (nextIndex !== -1) {
        selectedIndex = nextIndex;
        scrollToSelection();
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (isGoToLineMode) return;
      const prevIndex = findSelectableIndex(searchResults, selectedIndex - 1, -1);
      if (prevIndex !== -1) {
        selectedIndex = prevIndex;
        scrollToSelection();
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (isGoToLineMode) {
        if (goToLineNumber != null && goToLineNumber > 0) {
          dispatchWindowEvent('workspace:go-to-line', { line: goToLineNumber });
          onClose?.();
        }
        return;
      }
      // Cmd+Enter opens in adjacent panel
      const openInAdjacentPanel = isCmdClickModifier({ event: e });
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
      if (!isGoToLineMode) {
        filtersRef?.cycle(e.shiftKey ? -1 : 1);
      }
      queueMicrotask(() => inputRef?.focus());
    }
  }

  async function selectItem(item: any, options?: { openInAdjacentPanel?: boolean }) {
    if (!item) return;
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
    if (item.type) {
      // Transcript rows are not MRU-tracked ('message' is not a PaletteMruEntryType)
      if (item.type !== 'message' && item.type !== 'note') {
        appStore.dispatch(recordPaletteMruItem(item.type, item.id, Date.now()));
      }
      switch (item.type) {
        case 'message':
          void openMessage({
            workspaceId: item.workspaceId,
            agentId: item.agentId,
            messageId: item.messageId,
            query: parsedQuery.searchTerm || undefined,
          });
          break;
        case 'agent':
          if (workspaceId) {
            appStore.dispatch(
              openAgentTabRequested(workspaceId, { agentId: item.id, openInAdjacentPanel }),
            );
          }
          break;
        case 'note':
          if (
            !(await openPaletteNote(
              item.workspaceId ?? workspaceId,
              item.noteId ?? item.id,
              openInAdjacentPanel,
            ))
          )
            return;
          break;
        case 'change':
          if (item.path) {
            onSelectFile?.({ path: item.path, openInAdjacentPanel });
          }
          break;
        case 'terminal':
          if (workspaceId) {
            appStore.dispatch(
              openTab(workspaceId, {
                type: 'terminal',
                title: m.layout_tabTypes_terminal_title(),
                terminalId: item.id,
                closable: true,
              }),
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
        if (selectWorkspaceCreationVisible.select(appStore.state)) {
          appStore.dispatch(setShowCreateModal(true));
        }
        return true;
      case 'settings':
        navigateToSettings();
        return true;
      case 'enable-experimental-multiplayer':
        appStore.dispatch(setLabsMultiplayerEnabled(true));
        return true;
      case 'disable-experimental-multiplayer':
        appStore.dispatch(setLabsMultiplayerEnabled(false));
        return true;
      case 'enable-experimental-gitlab':
        appStore.dispatch(setLabsGitLabEnabled(true));
        return true;
      case 'disable-experimental-gitlab':
        appStore.dispatch(setLabsGitLabEnabled(false));
        return true;
      case 'enable-experimental-remote-agents':
        appStore.dispatch(setLabsRemoteAgentsEnabled(true));
        return true;
      case 'disable-experimental-remote-agents':
        appStore.dispatch(setLabsRemoteAgentsEnabled(false));
        return true;
      case 'new-agent':
        if (workspaceId && !$hidesAgentLifecycleActions$) {
          appStore.dispatch(createAgentRequested(workspaceId));
        }
        return true;
      case 'new-terminal':
        if (workspaceId && !$isCollaborator$) {
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
        if (workspaceId && !$isCollaborator$) {
          appStore.dispatch(openWorkspaceBrowser(workspaceId, 'about:blank'));
        }
        return true;
      case 'show-onboarding':
        // Explicit restart: request the full flow so OnboardingPage's
        // initial-step decision never skips ahead on setup state.
        appStore.dispatch(setOnboardingFullFlowRequested(true));
        appStore.dispatch(resetOnboarding());
        goto('/workspace/new');
        return true;
      case 'enhance-prompt':
        dispatchWindowEvent('chat:enhance-prompt');
        return true;
      case 'attach-context':
        dispatchWindowEvent('chat:attach-context');
        return true;
      case 'attach-files':
        dispatchWindowEvent('chat:attach-files');
        return true;
      case 'open-dev-console':
        void openDevConsole();
        return true;
      case 'open-hud':
        void invoke(IPC_CHANNELS.WINDOW.OPEN_NEW, { route: '/hud' });
        return true;
      case 'open-usage-stats':
        appStore.dispatch(setStatsOverlayOpen(true));
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
      // Ordinary opens clear recovery/go-to-line queries. Unchanged props must
      // leave user typing intact across unrelated parent or store updates.
      untrack(() => {
        searchQuery = currentInitialQuery;
      });
    }
  });
</script>

{#if isOpen}
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
  <div
    class="fixed top-[12%] left-1/2 -translate-x-1/2 w-[calc(100%-1rem)] max-w-[640px] z-50"
    role="dialog"
    aria-modal="true"
    aria-label={m.lib_commandPalette_quickActions_ariaLabel()}
    tabindex="-1"
    onkeydown={handleContainerKeyDown}
    transition:fly={{ axis: 'y', distance: 6, tier: 'moderate' }}
  >
    <div
      class="flex max-h-[80dvh] flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-(--elevation-overlay)"
      role="document"
      tabindex="-1"
    >
      <div class="flex shrink-0 items-center gap-3 px-5 py-3">
        <Fa icon={faSearch} class="size-5 shrink-0 text-muted-foreground" />

        <Input
          bind:ref={inputRef}
          bind:value={searchQuery}
          onkeydown={handleKeyDown}
          type="text"
          aria-label={m.lib_commandPalette_filter_placeholder()}
          placeholder={isGoToLineMode
            ? m.lib_commandPalette_goToLine_placeholder()
            : m.lib_commandPalette_filter_placeholder()}
          noFocusStyle
          class="min-w-0 flex-1 border-0 bg-transparent px-0 type-body shadow-none"
          autocorrect="off"
          autocapitalize="off"
          spellcheck="false"
        />
        <div aria-live="polite" class="sr-only">
          {m.lib_commandPalette_resultsCount_status({ count: resultCount })}
        </div>
      </div>

      <div class="h-px shrink-0 bg-border"></div>

      {#if !isGoToLineMode}
        <CommandPaletteFilters
          bind:this={filtersRef}
          {workspaceId}
          {activeFilter}
          isCollaborator={$isCollaborator$}
          onFilter={applyFilter}
        />
      {/if}

      {#if isGoToLineMode}
        <div class="min-h-0 max-h-[480px] overflow-y-auto p-1">
          <div class="px-3 py-2">
            {#if goToLineNumber != null && goToLineNumber > 0}
              <Button
                variant="ghost"
                class="w-full px-3 py-2 flex items-center gap-3 text-left rounded-md bg-foreground/[0.04] hover:bg-foreground/[0.06] transition-colors duration-spring-fast ease-spring-fast motion-reduce:transition-none"
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
              </Button>
            {:else}
              <p class="text-[13px] text-subtle px-3">
                {m.lib_commandPalette_invalidLine_message()}
              </p>
            {/if}
          </div>
        </div>
      {:else if searchResults.length > 0 || isLoadingFiles || isLoadingMessages || noteResults.loading}
        <div
          bind:this={resultsRef}
          class="min-h-0 max-h-[440px] overflow-y-auto overscroll-contain p-2"
          data-palette-results
        >
          {#each searchResults as item, index (item._idx !== undefined ? item._idx : `fallback-${index}`)}
            {#if item._borderAbove}
              <div class="my-1.5 h-px bg-border"></div>
            {:else if item._newActionsRow}
              <div class="px-3 pb-2 pt-3 type-caption text-muted-foreground">
                {m.layout_commandPalette_commands_group()}
              </div>
            {:else if item._groupLabel}
              <div class="px-3 pb-2 pt-3 {index > 0 ? 'mt-2' : ''}">
                <div class="flex items-center justify-between type-caption text-muted-foreground">
                  <span>{item._groupLabel}</span>
                  {#if item._shortcutKey}
                    <ShortcutChip>{item._shortcutKey}</ShortcutChip>
                  {/if}
                </div>
              </div>
            {:else if item._showMore}
              <ActionRow
                data-palette-index={index}
                selected={selectedIndex === index}
                class="px-3 py-2"
                onpointerdown={(event) => event.preventDefault()}
                onclick={() => selectItem(item)}
              >
                {#snippet title()}
                  <span class="text-muted-foreground"
                    >{showMoreLabel(item._count, item._itemType)}</span
                  >
                {/snippet}
              </ActionRow>
            {:else}
              <ActionRow
                data-palette-index={index}
                data-palette-result
                class="items-center gap-3 rounded-md px-3 py-2.5 type-body"
                selected={selectedIndex === index}
                aria-current={selectedIndex === index ? 'true' : undefined}
                onclick={() => selectItem(item)}
                onpointermove={() => (selectedIndex = index)}
                onpointerdown={(event) => event.preventDefault()}
              >
                {#snippet leading()}
                  {#if item.type === 'agent'}
                    <AgentAvatar agentId={item.id} variant="compact" />
                  {:else if item.navigationIcon}
                    <IntentNavigationIcon
                      name={item.navigationIcon}
                      size={16}
                      class="text-muted-foreground"
                    />
                  {:else}
                    <Fa icon={item.icon} class="size-4 text-muted-foreground" />
                  {/if}
                {/snippet}

                {#snippet title()}
                  <CommandPaletteItemTitle {item} />
                {/snippet}

                {#snippet trailing()}
                  <span aria-hidden="true" class="flex min-w-6 items-center justify-end gap-2">
                    {#if item.shortcut}
                      <ShortcutChip>{item.shortcut}</ShortcutChip>
                    {/if}
                    {#if selectedIndex === index}
                      <ShortcutChip class="rounded bg-muted px-1.5 py-1">↵</ShortcutChip>
                    {/if}
                  </span>
                {/snippet}
              </ActionRow>
            {/if}
          {/each}

          {#if (isLoadingFiles && workspaceId) || isLoadingMessages || noteResults.loading}
            {#each [0, 1, 2] as i}
              <div class="w-full px-3 h-11 flex items-center gap-3">
                <Skeleton class="w-4 h-4 rounded flex-none" />
                <Skeleton class="h-4 rounded" style="width: {100 + i * 40}px;" />
              </div>
            {/each}
          {/if}
        </div>
      {:else if searchQuery && !isLoadingFiles && !isLoadingMessages && !noteResults.loading}
        <EmptyState class="min-h-0 flex-1 overflow-y-auto py-10" contentClass="break-words">
          {#snippet icon()}<Fa icon={faSearch} class="size-5" />{/snippet}
          {#snippet title()}
            {parsedQuery.searchTerm
              ? m.lib_commandPalette_noResults_message({ query: parsedQuery.searchTerm })
              : m.lib_commandPalette_emptyFilter_message()}
          {/snippet}
        </EmptyState>
      {:else if !searchQuery}
        <div class="px-3 py-6 text-center">
          <p class="text-[13px] text-subtle">{m.lib_commandPalette_startTyping_message()}</p>
        </div>
      {/if}
    </div>
  </div>
{/if}
