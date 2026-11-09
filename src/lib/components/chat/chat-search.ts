import type { AgentMessage } from '$shared/types';
import { extractAllContent } from '$shared/types';
import { getContentBlockText } from '$shared/utils/content-block-helpers';
import { parseSuggestedPrompts } from '$lib/utils/messageParser';
import { getPresentedUserMessageText } from '$lib/utils/user-message-presentation';
interface ChatSearchBlock {
  messageId: string;
  turnKey: string;
  blockPath: string;
  disclosurePath: string[];
  text: string;
}
import { shouldRenderResponseGroupInline } from './response-group-blocks';
import {
  classifyToolResults,
  getStandaloneToolResultPresentation,
  isStandaloneToolResult,
} from './tool-result-pairing';
import { groupMessageBlocks } from './operational-run-collapse';
import { prepareMessageBlocks, renderedBlockText } from './prepare-message-blocks';

export interface ChatSearchOptions {
  /** Mirror the renderer's collapsed tool runs so block paths match the DOM. */
  collapseToolRuns?: boolean;
  /** Owning workspace, so video normalization (and its dedupe) matches the renderer. */
  workspaceId?: string;
  /** Mirror the renderer's thinking-as-prose presentation for the agent. */
  reasoningAsText?: boolean;
}

export interface ChatSearchMatch {
  messageId: string;
  matchIndexInMessage: number;
  occurrenceInBlock: number;
  turnKey: string;
  blockPath: string;
  disclosurePath: string[];
}

export const chatSearchBlockPath = (blockIndex: number, childIndex?: number): string =>
  childIndex === undefined ? `b:${blockIndex}` : `b:${blockIndex}:c:${childIndex}`;

/** A message's blocks, prepared and grouped exactly like its rendered rows. */
function groupRenderedBlocks(
  message: AgentMessage,
  contentBlocks: NonNullable<AgentMessage['contentBlocks']>,
  options: ChatSearchOptions,
) {
  const isStreaming = !!message.isStreaming;
  return groupMessageBlocks(
    prepareMessageBlocks(contentBlocks, {
      role: message.role,
      workspaceId: options.workspaceId,
      isStreaming,
      reasoningAsText: options.reasoningAsText,
    }),
    isStreaming,
    !!options.collapseToolRuns,
  );
}

