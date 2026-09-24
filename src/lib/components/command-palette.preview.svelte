<script lang="ts" module>
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import { ContentType, NoteVisibility, type Note } from '$shared/types';
  import { NoteId, WorkspaceId } from '$shared/types/branded-ids';
  import { ChangeStage } from '$features/file-tracking/types';
  import { store as appStore } from '$store/renderer/store';
  import {
    clearWorkspaceNotesForWorkspaces,
    loadWorkspaceNotesSucceeded,
  } from '$store/renderer/slices/workspace-notes/workspace-notes-slice';
  import { clearWorkspace, setChangesData } from '$store/renderer/slices/changes/changes-slice';

  const workspaceId = WorkspaceId('preview-command-palette');
  const timestamp = '2026-09-15T12:00:00.000Z';
  function setup() {
    const notes: Note[] = Array.from({ length: 16 }, (_, index) => ({
      id: NoteId(`preview-palette-note-${index}`),
      workspaceId,
      title: index === 0 ? 'Project context' : `Context ${index}: accessible keyboard navigation`,
      content: '',
      contentType: ContentType.Markdown,
      tags: ['Design review', 'Keyboard and pointer interactions'],
      isPinned: false,
      isArchived: false,
      visibility: NoteVisibility.Workspace,
      parentId: index > 0 ? NoteId('preview-palette-note-0') : undefined,
      createdAt: timestamp,
      updatedAt: timestamp,
    }));
    appStore.dispatch(loadWorkspaceNotesSucceeded([workspaceId], { [workspaceId]: notes }));
    appStore.dispatch(
      setChangesData(
        workspaceId,
        ['src/components/navigation/CommandSearch.svelte', 'src/styles/interaction-tokens.css'].map(
          (path, index) => ({
            id: `preview-palette-change-${index}`,
            file: path,
            relativePath: path,
            stage: ChangeStage.Unstaged,
            stats: { additions: 12, deletions: 3 },
            attribution: { timestamp: Date.parse(timestamp) },
          }),
        ),
        false,
        2,
      ),
    );
    return () => {
      appStore.dispatch(clearWorkspaceNotesForWorkspaces([workspaceId]));
      appStore.dispatch(clearWorkspace(workspaceId));
    };
  }

  export const preview = definePreview<{ initialQuery: string }>({
    id: 'command-palette',
    title: 'Command palette',
    defaultState: 'grouped',
    states: {
      grouped: { props: { initialQuery: '' }, setup },
      context: { props: { initialQuery: '#' }, setup },
      multiplayer: { props: { initialQuery: 'multiplayer' }, setup },
    },
  });
</script>

<script lang="ts">
  import CommandPalette from './CommandPalette.svelte';
  import { Button } from '$lib/components/ui/button';
  let { initialQuery = '' }: { initialQuery?: string } = $props();
  let isOpen = $state(true);
</script>

<div class="min-h-[700px]" data-command-palette-preview>
  <Button onclick={() => (isOpen = true)}>Open palette</Button>
  <CommandPalette bind:isOpen {workspaceId} {initialQuery} onClose={() => (isOpen = false)} />
</div>
