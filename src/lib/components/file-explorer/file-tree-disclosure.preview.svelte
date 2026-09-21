<script lang="ts" module>
  import { definePreview } from '$lib/component-catalog/preview-definition';

  export const preview = definePreview({
    id: 'file-tree-disclosure',
    title: 'File tree disclosure alignment',
    defaultState: 'default',
    states: { default: { props: {} } },
  });
</script>

<script lang="ts">
  import { onDestroy } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import ExpandableFileSearch from '$lib/components/workspace/sidebar/ExpandableFileSearch.svelte';
  import VirtualizedFileTree from './VirtualizedFileTree.svelte';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { store } from '$store/renderer/store';
  import type { FlattenedFileNode } from '$store/renderer/slices/file-explorer/file-explorer-types';
  import type { FileNode } from '$shared/types';
  import Fa from 'svelte-fa';
  import { faPlus } from '@fortawesome/free-solid-svg-icons';

  const disposeStore = startRootStoreLifecycle(store, { startSagas: () => [] });
  onDestroy(disposeStore);
  let tree: VirtualizedFileTree | null = $state(null);
  let query = $state('');
  let selected = $state('');
  let expanded = $state<string[]>([]);
  const root: FileNode[] = [
    {
      name: 'src',
      path: '/project/src',
      type: 'directory',
      children: [
        {
          name: 'components',
          path: '/project/src/components',
          type: 'directory',
          children: [
            {
              name: 'Button.svelte',
              path: '/project/src/components/Button.svelte',
              type: 'file',
              children: [],
            },
          ],
        },
        { name: 'main.ts', path: '/project/src/main.ts', type: 'file', children: [] },
      ],
    },
    { name: 'tests', path: '/project/tests', type: 'directory', children: [] },
    { name: 'README.md', path: '/project/README.md', type: 'file', children: [] },
  ];
  function flatten(nodes: FileNode[], depth = 0): FlattenedFileNode[] {
    return nodes.flatMap((node) => {
      const isExpanded = expanded.includes(node.path);
      const current: FlattenedFileNode = {
        node: { ...node, children: (node.children ?? []).map((child) => child.path) },
        depth,
        isExpanded,
        isLoading: false,
      };
      if (query)
        return [current, ...flatten(node.children ?? [], depth + 1)].filter((item) =>
          item.node.name.toLowerCase().includes(query.toLowerCase()),
        );
      return [current, ...(isExpanded ? flatten(node.children ?? [], depth + 1) : [])];
    });
  }
  const flattenedNodes = $derived(flatten(root));
</script>

<section
  class="flex h-72 w-full flex-col bg-sidebar px-4 py-3 text-foreground"
  data-file-tree-preview
>
  <div class="flex shrink-0 items-center gap-2 pb-2" data-file-tree-toolbar>
    <ExpandableFileSearch bind:query onKeydown={(event) => tree?.handleKeydown(event)} />
    <Button
      variant="ghost"
      size="icon-compact"
      class="shrink-0 text-subtle"
      aria-label="New file"
      onclick={() => tree?.startCreatingFile()}
    >
      <Fa icon={faPlus} class="h-3 w-3" />
    </Button>
  </div>
  <div class="min-h-0 flex-1">
    <VirtualizedFileTree
      bind:this={tree}
      {flattenedNodes}
      selectedFile={selected}
      onFileSelect={(path) => (selected = path)}
      onToggleDirectory={(node) =>
        (expanded = expanded.includes(node.path)
          ? expanded.filter((path) => path !== node.path)
          : [...expanded, node.path])}
    />
  </div>
  <output class="sr-only" data-file-tree-selected>{selected}</output>
</section>
