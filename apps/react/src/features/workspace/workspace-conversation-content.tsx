import type { ReactNode } from 'react';
import type { ContentBlock } from '$shared/types';
import type { RenderContentBlock } from '$lib/utils/messageParser';
import { mergeHydratedContent } from '$lib/components/chat/block-hydration';
import { prepareReadOnlyToolContent } from '$lib/components/chat/read-only-tool-presentation';
import { selectChatAgentState } from '@/store/chat-state/chat-state-selectors';
import { ResponseGroup } from '@/features/chat/components/response-group';
import { WorkspaceReadOnlyTool } from './workspace-read-only-tool';

export function WorkspaceConversationContent({
  blocks,
  agentId,
  messageId,
  isStreaming,
  onOpenAgent,
  renderBlock,
}: {
  blocks: ContentBlock[];
  agentId: string;
  messageId: string;
  isStreaming: boolean;
  onOpenAgent: (agentId: string) => void;
  renderBlock: (block: ContentBlock, index: number) => ReactNode;
}) {
  const cache = selectChatAgentState(agentId).value.hydratedBlocks;
  const hydrated = mergeHydratedContent(blocks, messageId, cache);
  const { groups, pairs, consumedResults } = prepareReadOnlyToolContent(hydrated, isStreaming);
  const originalById = new Map(
    blocks.filter((block) => block.id).map((block) => [block.id, block]),
  );
  const render = (items: readonly RenderContentBlock[]): ReactNode =>
    items.map((block, index) => {
      if (block.type === 'content_group')
        return (
          <ResponseGroup
            key={index}
            name={block.name}
            isStreaming={block.isStreaming}
            reasoningPhase={block.isReasoningPhase}
          >
            {render(block.children)}
          </ResponseGroup>
        );
      if (consumedResults.has(block)) return null;
      if (pairs.has(block)) {
        const result = pairs.get(block);
        return (
          <WorkspaceReadOnlyTool
            key={block.id ?? index}
            call={originalById.get(block.id) ?? block}
            resultBlock={result && (originalById.get(result.id) ?? result)}
            agentId={agentId}
            messageId={messageId}
            isStreaming={isStreaming}
            onOpenAgent={onOpenAgent}
          />
        );
      }
      return renderBlock(originalById.get(block.id) ?? block, index);
    });
  return render(groups);
}