/** `ownerPrincipalId` (`workspace.ownerPrincipalId`) gates the collaborator preamble strip. */
function buildMessageSearchBlocks(
  message: AgentMessage,
  turnKey: string,
  ownerPrincipalId: string | null | undefined,
  options: ChatSearchOptions = {},
): ChatSearchBlock[] {
  const contentBlocks = message.contentBlocks;
  if (!contentBlocks?.length) return [];

  if (message.role === 'user') {
    if (message.metadata?.type === 'event_notification') return [];
    if (extractAllContent(message).trimStart().startsWith('[WORKSPACE EVENTS]')) return [];
    return [
      {
        messageId: message.id,
        turnKey,
        blockPath: '',
        disclosurePath: [],
        text: parseSuggestedPrompts(getPresentedUserMessageText(message, ownerPrincipalId))
          .cleanedContent,
      },
    ];
  }

  const grouped = groupRenderedBlocks(message, contentBlocks, options);
  const toolResultClassification = classifyToolResults(grouped);
  const output: ChatSearchBlock[] = [];
  const addText = (text: string, blockPath: string, disclosurePath: string[]) => {
    const cleaned = parseSuggestedPrompts(text).cleanedContent;
    if (!cleaned.trim()) return;
    output.push({ messageId: message.id, turnKey, blockPath, disclosurePath, text: cleaned });
  };

  grouped.forEach((block, blockIndex) => {
    const path = chatSearchBlockPath(blockIndex);
    if (block.type === 'text') {
      addText(renderedBlockText(block), path, []);
      return;
    }
    if (block.type === 'tool_result' && isStandaloneToolResult(toolResultClassification, block)) {
      addText(getStandaloneToolResultPresentation(block).searchableText, path, []);
      return;
    }
    if (block.type === 'thinking') {
      addText(renderedBlockText(block), path, [`thinking:${path}`]);
      return;
    }
    if (block.type !== 'content_group') return;
    if (block.isStreaming) {
      block.children.forEach((child, childIndex) => {
        if (
          child.type === 'tool_result' &&
          isStandaloneToolResult(toolResultClassification, child)
        ) {
          addText(
            getStandaloneToolResultPresentation(child).searchableText,
            chatSearchBlockPath(blockIndex, childIndex),
            [`group:${path}`],
          );
          return;
        }
        if (child.type === 'text' || (child.type === 'thinking' && !block.isReasoningPhase)) {
          addText(
            renderedBlockText(child),
            chatSearchBlockPath(blockIndex, childIndex),
            child.type === 'thinking'
              ? [`thinking:${chatSearchBlockPath(blockIndex, childIndex)}`]
              : [],
          );
        }
      });
      return;
    }
    if (block.isReasoningPhase) {
      const rendersInline = shouldRenderResponseGroupInline(block);
      const disclosurePath = rendersInline ? [] : [`group:${path}`];
      block.children.forEach((child, childIndex) => {
        const childPath = chatSearchBlockPath(blockIndex, childIndex);
        if (child.type === 'tool_result') {
          if (isStandaloneToolResult(toolResultClassification, child)) {
            addText(
              getStandaloneToolResultPresentation(child).searchableText,
              childPath,
              disclosurePath,
            );
          }
          return;
        }
        if (!rendersInline && block.name.trim().toLowerCase() === 'reasoning') return;
        addText(getContentBlockText(child), childPath, disclosurePath);
      });
      return;
    }
    block.children.forEach((child, childIndex) => {
      const childPath = chatSearchBlockPath(blockIndex, childIndex);
      if (child.type === 'text') {
        addText(renderedBlockText(child), childPath, [`group:${path}`]);
      } else if (
        child.type === 'tool_result' &&
        isStandaloneToolResult(toolResultClassification, child)
      ) {
        addText(getStandaloneToolResultPresentation(child).searchableText, childPath, [
          `group:${path}`,
        ]);
      }
    });
  });
  return output;
}

function buildChatSearchIndex(
  messages: AgentMessage[],
  turnKeyByMessageId: ReadonlyMap<string, string>,
  ownerPrincipalId: string | null | undefined,
  options: ChatSearchOptions,
): ChatSearchBlock[] {
  return messages.flatMap((message) =>
    buildMessageSearchBlocks(
      message,
      turnKeyByMessageId.get(message.id) ?? message.id,
      ownerPrincipalId,
      options,
    ),
  );
}

export function extractSearchableContent(
  message: AgentMessage,
  ownerPrincipalId?: string | null,
): string {
  return buildMessageSearchBlocks(message, message.id, ownerPrincipalId)
    .map((block) => block.text)
    .join('');
}

/**
 * Where a tool call renders in its message: its row's block path and the
 * group to open first, if any. `null` when the message has no such call.
 */
export function locateToolCall(
  message: AgentMessage,
  toolCallId: string,
  options: ChatSearchOptions = {},
): Pick<ChatSearchMatch, 'blockPath' | 'disclosurePath'> | null {
  const contentBlocks = message.contentBlocks;
  if (message.role === 'user' || !contentBlocks?.length) return null;
  const grouped = groupRenderedBlocks(message, contentBlocks, options);
  for (const [blockIndex, block] of grouped.entries()) {
    if (block.type === 'tool_use' && block.toolCallId === toolCallId) {
      return { blockPath: chatSearchBlockPath(blockIndex), disclosurePath: [] };
    }
    if (block.type !== 'content_group') continue;
    const childIndex = block.children.findIndex(
      (child) => child.type === 'tool_use' && child.toolCallId === toolCallId,
    );
    if (childIndex < 0) continue;
    // Inline groups render their rows directly, with no disclosure to open.
    return {
      blockPath: chatSearchBlockPath(blockIndex, childIndex),
      disclosurePath: shouldRenderResponseGroupInline(block)
        ? []
        : [`group:${chatSearchBlockPath(blockIndex)}`],
    };
  }
  return null;
}

