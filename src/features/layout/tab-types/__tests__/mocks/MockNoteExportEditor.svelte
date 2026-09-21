<script lang="ts">
  let {
    workspace,
    noteId,
    content,
  }: { workspace: { id: string }; noteId: string; content: string } = $props();
  // svelte-ignore state_referenced_locally
  const ownerWorkspaceId = workspace.id;
  // svelte-ignore state_referenced_locally
  const ownerNoteId = noteId;
  let draft = $state<string | undefined>();
  export function getCurrentMarkdown(workspaceId: string, targetId: string) {
    return workspaceId === ownerWorkspaceId && targetId === ownerNoteId ? draft : undefined;
  }
</script>

<div data-testid="mock-component">
  <textarea
    aria-label="Mock note draft"
    value={draft ?? content}
    oninput={(event) => (draft = event.currentTarget.value)}></textarea>
</div>
