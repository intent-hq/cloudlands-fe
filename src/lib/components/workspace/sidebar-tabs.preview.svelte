<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  interface Props {
    side?: 'left' | 'right';
    collapsed?: boolean;
    width?: number;
    height?: number;
    sidebarWidth?: number;
    items?: number;
    loading?: boolean;
    collaborator?: boolean;
    filesError?: boolean;
    initialSection?: string;
    extraFiles?: number;
    scriptsState?: 'ready' | 'empty' | 'loading' | 'retry';
  }

  export const preview = definePreview<Props>({
    id: 'sidebar-tabs',
    title: 'Workspace sidebar tabs',
    defaultState: 'default',
    states: {
      default: { props: {} },
      collapsed: { props: { collapsed: true } },
      right: { props: { side: 'right', collapsed: true } },
      narrow: { props: { width: 420, sidebarWidth: 280, collapsed: true } },
      short: { props: { height: 360 } },
      'long-content': { props: { items: 40, sidebarWidth: 280 } },
      empty: { props: { items: 0 } },
      loading: { props: { items: 0, loading: true } },
      collaborator: { props: { collaborator: true, collapsed: true } },
      'files-error': { props: { filesError: true } },
      'last-section': { props: { initialSection: 'shell' } },
      'tabs-narrow': { props: { width: 360, sidebarWidth: 280 } },
      'long-files': { props: { collapsed: true, extraFiles: 200 } },
      'short-collapsed': { props: { collapsed: true, height: 360, items: 200 } },
      'empty-collapsed': { props: { collapsed: true, items: 0 } },
      'shell-empty': { props: { initialSection: 'shell', scriptsState: 'empty' } },
      'shell-loading': { props: { initialSection: 'shell', scriptsState: 'loading' } },
      'shell-retry': { props: { initialSection: 'shell', scriptsState: 'retry' } },
    },
  });
</script>

