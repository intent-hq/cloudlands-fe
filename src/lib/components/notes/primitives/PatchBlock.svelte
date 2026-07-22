<script lang="ts">
  import { NodeViewWrapper } from 'svelte-tiptap';
  import type { NodeViewProps } from '@tiptap/core';
  import type { PatchPrimitive } from '$shared/types/notes-primitives';
  import { PatchBlockContent } from '$lib/components/ui/diff';

  // TipTap NodeViewProps
  let { node, extension }: NodeViewProps = $props();

  // Get primitive data from node
  let primitive = $derived(node?.attrs?.data as PatchPrimitive);

  // Get workspaceId from extension options (used for the linked-agent avatar)
  let workspaceId = $derived(extension?.options?.workspaceId as string | undefined);
</script>

<NodeViewWrapper>
  <PatchBlockContent
    patches={primitive?.patches ?? []}
    label={primitive?.label || 'Patch'}
    lastApply={primitive?.lastApply}
    linkedAgentId={primitive?.createdByAgentId}
    {workspaceId}
  />
</NodeViewWrapper>
