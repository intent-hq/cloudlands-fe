import type { ContentBlock } from '$shared/types';

type StreamEventType = 'started' | 'chunk' | 'content-blocks' | 'complete' | 'error' | 'timeout';

export function resolveStreamContentBlocks(
  existing: ContentBlock[] | undefined,
  incoming: ContentBlock[] | undefined,
  eventType: StreamEventType,
): ContentBlock[] | undefined {
  if (incoming) return incoming;
  return eventType === 'complete' || eventType === 'error' || eventType === 'timeout'
    ? existing
    : undefined;
}