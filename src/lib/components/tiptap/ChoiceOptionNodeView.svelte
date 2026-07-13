<script lang="ts">
  /**
   * ChoiceOption NodeView Component
   *
   * Renders a choice option with:
   * - Selection button (radio button indicator)
   * - Editable text content (via NodeViewContent)
   *
   * Uses the svelte-tiptap style SvelteNodeViewRenderer where NodeViewProps
   * are passed directly as reactive props via $props().
   */
  import type { NodeViewProps } from '@tiptap/core';
  import {
  NodeViewWrapper,
  NodeViewContent,
} from '$lib/utils/tiptap/svelte-node-view';

  // Props are passed directly from SvelteNodeViewRenderer and are reactive via $state
  let { node, editor, getPos }: NodeViewProps = $props();

  // Derive reactive values from props
  let selected = $derived((node.attrs.selected as boolean) ?? false);

  /**
   * Handle option click to select this option (and deselect others)
   *
   * Choice blocks are radio-button style - only one option can be selected at a time.
   * When inside a ChoiceBlock, clicking an option deselects all siblings.
   * When standalone (for testing), just toggles this option.
   */
  function handleOptionClick() {
    const pos = getPos();
    if (typeof pos !== 'number') return;

    const tr = editor.state.tr;
    const resolvedPos = editor.state.doc.resolve(pos);

    // Find the parent choiceBlock
    let choiceBlockDepth = -1;
    for (let d = resolvedPos.depth; d > 0; d--) {
      if (resolvedPos.node(d).type.name === 'choiceBlock') {
        choiceBlockDepth = d;
        break;
      }
    }

    if (choiceBlockDepth === -1) {
      // Not in a choiceBlock - just toggle (standalone testing scenario)
      tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        selected: !selected,
      });
      editor.view.dispatch(tr);
      return;
    }

    // We found the parent choiceBlock - deselect all its choiceOption children
    const choiceBlock = resolvedPos.node(choiceBlockDepth);
    const choiceBlockPos = resolvedPos.before(choiceBlockDepth);

    // Iterate through children and deselect all choiceOption nodes
    let currentPos = choiceBlockPos + 1; // Start inside the choiceBlock
    for (let i = 0; i < choiceBlock.childCount; i++) {
      const child = choiceBlock.child(i);

      if (child.type.name === 'choiceOption') {
        tr.setNodeMarkup(currentPos, undefined, {
          ...child.attrs,
          selected: false,
        });
      }

      currentPos += child.nodeSize;
    }

    // Now select this specific option
    tr.setNodeMarkup(pos, undefined, {
      ...node.attrs,
      selected: true,
    });

    editor.view.dispatch(tr);
  }

  /**
   * Handle keyboard events for accessibility
   */
  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleOptionClick();
    }
  }
</script>

<NodeViewWrapper
  as="div"
  class="choice-option-view flex items-start gap-2 py-0.5 px-0.5 rounded transition-colors hover:bg-muted"
  data-type="choice-option"
  data-selected={selected}
>
  <!-- Selection button (radio indicator) - clickable to toggle selection -->
  <!-- Keep .selection-button class for test compatibility -->
  <button
    type="button"
    class="selection-button choice-option-marker cursor-pointer bg-transparent border-none p-0 text-inherit"
    onclick={(e) => {
      e.stopPropagation();
      handleOptionClick();
    }}
    onkeydown={handleKeyDown}
    tabindex={0}
    aria-pressed={selected}
  >
    {selected ? '●' : '○'}
  </button>

  <!-- Editable text content -->
  <!-- This is the key: NodeViewContent provides contentDOM for inline editing -->
  <div
    class="editable-text flex-1 bg-transparent border-none outline-none"
    data-testid="editable-content"
  >
    <NodeViewContent />
  </div>
</NodeViewWrapper>