<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import type { AgentSession, FileNode } from '$shared/types';
  import { Textarea } from '$lib/components/ui/textarea';
  import WorkspaceLayout from './WorkspaceLayout.svelte';
  import MultiSelectTabbedSidebar from './MultiSelectTabbedSidebar.svelte';
  import { store } from '$store/renderer/store';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import {
    setWorkspaceEntity,
    removeWorkspaceEntity,
  } from '$store/renderer/slices/workspace/workspace-slice';
  import { bulkUpsertSessions } from '$store/renderer/slices/agent-session/agent-session-slice';
  import {
    setAgents,
    setIsLoadingAgents,
  } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
  import { loadWorkspaceNotesSucceeded } from '$store/renderer/slices/workspace-notes/workspace-notes-slice';
  import {
    initializeLayout,
    clearPanelLayout,
  } from '$store/renderer/slices/panel-layout/panel-layout-slice';
  import { setMultiSelectSidebarSelectedTabs } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
  import { setCollapsed } from '$store/renderer/slices/ui-layout/ui-layout-slice';
  import {
    setChangesData,
    setHasLoadedInitialData,
  } from '$store/renderer/slices/changes/changes-slice';
  import {
    setRootNode,
    setFileExplorerInitialized,
    setFileExplorerWorkspacePath,
    setFileExplorerError,
  } from '$store/renderer/slices/file-explorer/file-explorer-slice';
  import {
    setScriptsData,
    setScriptsInitialized,
    setScriptListState,
  } from '$store/renderer/slices/scripts/scripts-slice';
  import { ChangeStage } from '$features/file-tracking/types';
  import { installChangesSummaryMocks } from './sidebar/changes-summary.preview-fixtures';
  import { admitLegacyPrincipal } from '../../../test/fixtures/principal-state';

  let {
    side = 'left',
    collapsed = false,
    width = 1040,
    height = 680,
    sidebarWidth = 320,
    items = 12,
    loading = false,
    collaborator = false,
    filesError = false,
    initialSection = 'overview',
    extraFiles = 0,
    scriptsState = 'ready',
  }: Props = $props();
  const workspaceId = 'sidebar-tabs-preview';
  const timestamp = '2026-10-20T12:00:00Z';
  const root = '/preview/sidebar-tabs';
  const dispose = startRootStoreLifecycle(store, { startSagas: () => [] });
  const initialCollapsed = store.state.uiLayout.sidebarCollapsed;
  const restoreMocks = untrack(() => installChangesSummaryMocks(workspaceId, 'feat/sidebar-tabs'));
  let draft = $state('Keep the navigation quiet and give the work room to breathe.');

  untrack(() => {
    admitLegacyPrincipal(collaborator ? 'guest' : 'owner');
    store.dispatch(
      setWorkspaceEntity({
        id: workspaceId,
        title: 'Refine workspace navigation',
        statusMessage: 'Making room for the work that matters.',
        taskStats: { total: 0, completed: 0, inProgress: 0 },
        repositoryOwner: 'intent-hq',
        repositoryName: 'intent',
        repositoryPath: root,
        worktreePath: root,
        path: root,
        branch: 'feat/sidebar-tabs',
        baseRef: 'main',
        myRole: collaborator ? 'collaborator' : 'owner',
        status: 'active',
        createdAt: timestamp,
        updatedAt: timestamp,
        pullRequests: [
          {
            id: 'sidebar-preview-pr',
            number: 7434,
            title: 'Refine workspace navigation',
            url: 'https://github.com/intent-hq/intent/pull/7434',
            status: 'OPEN',
            createdAt: timestamp,
            updatedAt: timestamp,
          },
        ],
      } as never),
    );
    const names = [
      'Sidebar design',
      'Review interactions',
      'Polish motion',
      'Keyboard navigation',
      'A careful review of a very long workspace navigation and accessibility proposal',
      'Refine spacing',
    ];
    const agents = Array.from({ length: items }, (_, index) => ({
      id: `sidebar-preview-agent-${index}`,
      workspaceId,
      name: names[index % names.length],
      status: index === 0 ? 'active' : index === 2 ? 'error' : 'idle',
      isStreaming: index === 0,
      isProcessing: index === 0,
      messages: [],
      lastUserMessage: 'Make the sidebar easier to use.',
      lastAgentResponse:
        index === 0
          ? 'Refining the navigation and preserving your place.'
          : 'The changes are ready for a look.',
      createdAt: timestamp,
      updatedAt: timestamp,
    })) as unknown as AgentSession[];
    store.dispatch(bulkUpsertSessions(agents, { preserveExplicitRuntimeFlags: false }));
    store.dispatch(setAgents(workspaceId, agents));
    store.dispatch(setIsLoadingAgents(workspaceId, loading));
    store.dispatch(
      loadWorkspaceNotesSucceeded([workspaceId], {
        [workspaceId]: Array.from({ length: Math.min(items, 12) }, (_, index) => ({
          id: index === 0 ? 'spec' : `sidebar-preview-note-${index}`,
          workspaceId,
          title: [
            'Spec',
            'Interaction notes',
            'Navigation sketches',
            'A long note title about keeping workspace state intact',
          ][index % 4],
          content: 'Keep navigation compact and preserve the active task.',
          contentType: 'markdown',
          tags: [],
          isPinned: index === 0,
          isArchived: false,
          visibility: 'private',
          createdAt: timestamp,
          updatedAt: timestamp,
        })),
      } as never),
    );
    store.dispatch(
      initializeLayout(workspaceId, {
        root: { type: 'panel', panelId: 'sidebar-preview-panel' },
        panels: {
          'sidebar-preview-panel': {
            id: 'sidebar-preview-panel',
            tabs: [
              {
                id: 'sidebar-preview-note-tab',
                type: 'note',
                title: 'Spec',
                workspaceId,
                noteId: 'spec',
                closable: true,
              },
              {
                id: 'sidebar-preview-browser',
                type: 'browser',
                title: 'Design reference',
                workspaceId,
                browserUrl: 'https://intentapp.dev',
                closable: true,
              },
            ],
            activeTabId: 'sidebar-preview-note-tab',
          },
        },
        focusedPanelId: 'sidebar-preview-panel',
      }),
    );
    store.dispatch(setMultiSelectSidebarSelectedTabs(workspaceId, [initialSection]));
    store.dispatch(setCollapsed(collapsed));
    store.dispatch(
      setChangesData(
        workspaceId,
        [
          {
            id: 'sidebar-change',
            file: 'src/Sidebar.svelte',
            relativePath: 'src/Sidebar.svelte',
            status: 'modified',
            stage: ChangeStage.Unstaged,
            stats: { additions: 42, deletions: 68 },
            attribution: { manual: true, timestamp: 0 },
          },
        ],
        false,
        1,
      ),
    );
    store.dispatch(setHasLoadedInitialData(workspaceId, true));
    store.dispatch(setFileExplorerWorkspacePath(workspaceId, root));
    store.dispatch(
      setRootNode(workspaceId, {
        name: 'sidebar-tabs',
        path: root,
        type: 'directory',
        children: [
          {
            name: 'src',
            path: `${root}/src`,
            type: 'directory',
            children: [
              { name: 'Sidebar.svelte', path: `${root}/src/Sidebar.svelte`, type: 'file' },
            ],
          },
          { name: 'package.json', path: `${root}/package.json`, type: 'file' },
          { name: 'README.md', path: `${root}/README.md`, type: 'file' },
          ...Array.from({ length: extraFiles }, (_, index) => ({
            name: `file-${index}.ts`,
            path: `${root}/file-${index}.ts`,
            type: 'file',
          })),
        ],
      } as FileNode),
    );
    store.dispatch(setFileExplorerInitialized(workspaceId, true));
    if (filesError)
      store.dispatch(setFileExplorerError(workspaceId, 'The workspace files could not be loaded.'));
    store.dispatch(
      setScriptsData(
        workspaceId,
        scriptsState === 'ready'
          ? [
              {
                id: 'sidebar-dev-server',
                workspaceId,
                name: 'Preview server',
                command: 'pnpm dev',
                mode: 'service',
                category: 'dev',
                source: 'user',
                createdAt: timestamp,
                runtime: { status: 'running', restartCount: 0 },
              },
            ]
          : [],
      ),
    );
    store.dispatch(
      setScriptsInitialized(workspaceId, scriptsState === 'ready' || scriptsState === 'empty'),
    );
    store.dispatch(setScriptListState(workspaceId, scriptsState === 'loading'));
  });

  onDestroy(() => {
    restoreMocks();
    store.dispatch(setCollapsed(initialCollapsed));
    store.dispatch(clearPanelLayout(workspaceId));
    store.dispatch(removeWorkspaceEntity(workspaceId));
    dispose();
  });
