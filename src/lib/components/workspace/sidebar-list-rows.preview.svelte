<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  export const preview = definePreview({
    id: 'sidebar-list-rows',
    title: 'Expanded sidebar list rows',
    defaultState: 'regular',
    states: {
      regular: { props: { cardWidth: 320 } },
      narrow: { props: { cardWidth: 240 } },
    },
  });
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import {
    AgentStatus,
    ContentType,
    NoteVisibility,
    type AgentSession,
    type Note,
  } from '$shared/types';
  import { AgentId, NoteId, WorkspaceId } from '$shared/types/branded-ids';
  import { store } from '$store/renderer/store';
  import { setSkills } from '$store/renderer/slices/skills/skills-slice';
  import { setServers } from '$store/renderer/slices/mcp-settings/mcp-settings-slice';
  import {
    bulkUpsertSessions,
    removeSession,
  } from '$store/renderer/slices/agent-session/agent-session-slice';
  import type { FlattenedFileNode } from '$store/renderer/slices/file-explorer/file-explorer-types';
  import NotesPanel from './sidebar/NotesPanel.svelte';
  import ContextItemRow from './sidebar/ContextItemRow.svelte';
  import SkillsSection from './sidebar/SkillsSection.svelte';
  import McpServersSection from './sidebar/McpServersSection.svelte';
  import WorkspaceAgentsList from './WorkspaceAgentsList.svelte';
  import SidebarBrowserGroup from './SidebarBrowserGroup.svelte';
  import WorkspaceShellList from './WorkspaceShellList.svelte';
  import VirtualizedFileTree from '../file-explorer/VirtualizedFileTree.svelte';
  import { LIST_LABELS_WORKSPACE, setupListLabelsPreview } from './list-labels.preview-fixtures';

  let { cardWidth = 320 }: { cardWidth?: number } = $props();
  const timestamp = '2026-09-16T00:00:00.000Z';
  const notes = [
    {
      id: NoteId('row-plan'),
      title: 'Implementation plan',
      content: '- [ ] [Keyboard navigation](intent://local/task/row-task)',
    },
    {
      id: NoteId('row-task'),
      title: 'Keyboard navigation',
      parentId: NoteId('row-plan'),
      metadata: { task: { status: 'in_progress' as const } },
    },
    {
      id: NoteId('row-reference'),
      title: 'Reference notes with a deliberately long title for truncation',
    },
  ].map<Note>((note) => ({
    workspaceId: WorkspaceId(LIST_LABELS_WORKSPACE),
    content: '',
    contentType: ContentType.Markdown,
    tags: [],
    isPinned: false,
    isArchived: false,
    visibility: NoteVisibility.Workspace,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...note,
  }));
  const agents: AgentSession[] = [
    'Interface reviewer',
    'A deliberately long implementation agent name',
  ].map((name, index): AgentSession => ({
    id: AgentId(`sidebar-row-agent-${index}`),
    workspaceId: WorkspaceId(LIST_LABELS_WORKSPACE),
    backendSessionId: AgentId(`sidebar-row-session-${index}`),
    name,
    status: AgentStatus.Idle,
    messages: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  }));
  let openedNote = $state('');
  let selectedAgentId = $state<string | null>(null);
  let selectedFile = $state('');
  let openedBrowser = $state('');
  let expanded = $state(true);
  const flattenedNodes = $derived<FlattenedFileNode[]>([
    {
      node: {
        name: 'src',
        path: '/sample/src',
        type: 'directory',
        children: ['/sample/src/sidebar-layout.ts'],
      },
      depth: 0,
      isExpanded: expanded,
      isLoading: false,
    },
    ...(expanded
      ? [
          {
            node: {
              name: 'sidebar-layout.ts',
              path: '/sample/src/sidebar-layout.ts',
              type: 'file' as const,
              children: [],
            },
            depth: 1,
            isExpanded: false,
            isLoading: false,
          },
        ]
      : []),
    {
      node: {
        name: 'A-long-reference-document.md',
        path: '/sample/A-long-reference-document.md',
        type: 'file',
        children: [],
      },
      depth: 0,
      isExpanded: false,
      isLoading: false,
    },
  ]);
  onMount(() => {
    const dispose = setupListLabelsPreview(false);
    store.dispatch(bulkUpsertSessions(agents));
    store.dispatch(
      setSkills(LIST_LABELS_WORKSPACE, [
        { name: 'Interface craft', description: 'Reusable guidance', location: '', scope: 'user' },
        {
          name: 'Project conventions',
          description: 'Local guidance',
          location: '',
          scope: 'project',
        },
      ]),
    );
    store.dispatch(
      setServers([{ name: 'Local reference tools', type: 'stdio', command: 'echo fixture' }]),
    );
    return () => {
      agents.forEach((agent) => store.dispatch(removeSession(agent.id)));
      store.dispatch(setSkills(LIST_LABELS_WORKSPACE, []));
      store.dispatch(setServers([]));
      dispose();
    };
  });
