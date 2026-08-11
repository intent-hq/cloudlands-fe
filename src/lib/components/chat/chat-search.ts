import type { AgentMessage } from '$shared/types';
import { extractAllContent } from '$shared/types';
import { groupContentBlocks, parseSuggestedPrompts } from '$lib/utils/messageParser';

export interface ChatSearchMatch {
  messageId: string;
  matchIndexInMessage: number;
  turnKey: string;
}

export function extractSearchableContent(message: AgentMessage): string {
  const blocks = message.contentBlocks;
  if (!blocks?.length) return '';
  if (message.role === 'user') {
    if (message.metadata?.type === 'event_notification') return '';
    if (extractAllContent(message).trimStart().startsWith('[WORKSPACE EVENTS]')) return '';
  }

  const grouped = groupContentBlocks(blocks, !!message.isStreaming);
  const lastIndex = grouped.length - 1;
  const parts: string[] = [];
  const pushText = (text: string) => parts.push(parseSuggestedPrompts(text).cleanedContent);
  grouped.forEach((block, index) => {
    if (block.type === 'text') {
      pushText(block.text || block.content || '');
    } else if (block.type === 'content_group' && index === lastIndex) {
      for (const child of block.children) {
        if (child.type === 'text') pushText(child.text || child.content || '');
      }
    }
  });
  return parts.join('');
}

export function findChatSearchMatches(
  messages: AgentMessage[],
  query: string,
  turnKeyByMessageId: ReadonlyMap<string, string>,
): ChatSearchMatch[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return [];
  const matches: ChatSearchMatch[] = [];
  for (const message of messages) {
    const content = extractSearchableContent(message).toLowerCase();
    const turnKey = turnKeyByMessageId.get(message.id) ?? message.id;
    let offset = 0;
    let matchIndexInMessage = 0;
    while ((offset = content.indexOf(normalizedQuery, offset)) !== -1) {
      matches.push({ messageId: message.id, matchIndexInMessage, turnKey });
      offset += normalizedQuery.length;
      matchIndexInMessage++;
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