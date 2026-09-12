<script lang="ts">
  import { NodeViewWrapper } from 'svelte-tiptap';
  import type { NodeViewProps } from '@tiptap/core';
  import type { ArtifactPrimitive } from '$shared/types/notes-primitives';
  import ArtifactBlock from './ArtifactBlock.svelte';
  let { node, extension, updateAttributes, editor }: NodeViewProps = $props();
  let primitive = $derived(node.attrs.data as ArtifactPrimitive);
</script>

<NodeViewWrapper>
  <div contenteditable="false">
    {#key `${extension.options.workspaceId}:${'noteId' in primitive.artifact ? primitive.artifact.noteId + ':' + primitive.artifact.artifactId : primitive.artifact.document.id}`}
      <ArtifactBlock
        block={primitive.artifact}
        workspaceId={extension.options.workspaceId}
        readonly={!editor.isEditable}
        onChange={(document) =>
          updateAttributes({ data: { ...primitive, artifact: { document } } })}
      />
    {/key}
  </div>
</NodeViewWrapper>
