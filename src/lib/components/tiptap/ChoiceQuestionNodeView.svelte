<script lang="ts">
  /**
   * ChoiceQuestion NodeView Component
   *
   * Renders the question text with inline editing.
   * Simpler than ChoiceOption - no selection state, just editable text.
   *
   * Key pattern: Use NodeViewContent for the editable text area.
   * This prevents focus loss during typing.
   */
  import type { NodeViewProps } from '@tiptap/core';
  import {
  NodeViewWrapper,
  NodeViewContent,
} from '$lib/utils/tiptap/svelte-node-view';

  // Props are passed directly from SvelteNodeViewRenderer and are reactive via $state
  let {

    node: _node,

    selected: _selected,

    updateAttributes: _updateAttributes,

    getPos: _getPos,

    deleteNode: _deleteNode,
  }: NodeViewProps = $props();
</script>

<NodeViewWrapper
  as="div"
  class="choice-question-view mb-2 font-semibold text-gray-800 dark:text-gray-200"
  data-type="choice-question"
>
  <!-- Editable question text -->
  <!-- NodeViewContent provides contentDOM for inline editing -->
  <div class="editable-question outline-none" data-testid="editable-content">
    <NodeViewContent />
  </div>
</NodeViewWrapper>
