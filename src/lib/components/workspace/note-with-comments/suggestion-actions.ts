import type { Editor } from '@tiptap/core';

export type SuggestionDecision = 'accept' | 'reject';

export async function applySuggestionDecision(
  editor: Editor,
  suggestionId: string,
  decision: SuggestionDecision,
  persist: () => Promise<void>,
): Promise<boolean> {
  const applied =
    decision === 'accept'
      ? editor.commands.acceptSuggestion(suggestionId)
      : editor.commands.rejectSuggestion(suggestionId);
  if (!applied) return false;
  await persist();
  return true;
}
