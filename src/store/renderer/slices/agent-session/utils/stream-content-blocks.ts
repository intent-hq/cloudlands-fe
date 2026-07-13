import flatstr from 'flatstr';
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

function isExactSerializableMatch(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return false;

  const aIsArray = Array.isArray(a);
  const bIsArray = Array.isArray(b);
  if (aIsArray || bIsArray) {
    if (!aIsArray || !bIsArray || a.length !== b.length) return false;
    return a.every((item, index) => isExactSerializableMatch(item, b[index]));
  }

  const aRecord = a as Record<string, unknown>;
  const bRecord = b as Record<string, unknown>;
  const aKeys = Object.keys(aRecord);
  const bKeys = Object.keys(bRecord);
  if (aKeys.length !== bKeys.length) return false;

  return aKeys.every(
    (key, index) => key === bKeys[index] && isExactSerializableMatch(aRecord[key], bRecord[key]),
  );
}

function stabilizeContentBlockReferences(
  previousBlocks: readonly ContentBlock[],
  nextBlocks: ContentBlock[],
): ContentBlock[] {
  if (previousBlocks.length === 0 || nextBlocks.length === 0) return nextBlocks;

  if (previousBlocks.length !== nextBlocks.length) {
    let stableBlocks: ContentBlock[] | undefined;
    const sharedLength = Math.min(previousBlocks.length, nextBlocks.length);
    for (let index = 0; index < sharedLength; index++) {
      const previousBlock = previousBlocks[index];
      if (!isExactSerializableMatch(previousBlock, nextBlocks[index])) continue;
      stableBlocks ??= nextBlocks.slice();
      stableBlocks[index] = previousBlock;
    }
    return stableBlocks ?? nextBlocks;
  }

  let stableBlocks: ContentBlock[] | undefined;
  for (let index = 0; index < nextBlocks.length; index++) {
    const block = nextBlocks[index];
    const previousBlock = previousBlocks[index];
    if (isExactSerializableMatch(previousBlock, block)) {
      if (stableBlocks) stableBlocks[index] = previousBlock;
      continue;
    }

    if (!stableBlocks) {
      stableBlocks = nextBlocks.slice(0, index);
      for (let previousIndex = 0; previousIndex < index; previousIndex++) {
        stableBlocks[previousIndex] = previousBlocks[previousIndex];
      }
    }
    stableBlocks[index] = block;
  }

  return stableBlocks ?? (previousBlocks as ContentBlock[]);
}

function dedupeCurrentStreamContentBlocks(
  currentBlocks: readonly ContentBlock[] | undefined,
): ContentBlock[] {
  if (!currentBlocks) return [];
  const current = dedupeStreamContentBlocks(currentBlocks);
  return current.length === currentBlocks.length
    ? stabilizeContentBlockReferences(currentBlocks, current)
    : current;
}

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
        text: flatstr(getContentBlockText(last) + getContentBlockText(block)),
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
  const current = dedupeCurrentStreamContentBlocks(currentBlocks);
  if (!incomingBlocks || incomingBlocks.length === 0)
    return current.length > 0 ? current : undefined;

  const candidate = stabilizeContentBlockReferences(
    current,
    dedupeStreamContentBlocks(incomingBlocks),
  );

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
