import type { AgentMessage } from '$shared/types';
import { extractAllContent } from '$shared/types';
import {
  groupContentBlocks,
  parseSuggestedPrompts,
  parseSuggestedPromptsFromContentBlocks,
} from '$lib/utils/messageParser';
import { getPresentedUserMessageText } from '$lib/utils/user-message-presentation';
interface ChatSearchBlock {
  messageId: string;
  turnKey: string;
  blockPath: string;
  disclosurePath: string[];
  text: string;
}
import {
  getResponseGroupCurrentChildIndex,
  normalizeResponseGroups,
  shouldRenderResponseGroupInline,
} from './response-group-blocks';
import {
  extractReasoningHeading,
  extractReasoningHistory,
  extractStandaloneReasoningTitles,
} from './reasoning-heading';
import {
  classifyToolResults,
  getStandaloneToolResultPresentation,
  isStandaloneToolResult,
} from './tool-result-pairing';

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

/** `ownerPrincipalId` (`workspace.ownerPrincipalId`) gates the collaborator preamble strip. */
function buildMessageSearchBlocks(
  message: AgentMessage,
  turnKey: string,
  ownerPrincipalId: string | null | undefined,
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

  const parsedPromptBlocks = parseSuggestedPromptsFromContentBlocks(contentBlocks, {
    isStreaming: !!message.isStreaming,
  });
  const grouped = normalizeResponseGroups(
    groupContentBlocks(parsedPromptBlocks.contentBlocks, !!message.isStreaming),
    !!message.isStreaming,
  );
  const toolResultClassification = classifyToolResults(grouped);
  const output: ChatSearchBlock[] = [];
  const addText = (text: string, blockPath: string, disclosurePath: string[]) => {
    const cleaned = parseSuggestedPrompts(text).cleanedContent;
    if (!cleaned.trim()) return;
    output.push({ messageId: message.id, turnKey, blockPath, disclosurePath, text: cleaned });
  };
  const addReasoning = (text: string, path: string, parents: string[], history: boolean) => {
    if (history) {
      extractReasoningHistory(text).forEach((phase, index) => {
        const phasePath = `${path}:phase:${index}`;
        if (phase.title) addText(phase.title, `${phasePath}:summary`, parents);
        addText(phase.body, `${phasePath}:body`, [...parents, `reasoning:${phasePath}`]);
      });
    } else {
      const titles = extractStandaloneReasoningTitles(text);
      if (titles) {
        titles.forEach((title, index) => addText(title, `${path}:title:${index}:summary`, parents));
        return;
      }
      const reasoning = extractReasoningHeading(text, { preserveInlineText: true });
      if (reasoning.heading) addText(reasoning.heading, `${path}:summary`, parents);
      addText(reasoning.body, `${path}:body`, [...parents, `reasoning:${path}`]);
    }
  };

  grouped.forEach((block, blockIndex) => {
    const path = chatSearchBlockPath(blockIndex);
    if (block.type === 'text') {
      addText(block.text || block.content || '', path, []);
      return;
    }
    if (block.type === 'thinking') {
      addReasoning(block.text ?? block.content ?? '', path, [], false);
      return;
    }
    if (block.type === 'tool_result' && isStandaloneToolResult(toolResultClassification, block)) {
      addText(getStandaloneToolResultPresentation(block).searchableText, path, []);
      return;
    }
    if (block.type !== 'content_group') return;
    const parents = shouldRenderResponseGroupInline(block) ? [] : [`group:${path}`];
    if (parents.length) addText(block.name, `${path}:summary`, []);
    const currentIndex = getResponseGroupCurrentChildIndex(block);
    block.children.forEach((child, childIndex) => {
      if (
        block.isStreaming &&
        currentIndex >= 0 &&
        childIndex !== currentIndex &&
        child.type !== 'tool_result'
      )
        return;
      const childPath = chatSearchBlockPath(blockIndex, childIndex);
      if (child.type === 'text') {
        addText(child.text || child.content || '', childPath, parents);
      } else if (child.type === 'thinking') {
        addReasoning(
          child.text ?? child.content ?? '',
          childPath,
          parents,
          !!block.isReasoningPhase,
        );
      } else if (
        child.type === 'tool_result' &&
        isStandaloneToolResult(toolResultClassification, child)
      ) {
        addText(getStandaloneToolResultPresentation(child).searchableText, childPath, parents);
      }
    });
  });
  return output;
}

function buildChatSearchIndex(
  messages: AgentMessage[],
  turnKeyByMessageId: ReadonlyMap<string, string>,
  ownerPrincipalId: string | null | undefined,
): ChatSearchBlock[] {
  return messages.flatMap((message) =>
    buildMessageSearchBlocks(
      message,
      turnKeyByMessageId.get(message.id) ?? message.id,
      ownerPrincipalId,
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

export function findChatSearchMatches(
  messages: AgentMessage[],
  query: string,
  turnKeyByMessageId: ReadonlyMap<string, string>,
  ownerPrincipalId?: string | null,
): ChatSearchMatch[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return [];
  const matches: ChatSearchMatch[] = [];
  const occurrenceByMessage = new Map<string, number>();
  for (const block of buildChatSearchIndex(messages, turnKeyByMessageId, ownerPrincipalId)) {
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
