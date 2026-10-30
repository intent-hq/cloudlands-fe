import { describe, expect, it } from 'vitest';
import { toPromptToken } from './format';
import { findInlineMentions } from '$lib/components/chat/mention-match-utils';

const NOTE_ID = '3f2a9c1e-7b4d-4e8a-9f10-2c5d6e7f8a9b';

describe('note mention prompt token', () => {
  it('serializes a note mention by id, not by its (possibly multi-word) title', () => {
    expect(
      toPromptToken({ type: 'note', id: NOTE_ID, label: 'Meeting with Andre Oct 30 2026' }),
    ).toBe(`@note/${NOTE_ID}`);
  });

  it('keeps the spec note token as @note/spec', () => {
    expect(toPromptToken({ type: 'note', id: 'spec', label: 'Spec' })).toBe('@note/spec');
  });

  it('falls back to the label when the candidate has no id', () => {
    expect(toPromptToken({ type: 'note', id: '', label: 'Scratch' })).toBe('@note/Scratch');
  });

  it('round-trips through the chat renderer matcher as one whole mention', () => {
    const token = toPromptToken({
      type: 'note',
      id: NOTE_ID,
      label: 'Meeting with Andre Oct 30 2026',
    });
    const text = `${token} Read the transcript`;

    expect(findInlineMentions(text)).toEqual([
      { index: 0, fullMatch: `@note/${NOTE_ID}`, captured: `note/${NOTE_ID}` },
    ]);
  });
});
