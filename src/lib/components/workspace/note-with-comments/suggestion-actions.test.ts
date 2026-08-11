import { describe, expect, it, vi } from 'vitest';
import type { Editor } from '@tiptap/core';
import { applySuggestionDecision } from './suggestion-actions';

function editorWith(result: boolean) {
  return {
    commands: {
      acceptSuggestion: vi.fn(() => result),
      rejectSuggestion: vi.fn(() => result),
    },
  } as unknown as Editor;
}

describe('applySuggestionDecision', () => {
  it.each(['accept', 'reject'] as const)('applies and persists a %s decision', async (decision) => {
    const editor = editorWith(true);
    const persist = vi.fn(async () => undefined);

    await expect(applySuggestionDecision(editor, 'suggestion-1', decision, persist)).resolves.toBe(
      true,
    );
    expect(
      editor.commands[`${decision}Suggestion`] as ReturnType<typeof vi.fn>,
    ).toHaveBeenCalledWith('suggestion-1');
    expect(persist).toHaveBeenCalledOnce();
  });

  it('does not persist when the suggestion no longer exists', async () => {
    const persist = vi.fn(async () => undefined);
    await expect(
      applySuggestionDecision(editorWith(false), 'missing', 'accept', persist),
    ).resolves.toBe(false);
    expect(persist).not.toHaveBeenCalled();
  });
});
