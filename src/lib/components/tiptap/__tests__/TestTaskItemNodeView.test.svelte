<script lang="ts">
  import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
  import type { Editor, NodeViewProps } from '@tiptap/core';
  import { setContext } from 'svelte';
  import { NODE_VIEW_CONTEXT_KEY } from '$lib/utils/tiptap/svelte-node-view/context';

  // Import the actual component
  import TaskItemNodeView from '../TaskItemNodeView.svelte';

  interface Props {
    node: ProseMirrorNode;
    editor: Editor;
    getPos: () => number | undefined;
  }

  let { node, editor, getPos }: Props = $props();

  // Set up context for drag handling (NodeViewWrapper uses this)
  setContext(NODE_VIEW_CONTEXT_KEY, {
    contentDOMElement: null,

    onDragStart: (_event: DragEvent) => {
      // Mock implementation
    },
  });

  // Create mock NodeViewProps to pass to the component
  // Using 'as NodeViewProps' to satisfy type checker for test mocks
  // Use $derived.by to create a derived value that updates when props change
  const nodeViewProps = $derived.by(() => ({
    node,
    editor,
    getPos,
    selected: false,
    decorations: [],
    innerDecorations: null as any,
    view: editor.view,
    extension: {} as any,
    HTMLAttributes: {},
    updateAttributes: (attrs: Record<string, unknown>) => {
      // Mock implementation - in tests, this would update the node
      console.log('updateAttributes called with:', attrs);
    },
    deleteNode: () => {
      // Mock implementation
      console.log('deleteNode called');
    },
  })) as NodeViewProps;
</script>

<!-- Pass props directly to the component (svelte-tiptap style) -->
<TaskItemNodeView {...nodeViewProps} />
