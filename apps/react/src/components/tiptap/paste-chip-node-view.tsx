// Source: src/lib/components/tiptap/PasteChipNodeView.svelte.
import type { MouseEvent } from 'react';
import { ClipboardIcon, CursorTextIcon, XIcon } from '@phosphor-icons/react';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { Button } from '@/components/ui/button';
import { TooltipRich } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { createFormatters } from '$shared/i18n/formatters';
import { m } from '$shared/paraglide/messages.js';
import { getLocale } from '$shared/paraglide/runtime.js';
import './paste-chip.css';

const { formatInteger } = createFormatters(getLocale);

export function PasteChipNodeView({ node, selected, deleteNode, editor, getPos }: NodeViewProps) {
  const pastedContent = node.attrs.content as string;
  const lineCount = node.attrs.lineCount as number;
  const previewText =
    pastedContent.length > 500 ? pastedContent.slice(0, 500) + '...' : pastedContent;

  function handleDelete(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    deleteNode();
  }

  function handleExpand(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (!editor || !getPos) return;
    const pos = getPos();
    if (typeof pos !== 'number') return;
    editor
      .chain()
      .focus()
      .command(({ tr }) => {
        if (!pastedContent) tr.delete(pos, pos + node.nodeSize);
        else tr.replaceWith(pos, pos + node.nodeSize, editor.schema.text(pastedContent));
        return true;
      })
      .run();
  }

  return (
    <NodeViewWrapper as="span" className="inline" role="none">
      <span className="paste-chip-wrapper group/pill relative inline-flex items-center">
        <TooltipRich
          side="top"
          align="start"
          delayDuration={300}
          interactive
          maxWidth="24rem"
          trigger={
            <span
              className={cn(
                'paste-chip-pill inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 pr-9 text-xs font-medium transition-colors',
                selected
                  ? 'bg-primary/20 text-primary ring-1 ring-primary/30'
                  : 'bg-muted/60 text-foreground/80 hover:bg-muted hover:text-foreground',
              )}
            >
              <ClipboardIcon size="0.75em" className="shrink-0 opacity-40" aria-hidden="true" />
              <span className="whitespace-nowrap">
                {m.tiptap_pasteChip_pastedLines_label({ count: formatInteger(lineCount) })}
              </span>
            </span>
          }
          content={
            <div className="space-y-1.5 max-w-96 min-w-48">
              <div className="flex items-center gap-1.5">
                <ClipboardIcon size="0.75em" className="opacity-40" aria-hidden="true" />
                <span className="text-ui font-medium text-muted-foreground">
                  {m.tiptap_pasteChip_pastedText_label()}
                </span>
                <span className="text-ui text-subtle">
                  · {m.tiptap_pasteChip_lines_label({ count: formatInteger(lineCount) })}
                </span>
              </div>
              <div className="text-xs text-subtle whitespace-pre-wrap break-words leading-relaxed line-clamp-[12]">
                {previewText}
              </div>
            </div>
          }
        />
        <div className="absolute right-0.5 flex items-center">
          <Button
            variant="ghost-light"
            size="icon-xs"
            onClick={handleExpand}
            className="expand-btn px-0.5! w-auto! hover:z-20 text-muted-foreground hover:text-foreground!"
            aria-label={m.tiptap_pasteChip_expand_label()}
            tooltip={m.tiptap_pasteChip_expand_label()}
          >
            <CursorTextIcon size={10} aria-hidden="true" />
          </Button>
          <Button
            variant="ghost-light"
            size="icon-xs"
            onClick={handleDelete}
            className="delete-btn px-0.5! -ml-px w-auto! hover:z-20 text-muted-foreground hover:text-foreground!"
            aria-label={m.tiptap_pasteChip_remove_ariaLabel()}
          >
            <XIcon size={10} aria-hidden="true" />
          </Button>
        </div>
      </span>
    </NodeViewWrapper>
  );
}