</script>

<section
  class="flex w-full flex-wrap items-start gap-4 bg-background p-4 text-foreground"
  data-sidebar-list-rows
>
  {#each ['Context', 'Agents', 'Files', 'Browsers', 'Shells'] as card}
    <section
      class="min-w-0 rounded-lg border border-border bg-sidebar pb-4"
      style:width={`${cardWidth}px`}
      data-row-card={card}
    >
      <h6 class="px-4 pb-1 pt-4 text-ui font-semibold text-foreground" data-card-heading>{card}</h6>
      {#if card === 'Context'}
        <div class="px-4">
          <NotesPanel
            {notes}
            workspaceId={LIST_LABELS_WORKSPACE}
            flush
            selectedNoteId={openedNote}
            onOpenNote={(id) => (openedNote = id)}
          />
          <div data-context-resource>
            <ContextItemRow
              item={{
                id: 'row-link',
                type: 'browser-url',
                provider: 'browser',
                title: 'Interface reference',
                url: 'https://example.test/reference',
                createdAt: timestamp,
                updatedAt: timestamp,
              }}
              onClick={(item) => (openedNote = item.id)}
            />
          </div>
          <div data-context-skills><SkillsSection workspaceId={LIST_LABELS_WORKSPACE} /></div>
          <div data-context-mcp><McpServersSection workspaceId={LIST_LABELS_WORKSPACE} /></div>
        </div>
      {:else if card === 'Agents'}
        <div class="px-4">
          <WorkspaceAgentsList
            {agents}
            {selectedAgentId}
            onSelect={({ agentId }) => (selectedAgentId = agentId)}
          />
        </div>
      {:else if card === 'Files'}
        <div class="h-32 px-4">
          <VirtualizedFileTree
            {flattenedNodes}
            {selectedFile}
            onFileSelect={(path) => (selectedFile = path)}
            onToggleDirectory={() => (expanded = !expanded)}
          />
        </div>
      {:else if card === 'Browsers'}
        <div class="px-2">
          <SidebarBrowserGroup
            group={{
              ownerAgentId: null,
              ownerName: null,
              entries: [
                {
                  tab: {
                    id: 'row-browser',
                    type: 'browser',
                    title: 'Interface reference',
                    browserUrl: 'https://example.test/reference',
                    closable: true,
                  },
                  panelId: 'fixture-panel',
                  active: true,
                  hidden: false,
                },
                {
                  tab: {
                    id: 'row-browser-hidden',
                    type: 'browser',
                    title: 'A deliberately long hidden browser page title',
                    browserUrl: 'https://example.test/hidden',
                    closable: true,
                  },
                  active: false,
                  hidden: true,
                },
              ],
            }}
            onOpenTab={(id) => (openedBrowser = id)}
            onRestoreTab={(id) => (openedBrowser = id)}
          />
        </div>
      {:else}
        <WorkspaceShellList workspaceId={LIST_LABELS_WORKSPACE} />
      {/if}
    </section>
  {/each}
  <output class="sr-only" data-row-selection
    >{JSON.stringify({ openedNote, selectedAgentId, selectedFile, openedBrowser })}</output
  >
</section>
