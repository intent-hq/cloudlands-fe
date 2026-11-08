<script lang="ts">
  import { getSettingsPaletteCommands } from '$features/settings/settings-palette-commands';
  import {
    selectPrincipalConnectionContext,
    selectWorkspaceCreationVisible,
  } from '$store/renderer/slices/principal/principal-selectors';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { ActionRow } from '$lib/components/ui/menu';
  import { EmptyState } from '$lib/components/patterns/screen';
  import { ShortcutChip } from '$lib/components/ui/kbd';
  /** App-wide palette for commands, files, workspace search, notes and headings. */
  import { flushSync, onMount, tick, untrack } from 'svelte';
  import { writable } from 'svelte/store';
  import { fly } from '$lib/motion';
  import Fa from 'svelte-fa';
  import {
    faSearch,
    faFolderOpen,
    faTerminal,
    faCommentDots,
    faFileAlt,
    faCodeBranch,
    faGlobe,
  } from '@fortawesome/free-solid-svg-icons';
  import { openMessage } from '$lib/utils/open-message';
  import { openPaletteNote } from '$lib/utils/palette-note-navigation';
  import { openAndShowWorkspace } from '$lib/utils/show-workspace';
  import { createTranscriptQuery } from '$lib/utils/palette-transcript-search';
  import { createLogger } from '$lib/utils/client-logger';
  import { m } from '$shared/paraglide/messages.js';
  import { isCmdClickModifier } from '$shared/utils/link-helpers';
  import { selectBrowserRecentUrls } from '$store/renderer/slices/browser/browser-selectors';
  import {
    selectLabsRemoteAgentsEnabled,
    selectLabsPlainFolderWorkspacesEnabled,
    selectLabsBrowserAccessEnabled,
    selectLabsTabGroupsEnabled,
    selectLabsCloudMachinesEnabled,
    selectLabsMultiplayerEnabled,
  } from '$store/renderer/slices/user-preferences/user-preferences-selectors';
  import { initBrowserWorkspace } from '$store/renderer/slices/browser/browser-slice';
  import {
    selectHidesAgentCreationActions,
    selectIsCollaboratorOnlyClient,
    selectIsWorkspaceCollaborator,
    selectWorkspaceItems,
  } from '$store/renderer/slices/workspace/workspace-selectors';

  import { dispatchWindowEvent } from '$lib/utils/window-events';

  import { openWorkspaceBrowser } from '$store/renderer/slices/workspace-navigation/workspace-navigation-slice';
  import { openAgentTabRequested } from '$store/renderer/slices/app-layout/app-layout-slice';
  import { openTab } from '$store/renderer/slices/panel-layout/panel-layout-slice';
  import { selectPrincipalActionContext as admissionSelector } from '$store/renderer/slices/principal/principal-selectors';
  import {
    type WorkspaceObject,
    FILTER_PREFIXES,
    formatRelativeTime,
    parseQueryFilter,
    buildNoteBreadcrumbs,
    buildMessageTitleSegments,
    buildRecentItems,
  } from '$store/renderer/slices/command-palette/command-palette-utils';
  import {
    recordPaletteFileMru,
    recordPaletteMruItem,
    recordPalettePick,
    paletteNoteSearchReleased,
    paletteNoteSearchRequested,
  } from '$store/renderer/slices/palette/palette-slice';
  import {
    selectPaletteFileMru,
    selectPaletteMruEntries,
    selectPaletteNoteSearch,
    selectPalettePicks,
  } from '$store/renderer/slices/palette/palette-selectors';
  import type { PaletteMruEntryType } from '$store/renderer/slices/palette/palette-types';
  import {
    computeResults,
    type PaletteLateSource,
    type PaletteRepoItem,
  } from '$store/renderer/slices/command-palette/command-palette-results';
  import {
    selectKnownReposGitLabInstance,
    selectPaletteKnownRepos,
  } from '$store/renderer/slices/workspace-initializer/workspace-initializer-selectors';
  import { ensureKnownReposLoaded } from '$store/renderer/slices/workspace-initializer/workspace-initializer-slice';
  import { recentRepoKey } from '$store/renderer/slices/workspace-initializer/utils/recent-repo-key';

  import { paletteCategoryLabel, paletteMoreLabel, toPaletteRepo } from './command-palette-rows';
  import {
    openRepoInNewWorkspace,
    queryPaletteFiles,
    runPaletteCommand,
  } from './command-palette-actions';
  import {
    createLateArrivalTracker,
    findSelectableIndex,
    isSelectableResult,
    firstRowKey,
    keepRowOne,
    resolveSelection,
    rowKey,
  } from './command-palette-selection';
  import RepositoryPickerIcon from './workspace/initializer/RepositoryPickerIcon.svelte';
  import { Skeleton } from './ui/skeleton';
  import CommandPaletteItemTitle from './CommandPaletteItemTitle.svelte';
  import CommandPaletteFilters from './CommandPaletteFilters.svelte';
  import { COMMAND_PALETTE_COMMANDS } from './command-palette-commands';
  import { isLabCommandHidden } from './command-palette-labs';
  import { dockLabEnabled } from '$lib/dock-lab';
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
  import { paletteRetiredWorkspaces } from './command-palette-retired.svelte';
  import {
    changesConsumerMounted,
    changesConsumerUnmounted,
  } from '$store/renderer/slices/changes/changes-slice';
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
  const labsRemoteAgentsEnabled$ = selectLabsRemoteAgentsEnabled();
  const labsPlainFolders$ = selectLabsPlainFolderWorkspacesEnabled();
  const labsBrowserAccess$ = selectLabsBrowserAccessEnabled();
  const labsTabGroups$ = selectLabsTabGroupsEnabled();
  const labsCloudMachines$ = selectLabsCloudMachinesEnabled();
  // Collaborators (multiplayer w3) are refused on terminal + browser methods and
  // cannot create workspaces, so those commands and result groups are withheld.
  const isCollaborator$ = selectIsWorkspaceCollaborator(workspaceIdStore);
  const isCollaboratorOnlyClient$ = selectIsCollaboratorOnlyClient();
  const canCreate$ = selectWorkspaceCreationVisible();
  // Agent create is likewise refused (-32003) for a collaborator connection.
  const hidesAgentLifecycleActions$ = selectHidesAgentCreationActions(workspaceIdStore);
  const WORKSPACE_OWNER_ONLY_COMMAND_IDS: ReadonlySet<string> = new Set([
    'new-terminal',
    'open-url',
  ]);
  const commands = $derived(
    [
      ...COMMAND_PALETTE_COMMANDS,
      ...getSettingsPaletteCommands({
        isCollaboratorOnlyClient: $isCollaboratorOnlyClient$,
        multiplayerEnabled: $labsMultiplayerEnabled$,
      }),
    ].filter(
      (command) =>
        !($isCollaborator$ && WORKSPACE_OWNER_ONLY_COMMAND_IDS.has(command.id)) &&
        !($hidesAgentLifecycleActions$ && command.id === 'new-agent') &&
        !(!$canCreate$ && command.id === 'new-workspace') &&
        !($labsRemoteAgentsEnabled$ && command.id === 'enable-experimental-remote-agents') &&
        !(!$labsRemoteAgentsEnabled$ && command.id === 'disable-experimental-remote-agents') &&
        !isLabCommandHidden(
          command.id,
          $dockLabEnabled,
          $labsPlainFolders$,
          $labsBrowserAccess$,
          $labsTabGroups$,
          $labsCloudMachines$,
        ),
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

  const paletteMruTimes = $derived.by(() => {
    const times = new Map<string, number>();
    for (const entry of $paletteMruEntries$)
      times.set(`${entry.type}:${entry.id}`, entry.timestamp);
    return times;
  });
  // Commands carry their last pick time so equal matches rank the recent one first.
  const searchCommands = $derived(
    commands.map((command) => {
      const timestamp = paletteMruTimes.get(`command:${command.id}`);
      return timestamp ? { ...command, timestamp } : command;
    }),
  );

  // Known repos (empty whenever New Workspace is hidden); one load per palette open.
  const knownRepos$ = selectPaletteKnownRepos();
  const gitlabInstance$ = selectKnownReposGitLabInstance();
  const palettePicks$ = selectPalettePicks();
  $effect(() => {
    if (!isOpen) return;
    untrack(() => appStore.dispatch(ensureKnownReposLoaded()));
  });
  const repos: PaletteRepoItem[] = $derived(
    $knownRepos$.map((repo) =>
      toPaletteRepo(repo, $gitlabInstance$, paletteMruTimes.get(`repo:${recentRepoKey(repo)}`)),
    ),
  );

  // While searching without a filter the list is blended: each row names its category.
  const showCategoryLabels = $derived(!!parsedQuery.searchTerm && !activeFilter);

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
        const files = await queryPaletteFiles(q, wsId, $paletteFileMru$);
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
  const noteSearchConsumerId = crypto.randomUUID();
  const noteResults = selectPaletteNoteSearch(noteSearchConsumerId);
  const principalConnectionContext = selectPrincipalConnectionContext();
  const indexedNotes = $derived(
    $noteResults.items
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
    const authority = $principalConnectionContext;
    if (!authority) return;
    if (!isOpen) {
      appStore.dispatch(paletteNoteSearchRequested(noteSearchConsumerId, crypto.randomUUID(), ''));
      return;
    }
    const term = parsedQuery.searchTerm;
    if (isGoToLineMode || !term || (activeFilter && activeFilter !== 'note')) {
      appStore.dispatch(paletteNoteSearchRequested(noteSearchConsumerId, crypto.randomUUID(), ''));
      return;
    }
    appStore.dispatch(
      paletteNoteSearchRequested(noteSearchConsumerId, crypto.randomUUID(), term, workspaceId),
    );
    return () =>
      appStore.dispatch(paletteNoteSearchRequested(noteSearchConsumerId, crypto.randomUUID(), ''));
  });
  onMount(() => () => appStore.dispatch(paletteNoteSearchReleased(noteSearchConsumerId)));
  paletteRetiredWorkspaces(() => isOpen, workspaceItems, admissionSelector());
  function buildResults(
    q: string,
    files: any[],
    messages: any[],
    remoteNotes: WorkspaceObject[],
    repoItems: PaletteRepoItem[],
    lateArrivalOrder: PaletteLateSource[],
  ) {
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
          isRetiredWorkspace: w.retiredAt ? true : undefined, // retiredAt ⇔ Retired (§5.1)
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
      commands: searchCommands,
      workspaceItems: wsItems,
      messages,
      repos: repoItems,
      pickMemory: $palettePicks$,
      lateArrivalOrder,
    });
  }
  // PERF: Debounce timer for rapid typing
  let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  const SEARCH_DEBOUNCE_MS = 16; // ~1 frame, prevents excessive RAF calls during fast typing

  // The highlight follows an item, not a row number. Each keystroke puts it on
  // row 1; after an arrow key or hover it stays on that item while results land.
  let selectedKey: string | null = null;
  let highlightMoved = false;
  // Inputs of the last rebuild, to tell a repo-list arrival from a keystroke.
  let builtQuery: string | null = null;
  let builtRepos: PaletteRepoItem[] | null = null;
  let heldRowOne: string | null = null;
  // The scheduled rebuild; Enter runs it at once so it acts on the current text.
  let pendingRebuild: (() => void) | null = null;
  // Order in which late sources answered the current text (first leads when nothing instant matches).
  const noteLateArrivals = createLateArrivalTracker();

  $effect(() => {
    searchQuery;
    untrack(() => {
      highlightMoved = false;
    });
  });

  function selectRow(index: number, moved: boolean) {
    selectedIndex = index;
    selectedKey = rowKey(searchResults[index]);
    if (moved) highlightMoved = true;
  }

  function applyResults(flat: any[], query: string, repoItems: PaletteRepoItem[]) {
    // A repo list that lands mid-typing keeps row 1 until the next keystroke.
    if (query !== builtQuery) heldRowOne = null;
    else if (repoItems !== builtRepos && !heldRowOne) heldRowOne = firstRowKey(searchResults);
    if (heldRowOne) keepRowOne(heldRowOne, flat);
    builtQuery = query;
    builtRepos = repoItems;
    const index = resolveSelection(flat, {
      index: selectedIndex,
      key: selectedKey,
      moved: highlightMoved,
    });
    searchResults = flat;
    selectedIndex = index;
    selectedKey = rowKey(flat[index]);
  }

  function cancelPendingRebuild() {
    if (resultComputeRaf !== null) {
      cancelAnimationFrame(resultComputeRaf);
      resultComputeRaf = null;
    }
    if (searchDebounceTimer !== null) {
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = null;
    }
    pendingRebuild = null;
  }

  /** Finish any scheduled rebuild now, so Enter acts on results for the current text. */
  function flushPendingRebuild() {
    flushSync();
    pendingRebuild?.();
  }

  // Recompute flat results - debounced and deferred via RAF to not block typing
  $effect(() => {
    const q = parsedQuery.searchTerm;
    const query = searchQuery;
    // Skip result computation in Go to Line mode
    if ((searchQuery || '').trimStart().startsWith(':')) {
      // Cancel any pending debounce/RAF from a previous non-GoToLine query
      cancelPendingRebuild();
      untrack(() => {
        searchResults = [];
      });
      return;
    }
    // Read before the deferred callback so live Labs changes refresh command results.
    searchCommands;
    $workspaceItems; // Metadata updates presentation without restarting remote queries.
    const files = groupFiles;
    const messages = groupMessages.map((item) => ({
      ...item,
      ...buildMessageTitleSegments(($workspaceItems || []).find((w) => w.id === item.workspaceId)),
    }));
    const remoteNotes = indexedNotes;
    const repoItems = repos;
    const arrivalOrder = untrack(() =>
      noteLateArrivals(query, {
        file: !isLoadingFiles && files.length > 0,
        note: !$noteResults.loading && remoteNotes.length > 0,
        message: !isLoadingMessages && messages.length > 0,
      }),
    );
    isLoadingFiles;
    isLoadingMessages;
    $noteResults.loading;
    // Local-note updates and workspace switches must refresh local fallback/browsing too.
    notes;
    workspaceId;
    recentItems;
    activeFilter;

    cancelPendingRebuild();
    const rebuild = () => {
      cancelPendingRebuild();
      const flat = buildResults(q, files, messages, remoteNotes, repoItems, arrivalOrder);
      // Use untrack for all state updates to avoid effect loops
      untrack(() => applyResults(flat, query, repoItems));
    };
    pendingRebuild = rebuild;

    // PERF: Debounce rapid typing, then defer to RAF
    searchDebounceTimer = setTimeout(() => {
      searchDebounceTimer = null;
      resultComputeRaf = requestAnimationFrame(() => {
        resultComputeRaf = null;
        rebuild();
      });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      if (pendingRebuild === rebuild) cancelPendingRebuild();
    };
  });

  function recordMRUFile(path: string) {
    appStore.dispatch(recordPaletteFileMru(path, Date.now()));
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
        selectRow(nextIndex, true);
        scrollToSelection();
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (isGoToLineMode) return;
      const prevIndex = findSelectableIndex(searchResults, selectedIndex - 1, -1);
      if (prevIndex !== -1) {
        selectRow(prevIndex, true);
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
      flushPendingRebuild();
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
    const pickQuery = parsedQuery.searchTerm;
    if (item._seeAll) {
      const prefix = Object.keys(FILTER_PREFIXES).find(
        (key) => FILTER_PREFIXES[key] === item._filter,
      );
      if (prefix) applyFilter(prefix);
      return;
    }
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
    if (item._repo) {
      recordMru('repo', item.id);
      openRepoInNewWorkspace(item._repo, $gitlabInstance$);
    } else if (item.type) {
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
      recordMru('workspace', item.id);
      void openAndShowWorkspace(item.id).catch((error) =>
        logger.warn('Failed to open workspace from palette', { workspaceId: item.id, error }),
      );
    } else if (item.path) {
      onSelectFile?.({ path: item.path, line: item.line, openInAdjacentPanel });
      if (item.path) recordMRUFile(item.path);
    } else {
      recordMru('command', item.id);
      const close = handleCommand(item.id);
      if (close === false) shouldClose = false;
    }
    // Pick memory: this item was chosen for this query (the row key, whole).
    if (pickQuery && item._key) {
      appStore.dispatch(recordPalettePick(pickQuery, item._key, Date.now()));
    }
    if (shouldClose) onClose?.();
  }

  function recordMru(type: PaletteMruEntryType, id: string) {
    appStore.dispatch(recordPaletteMruItem(type, id, Date.now()));
  }

  function handleCommand(commandId: string): boolean {
    return runPaletteCommand(commandId, {
      commands,
      workspaceId,
      hidesAgentLifecycleActions: $hidesAgentLifecycleActions$,
      isCollaborator: $isCollaborator$,
    });
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
  $effect(() => {
    const wsId = workspaceId;
    if (!wsId || !isOpen) return;
    appStore.dispatch(changesConsumerMounted(wsId, 'files'));
    return () => appStore.dispatch(changesConsumerUnmounted(wsId, 'files'));
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
  <!-- Width follows the filter strip (640px floor, viewport cap); other sections use
       contain-inline-size so long titles or queries truncate instead of widening it.
       Centered with auto margins, not a translate, so odd widths avoid half-pixel offsets. -->
  <div
    class="fixed inset-x-0 top-[12%] mx-auto w-max min-w-[min(640px,calc(100%-1rem))] max-w-[calc(100%-1rem)] z-50"
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
      <div class="flex shrink-0 items-center gap-3 px-5 py-3 contain-inline-size">
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

      <!-- Go-to-line hides the strip but keeps it mounted, so the palette width does not jump. -->
      <div
        class={isGoToLineMode ? 'invisible h-0 overflow-hidden' : 'contents'}
        inert={isGoToLineMode}
      >
        <CommandPaletteFilters
          bind:this={filtersRef}
          {workspaceId}
          {activeFilter}
          isCollaborator={$isCollaborator$}
          showRepos={$canCreate$}
          onFilter={applyFilter}
        />
      </div>

      {#if isGoToLineMode}
        <div class="min-h-0 max-h-[480px] overflow-y-auto p-1 contain-inline-size">
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
      {:else if searchResults.length > 0 || isLoadingFiles || isLoadingMessages || $noteResults.loading}
        <div
          bind:this={resultsRef}
          class="min-h-0 max-h-[440px] overflow-y-auto overscroll-contain p-2 contain-inline-size"
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
              <div class="px-3 pb-2 pt-3 {index > 0 ? 'mt-2' : ''}" data-palette-group>
                <div class="flex items-center justify-between type-caption text-muted-foreground">
                  <span>{item._groupLabel}</span>
                  {#if item._shortcutKey}
                    <ShortcutChip>{item._shortcutKey}</ShortcutChip>
                  {/if}
                </div>
              </div>
            {:else if item._showMore || item._seeAll}
              <ActionRow
                data-palette-index={index}
                data-palette-see-all={item._filter}
                class="rounded-md px-3 py-2"
                selected={selectedIndex === index}
                aria-current={item._seeAll && selectedIndex === index ? 'true' : undefined}
                onpointerdown={(event) => event.preventDefault()}
                onpointermove={() => {
                  if (item._seeAll && selectedIndex !== index) selectRow(index, true);
                }}
                onclick={() => selectItem(item)}
              >
                {#snippet title()}
                  <span class="text-muted-foreground">{paletteMoreLabel(item)}</span>
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
                onpointermove={() => {
                  if (selectedIndex !== index) selectRow(index, true);
                }}
                onpointerdown={(event) => event.preventDefault()}
              >
                {#snippet leading()}
                  {#if item._repo}
                    <RepositoryPickerIcon
                      owner={item._repoOwner}
                      provider={item._repoProvider}
                      local={item._repo.type === 'local'}
                      size={16}
                    />
                  {:else if item.type === 'agent'}
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
                  <span class="flex items-center justify-end gap-2">
                    {#if showCategoryLabels && paletteCategoryLabel(item._category)}
                      <span
                        class="min-w-16 text-right type-caption text-muted-foreground"
                        data-palette-category>{paletteCategoryLabel(item._category)}</span
                      >
                    {/if}
                    <span aria-hidden="true" class="flex min-w-6 items-center justify-end gap-2">
                      {#if item.shortcut}
                        <ShortcutChip>{item.shortcut}</ShortcutChip>
                      {/if}
                      {#if selectedIndex === index}
                        <ShortcutChip class="rounded bg-muted px-1.5 py-1">↵</ShortcutChip>
                      {/if}
                    </span>
                  </span>
                {/snippet}
              </ActionRow>
            {/if}
          {/each}

          {#if (isLoadingFiles && workspaceId) || isLoadingMessages || $noteResults.loading}
            {#each [0, 1, 2] as i}
              <div class="w-full px-3 h-11 flex items-center gap-3">
                <Skeleton class="w-4 h-4 rounded flex-none" />
                <Skeleton class="h-4 rounded" style="width: {100 + i * 40}px;" />
              </div>
            {/each}
          {/if}
        </div>
      {:else if searchQuery && !isLoadingFiles && !isLoadingMessages && !$noteResults.loading}
        <EmptyState
          class="min-h-0 flex-1 overflow-y-auto py-10 contain-inline-size"
          contentClass="break-words"
        >
          {#snippet icon()}<Fa icon={faSearch} class="size-5" />{/snippet}
          {#snippet title()}
            {parsedQuery.searchTerm
              ? m.lib_commandPalette_noResults_message({ query: parsedQuery.searchTerm })
              : m.lib_commandPalette_emptyFilter_message()}
          {/snippet}
        </EmptyState>
      {:else if !searchQuery}
        <div class="px-3 py-6 text-center contain-inline-size">
          <p class="text-[13px] text-subtle">{m.lib_commandPalette_startTyping_message()}</p>
        </div>
      {/if}
    </div>
  </div>
{/if}
