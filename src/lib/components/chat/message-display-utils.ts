import type { AgentMessage } from '$shared/types';

const stoppedStopReasons = new Set([
  'cancelled',
  'interrupted',
  'provider_stopped',
  'workspace_deleted',
  'process_died',
  'process_null',
]);

const coordinationStopReasons = new Set(['cancelled', 'interrupted']);

function getStopReason(message: AgentMessage): string | undefined {
  const stopReason = message.metadata?.stopReason;
  return typeof stopReason === 'string' ? stopReason : undefined;
}

function hasVisibleAssistantContent(message: AgentMessage): boolean {
  const blocks = message.contentBlocks;
  if (!Array.isArray(blocks) || blocks.length === 0) return false;

  return blocks.some((block: any) => {
    if (block.type === 'text') {
      return String(block.text ?? block.content ?? '').trim().length > 0;
    }
    return block.type !== 'thinking';
  });
}

export function shouldShowStoppedIndicator({
  message,
  isStreaming,
  suppressCoordinationStoppedIndicator = false,
}: {
  message?: AgentMessage;
  isStreaming: boolean;
  suppressCoordinationStoppedIndicator?: boolean;
}): boolean {
  if (!message?.metadata?.interrupted || isStreaming) return false;

  const stopReason = getStopReason(message);
  const isStoppedReason = stopReason ? stoppedStopReasons.has(stopReason) : true;
  if (!isStoppedReason) return false;

  if (!hasVisibleAssistantContent(message) && (!stopReason || coordinationStopReasons.has(stopReason))) {
    return false;
  }

  if (suppressCoordinationStoppedIndicator && (!stopReason || coordinationStopReasons.has(stopReason))) {
    return false;
  }

  return true;
}