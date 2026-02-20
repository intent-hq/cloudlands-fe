<script lang="ts">
  /**
   * PasteChipNodeView - Renders a pasted text block as an inline chip
   *
   * Displays a clipboard icon + "Pasted N lines" label with a tooltip
   * showing a preview of the pasted content.
   */
  import type { NodeViewProps } from '@tiptap/core';
  import { NodeViewWrapper } from '$lib/utils/tiptap/svelte-node-view';
  import { TooltipRich } from '$lib/components/ui/tooltip';
  import Fa from 'svelte-fa';
  import { faClipboard, faICursor, faXmark } from '@fortawesome/free-solid-svg-icons';
  import Button from '../ui/button/button.svelte';

  let { node, selected, deleteNode, editor, getPos }: NodeViewProps = $props();

  const pastedContent = $derived(node.attrs.content as string);
  const lineCount = $derived(node.attrs.lineCount as number);

  /** Preview text: first ~500 chars */
  const previewText = $derived(
    pastedContent.length > 500 ? pastedContent.slice(0, 500) + '...' : pastedContent,
  );

  function handleDelete(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    deleteNode();
  }

  /** Replace the chip with its raw text content */
  function handleExpand(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!editor || !getPos) return;
    const pos = getPos();
    if (typeof pos !== 'number') return;

    editor
      .chain()
      .focus()
      .command(({ tr }) => {
        if (!pastedContent) {
          // Nothing to expand — just delete the chip
          tr.delete(pos, pos + node.nodeSize);
        } else {
          // Replace the chip node with the raw text
          tr.replaceWith(pos, pos + node.nodeSize, editor.schema.text(pastedContent));
        }
        return true;
      })
      .run();
  }
</script>

<NodeViewWrapper as="span" class="inline">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <span class="paste-chip-wrapper group/pill relative inline-flex items-center">
    <TooltipRich side="top" align="start" delayDuration={300} interactive={true} maxWidth="24rem">
      {#snippet trigger()}
        <span
          class="paste-chip-pill inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 pr-9 text-xs font-medium transition-colors
            {selected
            ? 'bg-primary/20 text-primary ring-1 ring-primary/30'
            : 'bg-muted/60 text-foreground/80 hover:bg-muted hover:text-foreground'}"
        >
          <Fa icon={faClipboard} size="xs" class="shrink-0 opacity-40" />
          <span class="whitespace-nowrap">Pasted {lineCount} lines</span>
        </span>
      {/snippet}

      {#snippet content()}
        <div class="space-y-1.5 max-w-96 min-w-48">
          <div class="flex items-center gap-1.5">
            <Fa icon={faClipboard} size="xs" class="opacity-40" />
            <span class="text-[10px] font-medium text-muted-foreground uppercase tracking-wide"
              >Pasted text</span
            >
            <span class="text-[10px] text-muted-foreground/60">· {lineCount} lines</span>
          </div>
          <div
            class="text-xs text-muted-foreground whitespace-pre-wrap break-words leading-relaxed line-clamp-[12]"
          >
            {previewText}
          </div>
        </div>
      {/snippet}
    </TooltipRich>

    <div class="absolute right-0.5 flex items-center">
    <!-- Expand to raw text button -->
    <Button
      variant="ghost-light"
      size="icon-xs"
      onclick={handleExpand}
      class="expand-btn px-0.5! w-auto! hover:z-20 text-muted-foreground/50 hover:text-foreground!
        {selected ? '' : ''}"
      aria-label="Expand to raw text"
      tooltip="Expand to raw text"
    >
      <Fa icon={faICursor} size={10} class="" />
    </Button>

    <!-- Delete button -->
    <Button
      variant="ghost-light"
      size="icon-xs"
      onclick={handleDelete}
      class="delete-btn px-0.5! -ml-px w-auto! hover:z-20 text-muted-foreground/70 hover:text-foreground!
        {selected ? '' : ''}"
      aria-label="Remove pasted text"
    >
      <Fa icon={faXmark} size={10} class="" />
    </Button>
    </div>
  </span>
</NodeViewWrapper>

<style>
  .paste-chip-wrapper {
    cursor: default;
  }

  .paste-chip-pill {
    vertical-align: baseline;
    line-height: 1.4;
  }
</style>