export function findChatSearchMatches(
  messages: AgentMessage[],
  query: string,
  turnKeyByMessageId: ReadonlyMap<string, string>,
  ownerPrincipalId?: string | null,
  options: ChatSearchOptions = {},
): ChatSearchMatch[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return [];
  const matches: ChatSearchMatch[] = [];
  const occurrenceByMessage = new Map<string, number>();
  for (const block of buildChatSearchIndex(
    messages,
    turnKeyByMessageId,
    ownerPrincipalId,
    options,
  )) {
    const content = block.text.toLowerCase();
    let offset = 0;
    let occurrenceInBlock = 0;
    while ((offset = content.indexOf(normalizedQuery, offset)) !== -1) {
      const matchIndexInMessage = occurrenceByMessage.get(block.messageId) ?? 0;
      matches.push({
        messageId: block.messageId,
        matchIndexInMessage,
        occurrenceInBlock,
        turnKey: block.turnKey,
        blockPath: block.blockPath,
        disclosurePath: block.disclosurePath,
      });
      occurrenceByMessage.set(block.messageId, matchIndexInMessage + 1);
      offset += normalizedQuery.length;
      occurrenceInBlock++;
    }
  }
  return matches;
}

function locateOffset(
  textNodes: Text[],
  nodeStarts: number[],
  absoluteOffset: number,
): { nodeIndex: number; localOffset: number } | null {
  if (textNodes.length === 0) return null;
  let low = 0;
  let high = textNodes.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >>> 1;
    if (nodeStarts[middle] <= absoluteOffset) low = middle;
    else high = middle - 1;
  }
  const nodeLength = (textNodes[low].textContent ?? '').length;
  return { nodeIndex: low, localOffset: Math.min(absoluteOffset - nodeStarts[low], nodeLength) };
}

export function createRangeForSpan(
  textNodes: Text[],
  nodeStarts: number[],
  start: number,
  end: number,
): Range | null {
  const startLocation = locateOffset(textNodes, nodeStarts, start);
  const endLocation = locateOffset(textNodes, nodeStarts, end);
  if (!startLocation || !endLocation) return null;
  const range = document.createRange();
  range.setStart(textNodes[startLocation.nodeIndex], startLocation.localOffset);
  range.setEnd(textNodes[endLocation.nodeIndex], endLocation.localOffset);
  return range;
}

export function collectSearchRanges(element: HTMLElement, query: string): Range[] {
  const tokens = Array.from(new Set(query.toLowerCase().split(/\s+/).filter(Boolean)));
  if (tokens.length === 0) return [];
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      const parent = (node as Text).parentElement;
      if (!parent || ['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT'].includes(parent.tagName)) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const textNodes: Text[] = [];
  const nodeStarts: number[] = [];
  const parts: string[] = [];
  let cursor = 0;
  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    const text = node.textContent ?? '';
    textNodes.push(node);
    nodeStarts.push(cursor);
    parts.push(text);
    cursor += text.length;
  }
  if (cursor === 0) return [];

  const content = parts.join('').toLowerCase();
  const ranges: Range[] = [];
  for (const token of tokens) {
    let position = 0;
    let match: number;
    while ((match = content.indexOf(token, position)) !== -1) {
      const range = createRangeForSpan(textNodes, nodeStarts, match, match + token.length);
      if (range) ranges.push(range);
      position = match + token.length;
    }
  }
  return ranges;
}
