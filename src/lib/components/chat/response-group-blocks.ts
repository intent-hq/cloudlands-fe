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
