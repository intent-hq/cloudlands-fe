// Source: src/lib/components/tiptap/ChoiceBlockNodeView.svelte.
import { useState, type KeyboardEvent } from 'react';
import type { NodeViewProps } from '@tiptap/core';
import { NodeViewContent, NodeViewWrapper } from '@tiptap/react';
import { Button } from '@/components/ui/button';
import { m } from '$shared/paraglide/messages.js';

export function ChoiceBlockNodeView({ deleteNode }: NodeViewProps) {
  const [isHovered, setIsHovered] = useState(false);
  const handleDelete = () => deleteNode();
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleDelete();
    }
  };

  return (
    <NodeViewWrapper
      as="div"
      role="none"
      className="choice-block-wrapper relative my-4 p-4 border border-muted rounded-lg bg-muted/30 group flex flex-col"
      data-type="choice-block"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {isHovered && (
        <Button
          variant="ghost"
          size="icon-compact"
          iconOnly
          className="absolute top-2 right-2 rounded hover:bg-danger-background/10 text-muted-foreground hover:text-danger transition-colors"
          onClick={handleDelete}
          onKeyDown={handleKeyDown}
          aria-label={m.tiptap_choiceBlock_delete_label()}
          title={m.tiptap_choiceBlock_delete_label()}
          type="button"
          contentEditable={false}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </Button>
      )}
      <NodeViewContent />
    </NodeViewWrapper>
  );
}
