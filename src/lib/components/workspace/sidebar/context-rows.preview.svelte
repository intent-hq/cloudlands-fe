<script lang="ts" module>
  import { definePreview } from '$lib/component-catalog/preview-definition';

  interface Props {
    unread?: boolean;
    hierarchy?: boolean;
    workspaceId?: string;
    searchQuery?: string;
    loading?: boolean;
    empty?: boolean;
  }
  export const preview = definePreview<Props>({
    id: 'context-rows',
    title: 'Context rows',
    defaultState: 'unread',
    states: {
      unread: { props: { unread: true } },
      read: { props: { unread: false } },
      hierarchy: { props: { hierarchy: true } },
      search: { props: { hierarchy: true, searchQuery: 'Verify keyboard' } },
      loading: { props: { hierarchy: true, loading: true } },
      empty: { props: { hierarchy: true, empty: true } },
    },
  });
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import { setupContextRowsPreview } from '../../../../test/context-rows-preview';
  import ContextPanel from './ContextPanel.svelte';
  import { workspaceCatalogReceived } from '$store/renderer/slices/provider-catalog/provider-catalog-slice';
  import { setComposerContextItems } from '$store/renderer/slices/transient-ui/transient-ui-slice';
  import { store as appStore } from '$store/renderer/store';
  import {
    computeUnreadNotesSuccess,
    markNoteRead,
  } from '$store/renderer/slices/note-read-tracking/note-read-tracking-slice';
  import { setSkills } from '$store/renderer/slices/skills/skills-slice';
  import { ContentType, NoteVisibility, type Note } from '$shared/types';
  import NotesPanel from './NotesPanel.svelte';
  import SkillsSection from './SkillsSection.svelte';

  let {
    unread = true,
    hierarchy = false,
    workspaceId = 'context-rows-preview',
    searchQuery = '',
    loading = false,
    empty = false,
  }: Props = $props();
  const timestamp = '2026-09-16T00:00:00.000Z';
  const makeNote = (id: string, title: string, extra: Partial<Note> = {}): Note =>
    ({
      id,
      workspaceId,
      title,
      content: '',
      contentType: ContentType.Markdown,
      tags: [],
      isPinned: false,
      isArchived: false,
      visibility: NoteVisibility.Workspace,
      createdAt: timestamp,
      updatedAt: timestamp,
      ...extra,
    }) as Note;
  const baseNotes = [
    makeNote('context-plan', 'Implementation plan', {
      content: '- [ ] [Verify keyboard navigation](intent://local/task/context-task)',
    }),
    makeNote('context-task', 'Verify keyboard navigation', {
      parentId: 'context-plan' as Note['parentId'],
      metadata: { task: { status: 'in_progress' } },
    }),
    makeNote('context-reference', 'Reference notes'),
  ];
  const specTasks = Array.from({ length: 14 }, (_, index) =>
    makeNote(`spec-task-${index}`, `Implementation task ${index + 1}`, {
      parentId: 'spec' as Note['parentId'],
      metadata: { task: { status: index < 9 ? 'complete' : 'not_started' } },
    }),
  );
  const notes = $derived(
    empty
      ? []
      : hierarchy
        ? [
            makeNote('spec', 'Spec', {
              content: specTasks
                .map((note) => `- [ ] [${note.title}](intent://local/task/${note.id})`)
                .join('\n'),
            }),
            ...specTasks,
            ...baseNotes,
            makeNote('composer', 'Dock composer spec', {
              content: '- [ ] [Check layout](intent://local/task/composer-task)',
            }),
            makeNote('composer-task', 'Check layout', {
              parentId: 'composer' as Note['parentId'],
              metadata: { task: { status: 'not_started' } },
            }),
          ]
        : baseNotes,
  );
  let opened = $state('');
  function openNote(id: string) {
    opened = id;
    appStore.dispatch(markNoteRead(workspaceId, id));
  }
  onMount(() => {
    const dispose = setupContextRowsPreview(workspaceId);
    appStore.dispatch(computeUnreadNotesSuccess(unread ? notes.map((note) => note.id) : []));
    appStore.dispatch(
      workspaceCatalogReceived(
        workspaceId,
        {
          mcpServers: empty
            ? []
            : [
                { name: 'GitHub', type: 'stdio', command: 'github' },
                { name: 'Figma', type: 'stdio', command: 'figma' },
                { name: 'Linear', type: 'stdio', command: 'linear' },
              ],
          catalog: { providers: [] },
          settings: [],
          specialists: [],
          readiness: {},
        } as never,
        0,
      ),
    );
    appStore.dispatch(
      setComposerContextItems(
        workspaceId,
        'preview-agent',
        empty
          ? []
          : Array.from({ length: 5 }, (_, index) => ({
              id: `attachment-${index}`,
              type: 'file',
              label: `Reference ${index + 1}.svg`,
              imageMimeType: 'image/svg+xml',
              imageData: btoa(
                `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="140"><rect width="200" height="140" fill="#e4e4e7"/><rect x="20" y="20" width="160" height="100" rx="8" fill="#fff"/><path d="M40 50H160M40 70H130M40 90H150" stroke="#a1a1aa" stroke-width="6"/><text x="150" y="115" fill="#71717a">${index + 1}</text></svg>`,
              ),
            })),
      ),
    );
    appStore.dispatch(
      setSkills(
        workspaceId,
        empty
          ? []
          : [
              {
                name: 'Interface craft',
                description: 'Reusable guidance',
                location: '',
                scope: 'user',
              },
              {
                name: 'Project conventions',
                description: 'Local guidance',
                location: '',
                scope: 'project',
              },
            ],
      ),
    );
    return () => {
      dispose();
      appStore.dispatch(computeUnreadNotesSuccess([]));
      appStore.dispatch(setSkills(workspaceId, []));
    };
  });
</script>

<section
  class="w-full rounded-xl border border-border bg-sidebar p-3 text-foreground"
  data-testid="context-rows-preview"
>
  <h2 class="mb-2 px-2 type-caption font-medium">Context</h2>
  <div class="max-h-[640px] overflow-auto" data-testid="context-scrollport">
    {#if hierarchy}
      <ContextPanel
        {notes}
        {workspaceId}
        {searchQuery}
        {loading}
        showAddSection={false}
        onOpenNote={openNote}
      />
    {:else}
      <NotesPanel {notes} {workspaceId} flush onOpenNote={openNote} />
      <div data-testid="context-skills"><SkillsSection {workspaceId} /></div>
    {/if}
  </div>
  <output class="sr-only" data-testid="opened-note">{opened}</output>
</section>
