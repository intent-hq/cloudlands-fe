import type { ContentBlock } from '$shared/types';
import {
  parseSuggestedPrompts,
  type ContentBlockGroup,
  type RenderContentBlock,
} from '$lib/utils/messageParser';
import {
  getIdBackedContentBlockKey,
  getToolResultContentBlockKey,
  getToolUseContentBlockKey,
} from '$shared/utils/content-block-helpers';
import {
  extractReasoningDisclosureHeading,
  extractReasoningHeading,
  extractReasoningHistory,
  extractStandaloneReasoningTitle,
  isGenericReasoningHeading,
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
    child.type === 'thinking'
      ? extractReasoningDisclosureHeading(child.text ?? child.content ?? '')
      : null,
  );
  const firstSpecificReasoning = parsedReasoning.findIndex(
    (reasoning) => reasoning?.heading && !isGenericReasoningHeading(reasoning.heading),
  );
  const firstNamedReasoning =
    firstSpecificReasoning >= 0
      ? firstSpecificReasoning
      : parsedReasoning.findIndex((reasoning) => reasoning?.heading);
  const children = block.children.flatMap((child, index) => {
    if (child.type !== 'thinking') return [child];
    const reasoning = parsedReasoning[index];
    const text =
      index === firstNamedReasoning ||
      (firstSpecificReasoning >= 0 &&
        reasoning?.heading &&
        isGenericReasoningHeading(reasoning.heading))
        ? (reasoning?.body ?? '')
        : (child.text ?? child.content ?? '');
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

function normalizeResponseGroupWithExternalTitle(
  block: ContentBlockGroup,
  name: string,
): ContentBlockGroup {
  const children = block.children.flatMap((child) => {
    if (child.type !== 'thinking') return [child];
    const reasoning = extractReasoningHeading(child.text ?? child.content ?? '');
    const text =
      reasoning.heading && isGenericReasoningHeading(reasoning.heading)
        ? reasoning.body
        : (child.text ?? child.content ?? '');
    const normalized = reasoningWithText(child, text);
    return normalized ? [normalized] : [];
  });
  return { ...block, name, sourceName: block.name, isReasoningPhase: true, children };
}

function insertAdjacentReasoning(
  children: ContentBlock[],
  preceding: ContentBlock[],
): ContentBlock[] {
  if (children[0]?.type !== 'text') return [...preceding, ...children];
  return [children[0], ...preceding, ...children.slice(1)];
}

function pairAdjacentReasoningGroup(
  preceding: ContentBlock[],
  group: ContentBlockGroup,
): ContentBlockGroup | null {
  if (!preceding.length || !isReasoningPhaseGroupName(group.name)) return null;
  const lastPreceding = preceding.at(-1);
  if (!lastPreceding) return null;
  const precedingReasoning = extractReasoningHeading(
    lastPreceding.text ?? lastPreceding.content ?? '',
  );
  const normalizedGroup = normalizeResponseGroup(group);
  const description = group.children[0];
  const externalTitle =
    description?.type === 'text' && (description.text ?? description.content ?? '').trim()
      ? extractStandaloneReasoningTitle(precedingReasoning.body)
      : null;
  let namedGroup = normalizedGroup;
  let histories = preceding.slice();

  if (precedingReasoning.heading && externalTitle) {
    namedGroup = normalizeResponseGroupWithExternalTitle(group, externalTitle);
    const previousHistory = reasoningWithText(lastPreceding, precedingReasoning.heading);
    histories = [...preceding.slice(0, -1), ...(previousHistory ? [previousHistory] : [])];
  } else if (!namedGroup.name) {
    for (let index = histories.length - 1; index >= 0; index -= 1) {
      const reasoning = extractReasoningHeading(
        histories[index].text ?? histories[index].content ?? '',
      );
      if (!reasoning.heading || isGenericReasoningHeading(reasoning.heading)) continue;
      namedGroup = { ...namedGroup, name: reasoning.heading };
      const remaining = reasoningWithText(histories[index], reasoning.body);
      histories = [
        ...histories.slice(0, index),
        ...(remaining ? [remaining] : []),
        ...histories.slice(index + 1),
      ];
      break;
    }
  }

  histories = histories.filter((block) => (block.text ?? block.content ?? '').trim());

  return {
    ...namedGroup,
    hasAdjacentReasoningHistory: true,
    children: insertAdjacentReasoning(namedGroup.children, histories),
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
    if (block.type === 'thinking') {
      let groupIndex = index;
      while (blocks[groupIndex]?.type === 'thinking') groupIndex += 1;
      const group = blocks[groupIndex];
      const preceding = blocks.slice(index, groupIndex) as ContentBlock[];
      const paired =
        group?.type === 'content_group' ? pairAdjacentReasoningGroup(preceding, group) : null;
      if (paired) {
        normalized.push(paired);
        index = groupIndex;
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

export function isTerminalResponseGroup(
  blocks: readonly RenderContentBlock[],
  groupIndex: number,
): boolean {
  for (let index = groupIndex + 1; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (block.type === 'content_group') return false;
    if (
      block.type === 'text' &&
      parseSuggestedPrompts(block.text ?? block.content ?? '').cleanedContent.trim()
    ) {
      return false;
    }
    if (block.type === 'image' && (block.data || block.dataTruncated) && block.mimeType)
      return false;
    if (block.type === 'video' && block.source) return false;
    if (
      (block.type === 'nav-link' || block.kind === 'nav-link') &&
      block.target &&
      (block.label || block.target)
    ) {
      return false;
    }
    if (getProposalFromBlock(block as ContentBlock)) return false;
  }
  return true;
}

export function shouldRenderResponseGroupInline(
  group: Pick<ContentBlockGroup, 'isReasoningPhase' | 'isStreaming' | 'name'> & {
    children?: readonly ContentBlock[];
  },
): boolean {
  return (
    group.isReasoningPhase === true &&
    !group.isStreaming &&
    !group.name.trim() &&
    group.children?.some((child) => child.type === 'tool_result') === true &&
    !group.children.some((child) => child.type === 'thinking')
  );
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

export function getResponseGroupCurrentChildIndex(
  group: Pick<ContentBlockGroup, 'children' | 'hasAdjacentReasoningHistory'>,
): number {
  if (
    group.hasAdjacentReasoningHistory &&
    getResponseGroupCurrentBlockIndex(group.children.slice(2)) < 0
  ) {
    return group.children.length > 0 ? 0 : -1;
  }

  return getResponseGroupCurrentBlockIndex(group.children);
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
