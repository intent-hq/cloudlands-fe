<script lang="ts">
  import type { TabTypeComponentProps } from '$features/layout/tab-types/registry';
  import NoteWithComments from '$lib/components/workspace/NoteWithComments.svelte';
  import { createWorkspaceId, type Workspace } from '$shared/types';

  let { tab, workspaceId, isPanelFocused }: TabTypeComponentProps = $props();
  // svelte-ignore state_referenced_locally - panel identity is immutable for this test component
  const initialWorkspaceId = $state.snapshot(workspaceId);

  const workspace = {
    id: createWorkspaceId(initialWorkspaceId),
    title: 'Drag preview workspace',
    branch: 'test',
    changesets: [],
    timeline: [],
    conversationInfo: [],
    status: 'Active',
    createdAt: '2026-08-27T00:00:00.000Z',
    updatedAt: '2026-08-27T00:00:00.000Z',
  } as Workspace;
</script>

<NoteWithComments
  {workspace}
  noteId={tab.id}
  content={`# ${tab.title}\n\nRetained note content`}
  editable={false}
  showSuggestions={false}
  showComments={false}
  {isPanelFocused}
/>
