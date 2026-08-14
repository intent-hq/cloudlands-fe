import type { ContentBlock } from '$shared/types';
import {
  getIdBackedContentBlockKey,
  getToolResultContentBlockKey,
  getToolUseContentBlockKey,
} from '$shared/utils/content-block-helpers';

export function getResponseGroupBlockKey(block: ContentBlock, index: number): string {
  const toolUseKey = getToolUseContentBlockKey(block);
  if (toolUseKey) return `tool_use:${toolUseKey}`;

  const toolResultKey = getToolResultContentBlockKey(block);
  if (toolResultKey) return `tool_result:${toolResultKey}`;

  return getIdBackedContentBlockKey(block) ?? `${block.type}:${index}`;
}

export function getResponseGroupBlockKeys(blocks: readonly ContentBlock[]): string[] {
  const keys = blocks.map((block, index) => getResponseGroupBlockKey(block, index));
  // Ensure uniqueness by appending index if duplicates exist
  const seen = new Map<string, number>();
  return keys.map((key, index) => {
    const count = seen.get(key) || 0;
    seen.set(key, count + 1);
    return count > 0 ? `${key}-dup-${index}` : key;
  });
}

export function getResponseGroupPreviewBlock(
  blocks: readonly ContentBlock[] | undefined,
): ContentBlock | undefined {
  if (!blocks) return undefined;

  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (
      block.type === 'tool_use' ||
      block.type === 'text' ||
      block.type === 'thinking' ||
      block.type === 'code'
    ) {
      return block;
    }
  }

  return undefined;
}
