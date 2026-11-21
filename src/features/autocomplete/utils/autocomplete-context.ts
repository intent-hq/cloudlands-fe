/**
 * Builds the `context` param of `input.autocomplete` (Contract §2, §6.2): the
 * last 2,000 characters of the visible conversation (user and assistant text)
 * plus the latest suggested prompts. The wire cap is 4,000 characters.
 */
import { parseSuggestedPrompts } from '$lib/utils/messageParser';

export const AUTOCOMPLETE_CONVERSATION_CHARS = 2000;
export const AUTOCOMPLETE_CONTEXT_MAX_CHARS = 4000;
/** Room left for the suggested-prompt list under the wire cap. */
const PROMPTS_MAX_CHARS = AUTOCOMPLETE_CONTEXT_MAX_CHARS - AUTOCOMPLETE_CONVERSATION_CHARS - 2;

export interface AutocompleteTurn {
  role: 'user' | 'assistant';
  text: string;
}

/** Minimal message shape read from the transcript (AgentMessage-compatible). */
interface MessageLike {
  role: string;
  contentBlocks?: readonly { type: string; text?: string; content?: string }[];
}

/**
 * Visible user/assistant text of a transcript, oldest first. Suggested-prompt
 * blocks are stripped from assistant text (they are passed separately); tool,
 * thinking and system rows are skipped. Walks from the newest message and
 * stops once `maxChars` of text is collected, so long transcripts stay cheap.
 */
export function autocompleteTurnsFromMessages(
  messages: readonly MessageLike[],
  maxChars = AUTOCOMPLETE_CONVERSATION_CHARS,
): AutocompleteTurn[] {
  const turns: AutocompleteTurn[] = [];
  let collected = 0;
  for (let index = messages.length - 1; index >= 0 && collected < maxChars; index -= 1) {
    const message = messages[index];
    if (message.role !== 'user' && message.role !== 'assistant') continue;
    const raw = (message.contentBlocks ?? [])
      .filter((block) => block.type === 'text')
      .map((block) => block.text || block.content || '')
      .join('');
    const text = (
      message.role === 'assistant' ? parseSuggestedPrompts(raw).cleanedContent : raw
    ).trim();
    if (!text) continue;
    turns.unshift({ role: message.role, text });
    collected += text.length;
  }
  return turns;
}

/**
 * The context string sent upstream. Labels are wire text for the model, not
 * UI copy, so they stay in English.
 */
export function buildAutocompleteContext(
  turns: readonly AutocompleteTurn[],
  suggestedPrompts: readonly string[],
): string {
  // i18n-ignore (prompt text for the model, not UI copy)
  const conversation = turns
    .map((turn) => `${turn.role === 'user' ? 'User' : 'Assistant'}: ${turn.text}`)
    .join('\n\n')
    .slice(-AUTOCOMPLETE_CONVERSATION_CHARS);
  const prompts = suggestedPrompts.map((prompt) => prompt.trim()).filter(Boolean);
  if (prompts.length === 0) return conversation;
  // i18n-ignore (prompt text for the model, not UI copy)
  const promptList = `Suggested prompts:\n${prompts.map((prompt) => `- ${prompt}`).join('\n')}`.slice(
    0,
    PROMPTS_MAX_CHARS,
  );
  return conversation ? `${conversation}\n\n${promptList}` : promptList;
}
