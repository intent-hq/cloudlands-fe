<script lang="ts">
  import { onDestroy } from 'svelte';
  import VirtualizedFileTree from '../../VirtualizedFileTree.svelte';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { store } from '$store/renderer/store';
  import type { FlattenedFileNode } from '$store/renderer/slices/file-explorer/file-explorer-types';

  const disposeStore = startRootStoreLifecycle(store, { startSagas: () => [] });
  const flattenedNodes: FlattenedFileNode[] = Array.from({ length: 40 }, (_, index) => {
    const name = `file-${String(index).padStart(2, '0')}.pdf`;
    return {
      node: { name, path: `/project/${name}`, type: 'file', children: [] },
      depth: 0,
      isExpanded: false,
      isLoading: false,
    };
  });

  let tree: VirtualizedFileTree | null = $state(null);
  let selectedFile = $state('');

  // Mirrors file-tree-view's selection effect: reveal after 100 ms + 50 ms + a frame.
  function select(path: string) {
    selectedFile = path;
    setTimeout(() => {
      setTimeout(() => requestAnimationFrame(() => tree?.scrollToPath(path)), 50);
    }, 100);
  }

  (window as unknown as { __revealTreePath?: (path: string) => void }).__revealTreePath = (path) =>
    tree?.scrollToPath(path);

  onDestroy(disposeStore);
</script>

<section class="w-80 bg-background" style="height: 250px;">
  <VirtualizedFileTree bind:this={tree} {flattenedNodes} {selectedFile} onFileSelect={select} />
</section>
