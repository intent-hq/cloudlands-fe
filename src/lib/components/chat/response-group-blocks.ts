import type { ContentBlock } from '$shared/types';
import type { ContentBlockGroup, RenderContentBlock } from '$lib/utils/messageParser';
import {
  getIdBackedContentBlockKey,
  getToolResultContentBlockKey,
  getToolUseContentBlockKey,
} from '$shared/utils/content-block-helpers';
import { extractReasoningHeading, extractStandaloneReasoningTitle } from './reasoning-heading';

// This provider phase arrives in the same parsed content_group shape as normal
// named groups. Keep the compatibility match narrow so authored group names
// such as Working and Plan retain their model-provided titles.
const REASONING_PHASE_GROUP_NAMES = new Set(['prepping']);

export function isReasoningPhaseGroupName(name: string): boolean {
  return REASONING_PHASE_GROUP_NAMES.has(name.trim().toLowerCase());
}

function reasoningWithText(block: ContentBlock, text: string): ContentBlock | null {
  if (!text.trim()) return null;
  const { content: _content, ...rest } = block;
  return { ...rest, type: 'thinking', text } as ContentBlock;
}

export function normalizeResponseGroup(block: ContentBlockGroup): ContentBlockGroup {
  if (!isReasoningPhaseGroupName(block.name)) return block;

  const parsedReasoning = block.children.map((child) =>
    child.type === 'thinking' ? extractReasoningHeading(child.text ?? child.content ?? '') : null,
  );
  const firstNamedReasoning = parsedReasoning.findIndex((reasoning) => reasoning?.heading);
  const children = block.children.flatMap((child, index) => {
    if (child.type !== 'thinking') return [child];
    const reasoning = parsedReasoning[index];
    const text =
      index === firstNamedReasoning ? (reasoning?.body ?? '') : (child.text ?? child.content ?? '');
    const normalized = reasoningWithText(child, text);
    return normalized ? [normalized] : [];
  });

  return {
    ...block,
    name: parsedReasoning[firstNamedReasoning]?.heading ?? '',
    sourceName: block.name,
    isReasoningPhase: true,
    children,
  };
}

function pairAdjacentReasoningGroup(
  preceding: ContentBlock,
  group: ContentBlockGroup,
): ContentBlockGroup | null {
  if (preceding.type !== 'thinking' || !isReasoningPhaseGroupName(group.name)) return null;

  const description = group.children[0];
  if (description?.type !== 'text' || !(description.text ?? description.content ?? '').trim()) {
    return null;
  }

  const precedingReasoning = extractReasoningHeading(preceding.text ?? preceding.content ?? '');
  if (!precedingReasoning.heading) return null;

  const title = extractStandaloneReasoningTitle(precedingReasoning.body);
  if (!title) return null;

  const precedingHistory = reasoningWithText(preceding, precedingReasoning.heading);
  const children = group.children.flatMap((child) => {
    if (child.type !== 'thinking') return [child];
    const normalized = reasoningWithText(child, child.text ?? child.content ?? '');
    return normalized ? [normalized] : [];
  });

  return {
    ...group,
    name: title,
    sourceName: group.name,
    isReasoningPhase: true,
    hasAdjacentReasoningHistory: true,
    children: precedingHistory ? [children[0], precedingHistory, ...children.slice(1)] : children,
  };
}

export function normalizeResponseGroups(
  blocks: readonly RenderContentBlock[],
): RenderContentBlock[] {
  const normalized: RenderContentBlock[] = [];
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    const next = blocks[index + 1];
    if (block.type !== 'content_group' && next?.type === 'content_group') {
      const paired = pairAdjacentReasoningGroup(block, next);
      if (paired) {
        normalized.push(paired);
        index += 1;
        continue;
      }
    }

    normalized.push(block.type === 'content_group' ? normalizeResponseGroup(block) : block);
  }
  return normalized;
}

export function getResponseGroupBlockKey(block: ContentBlock, index: number): string {
  // A tool owner id is not row identity. Prefer the protocol block id so
  // sibling results owned by one tool call stay stable through finalization.
  const idBackedKey = getIdBackedContentBlockKey(block);
  if (idBackedKey) return idBackedKey;

  const toolUseKey = getToolUseContentBlockKey(block);
  if (toolUseKey) return `tool_use:${toolUseKey}`;

  const toolResultKey = getToolResultContentBlockKey(block);
  if (toolResultKey) return `tool_result:${toolResultKey}`;

  return `${block.type}:${index}`;
}

/**
 * Ensure every key is unique for use in keyed `{#each}` blocks. Repeats get an
 * occurrence-count suffix (`-dup-{n}`), which stays stable when unrelated keys
 * are inserted or removed before them. Emitted keys are tracked so a raw input
 * key that happens to match an emitted suffix (e.g. ['K', 'K', 'K-dup-1'])
 * still comes out unique. Collision-free inputs pass through unchanged.
 */
export function dedupeKeys(keys: readonly string[]): string[] {
  const occurrences = new Map<string, number>();
  const emitted = new Set<string>();
  return keys.map((key) => {
    let candidate = key;
    let n = occurrences.get(key) ?? 0;
    while (emitted.has(candidate)) {
      n += 1;
      candidate = `${key}-dup-${n}`;
    }
    occurrences.set(key, n);
    emitted.add(candidate);
    return candidate;
  });
}

export function getResponseGroupBlockKeys(blocks: readonly ContentBlock[]): string[] {
  return dedupeKeys(blocks.map((block, index) => getResponseGroupBlockKey(block, index)));
}

export function getResponseGroupCurrentBlockIndex(blocks: readonly ContentBlock[]): number {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    if (blocks[index].type !== 'tool_result') return index;
  }

  return -1;
}

export function getResponseGroupCurrentBlock(
  blocks: readonly ContentBlock[] | undefined,
): ContentBlock | undefined {
  if (!blocks) return undefined;
  const index = getResponseGroupCurrentBlockIndex(blocks);
  return index >= 0 ? blocks[index] : undefined;
}

export function getResponseGroupPreviewBlock(
  blocks: readonly ContentBlock[] | undefined,
): ContentBlock | undefined {
  if (!blocks) return undefined;

  for (const block of blocks) {
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
