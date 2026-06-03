import type { ContentBlock } from '$shared/types';
import { normalizeContentBlocks } from '$shared/types';
import {
  getContentBlockText,
  getContentBlocksRichness,
  getIdBackedContentBlockKey,
  getToolResultContentBlockKey,
  getToolUseContentBlockKey,
} from '$shared/utils/content-block-helpers';

type StreamEventType = 'started' | 'chunk' | 'content-blocks' | 'complete' | 'error' | 'timeout';

export function dedupeStreamContentBlocks(blocks: readonly ContentBlock[]): ContentBlock[] {
  const result: ContentBlock[] = [];
  const toolUseIndex = new Map<string, number>();
  const toolResultKeys = new Set<string>();
  const genericIndex = new Map<string, number>();

  for (const block of normalizeContentBlocks([...blocks])) {
    const last = result[result.length - 1];
    if (block.type === 'text' && last?.type === 'text') {
      const { content: _content, ...lastWithoutContent } = last;
      result[result.length - 1] = {
        ...lastWithoutContent,
        text: getContentBlockText(last) + getContentBlockText(block),
      };
      continue;
    }

    const useKey = getToolUseContentBlockKey(block);
    if (useKey) {
      const existingIndex = toolUseIndex.get(useKey);
      if (existingIndex !== undefined) {
        result[existingIndex] = block;
        continue;
      }
      toolUseIndex.set(useKey, result.length);
    }

    const resultKey = getToolResultContentBlockKey(block);
    if (resultKey) {
      if (toolResultKeys.has(resultKey)) continue;
      toolResultKeys.add(resultKey);
    }

    const genericKey = getIdBackedContentBlockKey(block);
    if (genericKey) {
      const existingIndex = genericIndex.get(genericKey);
      if (existingIndex !== undefined) {
        result[existingIndex] = block;
        continue;
      }
      genericIndex.set(genericKey, result.length);
    }

    result.push(block);
  }

  return result;
}

function hasActiveStreamRegression(
  current: readonly ContentBlock[],
  candidate: readonly ContentBlock[],
): boolean {
  if (current.length === 0) return false;
  if (candidate.length < current.length) return true;
  return getContentBlocksRichness(candidate) < getContentBlocksRichness(current);
}

export function resolveStreamContentBlocks(
  currentBlocks: readonly ContentBlock[] | undefined,
  incomingBlocks: readonly ContentBlock[] | undefined,
  eventType: StreamEventType,
): ContentBlock[] | undefined {
  const current = currentBlocks ? dedupeStreamContentBlocks(currentBlocks) : [];
  if (!incomingBlocks || incomingBlocks.length === 0)
    return current.length > 0 ? current : undefined;

  const candidate = dedupeStreamContentBlocks(incomingBlocks);

  if (eventType === 'complete') {
    if (candidate.length === 0) return current;
    return getContentBlocksRichness(candidate) >= getContentBlocksRichness(current)
      ? candidate
      : current;
  }

  if (eventType === 'started' || eventType === 'chunk' || eventType === 'content-blocks') {
    return hasActiveStreamRegression(current, candidate) ? current : candidate;
  }

  return candidate;
}
