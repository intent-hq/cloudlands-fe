<script lang="ts">
  import { NodeViewWrapper } from '$lib/utils/tiptap/svelte-node-view';
  import type { NodeViewProps } from '@tiptap/core';
  import DiffViewer from '$lib/components/ui/diff/DiffViewer.svelte';
  import {
    decodeDiffContent,
    withSyntheticDiffHeaders,
  } from '$lib/utils/diff-patch-utils';

  // TipTap NodeViewProps
  let { node, selected }: NodeViewProps = $props();

  // Extract diff code from node attributes
  let savedCode = $derived<string>(node?.attrs?.code || '');

  const content = $derived(decodeDiffContent(savedCode));
  const patch = $derived(withSyntheticDiffHeaders(content));
</script>

<NodeViewWrapper class="diff-block-wrapper" data-drag-handle>
  <div class="diff-block" class:selected contenteditable="false">
    <DiffViewer {patch} showHeader={false} />
  </div>
</NodeViewWrapper>

<style>
  .diff-block-wrapper {
    display: block;
  }

  .diff-block {
    position: relative;
  }
</style>
