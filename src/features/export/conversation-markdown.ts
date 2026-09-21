import type { AgentMessage } from '$shared/types';
import { getPresentedUserMessageText } from '$lib/utils/user-message-presentation';
import { getAgentMessageAttribution } from '$lib/utils/agent-message-attribution';
import { parseSuggestedPrompts } from '$lib/utils/messageParser';

/** Remove hidden harness markup outside fenced examples, preserving Markdown. */
function cleanMessageMarkdown(text: string): string {
  let fence: { char: string; length: number } | undefined;
  let hidden: string | undefined;
  const result: string[] = [];
  for (const line of parseSuggestedPrompts(text).cleanedContent.split('\n')) {
    if (hidden) {
      const close = line.indexOf(`</${hidden}>`);
      if (close < 0) continue;
      const tail = line.slice(close + hidden.length + 3);
      hidden = undefined;
      if (tail) result.push(tail);
      continue;
    }
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) {
      result.push(line);
      if (marker?.[0] === fence.char && marker.length >= fence.length && /^\s*[`~]+\s*$/.test(line))
        fence = undefined;
      continue;
    }
    if (marker) {
      fence = { char: marker[0], length: marker.length };
      result.push(line);
      continue;
    }
    const opening = /^\s*<(supervisor|agent_digest)>/.exec(line);
    if (opening) {
      const close = line.indexOf(`</${opening[1]}>`, opening[0].length);
      if (close < 0) hidden = opening[1];
      else if (line.slice(close + opening[1].length + 3))
        result.push(line.slice(close + opening[1].length + 3));
      continue;
    }
    if (/^\s*<\/?group(?::[^>]*)?>\s*$/.test(line)) continue;
    result.push(line);
  }
  return result.join('\n').trim();
}

/** Text-only export: no system rows, tool payloads or private reasoning. */
function messageMarkdown(message: AgentMessage, ownerPrincipalId?: string | null): string {
  if (message.role !== 'user' && message.role !== 'assistant') return '';
  const text =
    message.role === 'user'
      ? getPresentedUserMessageText(message, ownerPrincipalId)
      : (message.contentBlocks ?? [])
          .filter((block) => block.type === 'text')
          .map((block) => block.text ?? '')
          .join('');
  return cleanMessageMarkdown(text);
}

/** Stop at the first visible row; never build a transcript just to enable a control. */
export function hasConversationText(
  messages: AgentMessage[],
  ownerPrincipalId?: string | null,
): boolean {
  return messages.some((message) => !!messageMarkdown(message, ownerPrincipalId));
}

export function conversationMarkdown(
  messages: AgentMessage[],
  ownerPrincipalId?: string | null,
): string {
  return messages
    .flatMap((message) => {
      const text = messageMarkdown(message, ownerPrincipalId);
      if (!text) return [];
      const sender =
        message.role === 'user'
          ? getAgentMessageAttribution(message.metadata)?.rawName ||
            message.author?.displayName ||
            message.author?.login ||
            'User'
          : 'Assistant'; // i18n-ignore (portable Markdown transcript role headings)
      return [`## ${sender.replace(/[\r\n]/g, ' ')}\n\n${text}`];
    })
    .join('\n\n---\n\n');
}
