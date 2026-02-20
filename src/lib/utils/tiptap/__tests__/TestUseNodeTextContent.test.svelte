<script lang="ts">
  import { useNodeTextContent } from '../use-node-text-content.svelte';
  import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
  import type { Editor } from '@tiptap/core';

  let {
    node,
    editor,
    getPos,
    separator,
  }: {
    node: ProseMirrorNode;
    editor: Editor;
    getPos: () => number | undefined;
    separator?: string;
  } = $props();

  const textContent = useNodeTextContent(node, editor, getPos, separator);
</script>

<div>{textContent.value}</div>
