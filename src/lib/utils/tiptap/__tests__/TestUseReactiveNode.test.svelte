<script lang="ts">
  import { useReactiveNode } from '../use-reactive-node.svelte';
  import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
  import type { Editor } from '@tiptap/core';

  let {
    node,
    editor,
    getPos,
    attributeKeys,
  }: {
    node: ProseMirrorNode;
    editor: Editor;
    getPos: () => number | undefined;
    attributeKeys?: string[];
  } = $props();

  const reactiveNode = useReactiveNode(node, editor, getPos, attributeKeys);

  let checked = $derived(reactiveNode.value?.attrs.checked);
  let status = $derived(reactiveNode.value?.attrs.status);
  let counter = $derived(reactiveNode.updateCounter);
</script>

<div>
  <div>checked: {checked}</div>
  <div>status: {status}</div>
  <div>counter: {counter}</div>
</div>
