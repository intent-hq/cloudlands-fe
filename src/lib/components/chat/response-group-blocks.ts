import type { ContentBlock } from '$shared/types';
import type { ContentBlockGroup, RenderContentBlock } from '$lib/utils/messageParser';
import { parseSuggestedPrompts } from '$lib/utils/messageParser';
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
  preceding: ContentBlock[],
  group: ContentBlockGroup,
): ContentBlockGroup | null {
  if (!isReasoningPhaseGroupName(group.name)) return null;
  const nonempty = preceding.filter((child) => (child.text ?? child.content ?? '').trim());
  const last = nonempty.at(-1);
  const precedingReasoning = extractReasoningHeading(last?.text ?? last?.content ?? '');
  const externalTitle = precedingReasoning.heading
    ? extractStandaloneReasoningTitle(precedingReasoning.body)
    : null;
  const normalizedGroup = normalizeResponseGroup(group);
  // A title supplied by the preceding phase must not consume a different
  // heading from the group's own history.
  const children = externalTitle
    ? group.children.flatMap((child) => {
        if (child.type !== 'thinking') return [child];
        const parsed = extractReasoningHeading(child.text ?? child.content ?? '');
        const content =
          parsed.heading && /^(reasoning|thinking)$/i.test(parsed.heading)
            ? parsed.body
            : (child.text ?? child.content ?? '');
        const normalized = reasoningWithText(child, content);
        return normalized ? [normalized] : [];
      })
    : normalizedGroup.children;
  let title = externalTitle ?? normalizedGroup.name;
  let titleIndex = -1;
  if (!title) {
    titleIndex = nonempty.findLastIndex((child) => {
      const heading = extractReasoningHeading(child.text ?? child.content ?? '').heading;
      return !!heading && !/^(reasoning|thinking)$/i.test(heading);
    });
    if (titleIndex >= 0)
      title =
        extractReasoningHeading(nonempty[titleIndex].text ?? nonempty[titleIndex].content ?? '')
          .heading ?? '';
  }
  const history = nonempty.flatMap((child, index) => {
    const text =
      externalTitle && index === nonempty.length - 1
        ? (precedingReasoning.heading ?? '')
        : index === titleIndex
          ? extractReasoningHeading(child.text ?? child.content ?? '').body
          : (child.text ?? child.content ?? '');
    const normalized = reasoningWithText(child, text);
    return normalized ? [normalized] : [];
  });
  const hasDescription =
    children[0]?.type === 'text' && !!(children[0].text ?? children[0].content ?? '').trim();
  const descriptionCount = hasDescription ? 1 : 0;
  return {
    ...normalizedGroup,
    name: title,
    hasDescription,
    hasAdjacentReasoningHistory: history.length > 0,
    adjacentReasoningHistoryCount: history.length,
    children: [
      ...children.slice(0, descriptionCount),
      ...history,
      ...children.slice(descriptionCount),
    ],
  };
}

function responseGroupSegment(
  group: ContentBlockGroup,
  start: number,
  end: number,
): ContentBlockGroup {
  const segment = { ...group, children: group.children.slice(start, end) };
  if (group.adjacentReasoningHistoryCount === undefined) return segment;
  const historyStart = group.hasDescription ? 1 : 0;
  const historyEnd = historyStart + group.adjacentReasoningHistoryCount;
  const count = Math.max(0, Math.min(end, historyEnd) - Math.max(start, historyStart));
  return {
    ...segment,
    hasDescription: start === 0 && group.hasDescription,
    hasAdjacentReasoningHistory: count > 0,
    adjacentReasoningHistoryCount: count,
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
        hoisted.push(responseGroupSegment(block, segmentStart, index));
      }
      hoisted.push(child);
      segmentStart = index + 1;
    }

    if (segmentStart === 0) {
      hoisted.push(block);
    } else if (segmentStart < block.children.length) {
      hoisted.push(responseGroupSegment(block, segmentStart, block.children.length));
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
    if (block.type === 'thinking') {
      const preceding: ContentBlock[] = [];
      let nextIndex = index;
      while (blocks[nextIndex]?.type === 'thinking') {
        preceding.push(blocks[nextIndex] as ContentBlock);
        nextIndex += 1;
      }
      const next = blocks[nextIndex];
      if (next?.type === 'content_group') {
        const paired = pairAdjacentReasoningGroup(preceding, next);
        if (paired) {
          normalized.push(paired);
          index = nextIndex;
          continue;
        }
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

/** Select the visible predecessor and child without changing group membership. */
export function getResponseGroupChildBoundary(
  blocks: readonly RenderContentBlock[],
  groupIndex: number,
  childIndex: number,
  isVisibleTopLevel: (block: RenderContentBlock) => boolean,
  isVisibleChild: (block: ContentBlock) => boolean,
): RenderContentBlock[] {
  const group = blocks[groupIndex];
  if (group?.type !== 'content_group') return [];
  const child = group.children[childIndex];
  if (!child || !isVisibleChild(child)) return [];

  for (let index = childIndex - 1; index >= 0; index -= 1) {
    if (isVisibleChild(group.children[index])) return [group.children[index], child];
  }
  // Inline children share the top-level stack; their first visible child must
  // retain the boundary that the removed group wrapper would otherwise own.
  if (shouldRenderResponseGroupInline(group)) {
    for (let index = groupIndex - 1; index >= 0; index -= 1) {
      if (isVisibleTopLevel(blocks[index])) return [blocks[index], child];
    }
  }
  return [child];
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
  if (previousIndex < 0) return false;

  const previous = group.children[previousIndex];
  if (previous.type === 'tool_use') return false;
  if (previous.type === 'thinking') {
    const history = extractReasoningHistory(previous.text ?? previous.content ?? '');
    return !!history.at(-1)?.body;
  }
  return true;
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

export function getResponseGroupCurrentChildIndex(group: ContentBlockGroup): number {
  const firstCurrent = (group.hasDescription ? 1 : 0) + (group.adjacentReasoningHistoryCount ?? 0);
  const index = getResponseGroupCurrentBlockIndex(group.children);
  return index >= firstCurrent ? index : -1;
}

/** Hidden bookkeeping and empty prompt suggestions do not end a response group. */
export function isTerminalResponseGroup(
  blocks: readonly RenderContentBlock[],
  index: number,
  isVisible: (block: ContentBlock) => boolean = (block) => block.type !== 'tool_result',
): boolean {
  return (
    blocks[index]?.type === 'content_group' &&
    !blocks.slice(index + 1).some((block) => {
      if (block.type === 'content_group') return true;
      if (getProposalFromBlock(block)) return true;
      if (block.type === 'text') {
        return !!parseSuggestedPrompts(block.text ?? block.content ?? '').cleanedContent.trim();
      }
      if (block.type === 'thinking') return !!(block.text ?? block.content ?? '').trim();
      return isVisible(block);
    })
  );
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
