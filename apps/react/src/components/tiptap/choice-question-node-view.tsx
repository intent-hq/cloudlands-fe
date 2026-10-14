// Source: src/lib/components/tiptap/ChoiceQuestionNodeView.svelte.
import type { NodeViewProps } from '@tiptap/core';
import { NodeViewContent, NodeViewWrapper } from '@tiptap/react';

export function ChoiceQuestionNodeView(_props: NodeViewProps) {
  return (
    <NodeViewWrapper
      as="div"
      role="none"
      className="choice-question-view mb-2 font-semibold text-gray-800 dark:text-gray-200"
      data-type="choice-question"
    >
      <div className="editable-question outline-none" data-testid="editable-content">
        <NodeViewContent />
      </div>
    </NodeViewWrapper>
  );
}