</script>

{#snippet sidebar()}
  <MultiSelectTabbedSidebar {workspaceId} onCreateNote={() => {}} onCreateAgent={() => {}} />
{/snippet}

{#snippet content()}
  <div
    class="h-full w-full min-w-0 overflow-auto rounded-tl-lg bg-background px-8 py-7 text-foreground"
    data-sidebar-preview-main
  >
    <div class="mx-auto max-w-xl">
      <p class="mb-5 text-sm text-muted-foreground">Spec</p>
      <h1 class="mb-5 text-xl font-medium tracking-tight">A little less interface.</h1>
      <p class="mb-6 text-sm leading-relaxed text-muted-foreground">
        Keep the workspace focused. Move between conversations, context, changes, and files without
        losing your place.
      </p>
      <Textarea
        bind:value={draft}
        aria-label="Workspace draft"
        class="min-h-36 resize-none bg-transparent text-sm leading-relaxed"
        data-sidebar-preview-draft
      />
    </div>
  </div>
{/snippet}

<div
  style:width={`${width}px`}
  style:height={`${height}px`}
  class="overflow-hidden bg-sidebar"
  data-sidebar-tabs-preview
>
  <WorkspaceLayout
    {workspaceId}
    {sidebar}
    {content}
    sidebarSide={side}
    sidebarDefaultWidth={sidebarWidth}
    sidebarMinWidth={280}
    sidebarStorageKey={`workspace-left-panel-width:${workspaceId}-${side}-${sidebarWidth}`}
    sidebarExpandedStorageKey={`workspace-left-panel-expanded-width:${workspaceId}`}
  />
</div>
