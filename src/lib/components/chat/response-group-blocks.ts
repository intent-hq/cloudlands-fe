import type { ContentBlock } from '$shared/types';
import type { ContentBlockGroup, RenderContentBlock } from '$lib/utils/messageParser';
import {
  getIdBackedContentBlockKey,
  getToolResultContentBlockKey,
  getToolUseContentBlockKey,
} from '$shared/utils/content-block-helpers';
import {
  extractReasoningHeading,
  extractReasoningHistory,
  extractStandaloneReasoningTitle,
} from './reasoning-heading';
import { getProposalFromBlock } from '$shared/types/proposal-resource';

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

// Standalone daemon-canonical thinking blocks always stay reasoning so they
// render as a disclosure, never as prose, regardless of heading shape
// (intent-hq/intent#3753). Only the reasoning-phase group path
// (normalizeResponseGroup) converts thinking to inline text. Completed empty
// blocks are dropped.
function normalizeStandaloneReasoning(block: ContentBlock, isActive: boolean): ContentBlock | null {
  if (block.type !== 'thinking' || isActive) return block;

  const text = block.text ?? block.content ?? '';
  if (!text.trim()) return null;

  return block;
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

  const precedingReasoning = extractReasoningHeading(preceding.text ?? preceding.content ?? '');
  const normalizedGroup = normalizeResponseGroup(group);
  if (!group.isStreaming && !precedingReasoning.heading && !normalizedGroup.name) {
    const precedingHistory = reasoningWithText(preceding, precedingReasoning.body);
    if (!precedingHistory) return null;

    const [firstChild, ...remainingChildren] = normalizedGroup.children;
    const children =
      firstChild?.type === 'text'
        ? [firstChild, precedingHistory, ...remainingChildren]
        : [precedingHistory, ...normalizedGroup.children];
    return {
      ...normalizedGroup,
      hasAdjacentReasoningHistory: true,
      children,
    };
  }

  const description = group.children[0];
  if (description?.type !== 'text' || !(description.text ?? description.content ?? '').trim()) {
    return null;
  }

  if (!precedingReasoning.heading) return null;

  const title = extractStandaloneReasoningTitle(precedingReasoning.body);
  if (!title) return null;

  const precedingHistory = reasoningWithText(preceding, precedingReasoning.heading);
  const children = normalizedGroup.children;

  return {
    ...normalizedGroup,
    name: title,
    hasAdjacentReasoningHistory: true,
    children: precedingHistory ? [children[0], precedingHistory, ...children.slice(1)] : children,
  };
}

export function hoistProposalBlocksFromResponseGroups(
  blocks: readonly RenderContentBlock[],
): RenderContentBlock[] {
  const hoisted: RenderContentBlock[] = [];

  for (const block of blocks) {
    if (block.type !== 'content_group') {
      hoisted.push(block);
      continue;
    }

    let segmentStart = 0;
    for (let index = 0; index < block.children.length; index += 1) {
      const child = block.children[index];
      if (!getProposalFromBlock(child)) continue;

      if (segmentStart < index) {
        hoisted.push({ ...block, children: block.children.slice(segmentStart, index) });
      }
      hoisted.push(child);
      segmentStart = index + 1;
    }

    if (segmentStart === 0) {
      hoisted.push(block);
    } else if (segmentStart < block.children.length) {
      hoisted.push({ ...block, children: block.children.slice(segmentStart) });
    }
  }

  return hoisted;
}

export function normalizeResponseGroups(
  blocks: readonly RenderContentBlock[],
  isStreaming = false,
): RenderContentBlock[] {
  const normalized: RenderContentBlock[] = [];
  let activeBlockIndex = -1;
  if (isStreaming) {
    for (let index = blocks.length - 1; index >= 0; index -= 1) {
      if (blocks[index].type !== 'tool_result') {
        activeBlockIndex = index;
        break;
      }
    }
  }

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

    if (block.type === 'content_group') {
      normalized.push(normalizeResponseGroup(block));
      continue;
    }

    const standalone = normalizeStandaloneReasoning(block, index === activeBlockIndex);
    if (standalone) normalized.push(standalone);
  }
  return hoistProposalBlocksFromResponseGroups(normalized);
}

export function shouldRenderResponseGroupInline(
  group: Pick<ContentBlockGroup, 'isReasoningPhase' | 'isStreaming' | 'name'>,
): boolean {
  return group.isReasoningPhase === true && !group.isStreaming && !group.name.trim();
}

export function isNestedReasoningSectionStart(
  group: Pick<ContentBlockGroup, 'children' | 'isReasoningPhase'>,
  childIndex: number,
): boolean {
  if (!group.isReasoningPhase) return false;
  const child = group.children[childIndex];
  if (child?.type !== 'thinking') return false;

  return extractReasoningHistory(child.text ?? child.content ?? '').some(
    (section) => section.title,
  );
}

export function isNestedReasoningSectionBoundary(
  group: Pick<ContentBlockGroup, 'children' | 'isReasoningPhase'>,
  childIndex: number,
  isVisible: (block: ContentBlock) => boolean = (block) => block.type !== 'tool_result',
): boolean {
  if (!isNestedReasoningSectionStart(group, childIndex)) return false;

  let previousIndex = childIndex - 1;
  while (previousIndex >= 0 && !isVisible(group.children[previousIndex])) previousIndex -= 1;
  return previousIndex >= 0;
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
