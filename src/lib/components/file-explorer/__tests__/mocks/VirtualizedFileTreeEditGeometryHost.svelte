<script lang="ts">
  import { onDestroy } from 'svelte';
  import VirtualizedFileTree from '../../VirtualizedFileTree.svelte';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { store } from '$store/renderer/store';
  import type { FlattenedFileNode } from '$store/renderer/slices/file-explorer/file-explorer-types';

  interface Props {
    theme?: 'light' | 'dark';
  }

  let { theme = 'light' }: Props = $props();
  const disposeStore = startRootStoreLifecycle(store, { startSagas: () => [] });
  const flattenedNodes: FlattenedFileNode[] = [
    {
      node: { name: 'README.md', path: '/project/README.md', type: 'file', children: [] },
      depth: 0,
      isExpanded: false,
      isLoading: false,
    },
    {
      node: { name: 'src', path: '/project/src', type: 'directory', children: [] },
      depth: 0,
      isExpanded: true,
      isLoading: false,
    },
    {
      node: { name: 'nested.ts', path: '/project/src/nested.ts', type: 'file', children: [] },
      depth: 1,
      isExpanded: false,
      isLoading: false,
    },
  ];

  onDestroy(disposeStore);
</script>

<section class:dark={theme === 'dark'} class="h-32 w-80 bg-background">
  <VirtualizedFileTree {flattenedNodes} onRenameFile={() => {}} />
</section>
