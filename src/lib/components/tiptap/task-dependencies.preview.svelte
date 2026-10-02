<script lang="ts" module>
  import { definePreview } from '$lib/component-catalog/preview-definition';

  export const preview = definePreview({
    id: 'task-dependencies',
    title: 'Task dependency labels',
    defaultState: 'adjacency',
    states: { adjacency: { props: {} } },
    captureReadiness: { selector: '[data-task-row-waits-on]', count: 3 },
  });
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import { Editor } from '@tiptap/core';
  import Document from '@tiptap/extension-document';
  import Paragraph from '@tiptap/extension-paragraph';
  import Text from '@tiptap/extension-text';
  import Link from '@tiptap/extension-link';
  import TaskList from '@tiptap/extension-task-list';
  import { CustomTaskItem } from './CustomTaskItem';
  import { store } from '$store/renderer/store';
  import {
    loadWorkspaceNotesSucceeded,
    clearWorkspaceNotesForWorkspaces,
  } from '$store/renderer/slices/workspace-notes/workspace-notes-slice';
  import { ContentType, NoteVisibility, type Note } from '$shared/types';
  import { NoteId, WorkspaceId } from '$shared/types/branded-ids';

  let host: HTMLDivElement;
  const workspaceId = WorkspaceId('task-dependencies-preview');
  const notes: Note[] = [
    { id: 'prepare', title: 'Prepare the implementation' },
    { id: 'review', title: 'Review the previous task', dependsOn: ['prepare'] },
    { id: 'publish', title: 'Publish after both reviews', dependsOn: ['review', 'finished'] },
    { id: 'verify', title: 'Verify the earlier implementation', dependsOn: ['prepare'] },
  ].map(({ id, title, dependsOn }) => ({
    id: NoteId(id),
    workspaceId,
    title,
    content: '',
    contentType: ContentType.Markdown,
    tags: [],
    isPinned: false,
    isArchived: false,
    visibility: NoteVisibility.Workspace,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    metadata: {
      task: {
        status: 'not_started',
        dependsOn: dependsOn?.map(NoteId),
        unmetDependsOn: dependsOn?.slice(0, 1).map(NoteId),
      },
    },
  }));

  onMount(() => {
    store.dispatch(
      loadWorkspaceNotesSucceeded([workspaceId], {
        [workspaceId]: [
          ...notes,
          {
            ...notes[0],
            id: NoteId('finished'),
            title: 'Earlier review',
            metadata: { task: { status: 'complete' } },
          },
        ],
      }),
    );
    const editor = new Editor({
      element: host,
      extensions: [
        Document,
        Paragraph,
        Text,
        Link.configure({ openOnClick: false }),
        TaskList,
        CustomTaskItem.configure({ workspaceId }),
      ],
      content: {
        type: 'doc',
        content: [
          {
            type: 'taskList',
            content: notes.map(({ id, title }) => ({
              type: 'taskItem',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    {
                      type: 'text',
                      text: title,
                      marks: [{ type: 'link', attrs: { href: `intent://local/task/${id}` } }],
                    },
                  ],
                },
              ],
            })),
          },
        ],
      },
    });
    return () => {
      editor.destroy();
      store.dispatch(clearWorkspaceNotesForWorkspaces([workspaceId]));
    };
  });
</script>

<section
  class="w-full rounded-lg border border-border bg-background p-4 text-foreground"
  data-task-dependencies-preview
>
  <div bind:this={host}></div>
</section>
