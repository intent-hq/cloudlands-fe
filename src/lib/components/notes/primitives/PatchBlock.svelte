<script lang="ts">
  import { NodeViewWrapper } from 'svelte-tiptap';
  import type { NodeViewProps } from '@tiptap/core';
  import type { PatchPrimitive } from '$shared/types/notes-primitives';
  import { PatchBlockContent } from '$lib/components/ui/diff';

  // TipTap NodeViewProps
  let { node }: NodeViewProps = $props();

  // Get primitive data from node
  let primitive = $derived(node?.attrs?.data as PatchPrimitive);
</script>

<NodeViewWrapper>
  <PatchBlockContent
    patches={primitive?.patches ?? []}
    label={primitive?.label || 'Patch'}
    lastApply={primitive?.lastApply}
    linkedAgentId={primitive?.createdByAgentId}
  />
</NodeViewWrapper>
