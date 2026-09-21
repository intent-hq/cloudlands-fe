<script lang="ts" module>
  import { definePreview } from '$lib/component-catalog/preview-definition';

  export const preview = definePreview<{ unread: boolean }>({
    id: 'context-rows',
    title: 'Context rows',
    defaultState: 'unread',
    states: {
      unread: { props: { unread: true } },
      read: { props: { unread: false } },
    },
  });
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import { store as appStore } from '$store/renderer/store';
  import {
    computeUnreadNotesSuccess,
    markNoteRead,
  } from '$store/renderer/slices/note-read-tracking/note-read-tracking-slice';
  import { setSkills } from '$store/renderer/slices/skills/skills-slice';
  import { ContentType, NoteVisibility, type Note } from '$shared/types';
  import NotesPanel from './NotesPanel.svelte';
  import SkillsSection from './SkillsSection.svelte';

  let { unread = true }: { unread?: boolean } = $props();
  const workspaceId = 'context-rows-preview';
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
  const notes = [
    makeNote('context-plan', 'Implementation plan', {
      content: '- [ ] [Verify keyboard navigation](intent://local/task/context-task)',
    }),
    makeNote('context-task', 'Verify keyboard navigation', {
      parentId: 'context-plan' as Note['parentId'],
      metadata: { task: { status: 'in_progress' } },
    }),
    makeNote('context-reference', 'Reference notes'),
  ];
  let opened = $state('');
  function openNote(id: string) {
    opened = id;
    appStore.dispatch(markNoteRead(workspaceId, id));
  }
  onMount(() => {
    appStore.dispatch(computeUnreadNotesSuccess(unread ? notes.map((note) => note.id) : []));
    appStore.dispatch(
      setSkills(workspaceId, [
        { name: 'Interface craft', description: 'Reusable guidance', location: '', scope: 'user' },
        {
          name: 'Project conventions',
          description: 'Local guidance',
          location: '',
          scope: 'project',
        },
      ]),
    );
    return () => {
      appStore.dispatch(computeUnreadNotesSuccess([]));
      appStore.dispatch(setSkills(workspaceId, []));
    };
  });
</script>

<section
  class="w-full max-w-80 rounded-xl border border-border bg-background p-4 text-foreground"
  data-testid="context-rows-preview"
>
  <h2 class="mb-2 text-sm font-semibold">Context</h2>
  <p class="mb-4 text-sm text-muted-foreground">Safe task and skill fixtures.</p>
  <div class="overflow-auto" data-testid="context-scrollport">
    <NotesPanel {notes} {workspaceId} flush onOpenNote={openNote} />
    <div data-testid="context-skills"><SkillsSection {workspaceId} /></div>
  </div>
  <output class="sr-only" data-testid="opened-note">{opened}</output>
</section>
