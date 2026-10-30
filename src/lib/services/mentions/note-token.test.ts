import { describe, expect, it } from 'vitest';
import { toPromptToken } from './format';
import { findInlineMentions } from '$lib/components/chat/mention-match-utils';
import { parseNoteMention, serializeNoteMention } from '$lib/utils/note-mention-token';

const NOTE_ID = '3f2a9c1e-7b4d-4e8a-9f10-2c5d6e7f8a9b';
const TITLE = 'Meeting with Andre Oct 30 2026';

describe('note mention prompt token', () => {
  it('serializes a note mention with both its id and its multi-word title', () => {
    expect(toPromptToken({ type: 'note', id: NOTE_ID, label: TITLE })).toBe(
      `@note[${NOTE_ID}|${TITLE}]`,
    );
  });

  it('includes the workspace for a note from another workspace', () => {
    expect(
      toPromptToken({
        type: 'note',
        id: NOTE_ID,
        label: TITLE,
        meta: { workspaceId: 'other-ws', isCurrentWorkspace: false },
      }),
    ).toBe(`@note[${NOTE_ID}|${TITLE}|other-ws]`);
  });

  it('omits the workspace for a note in the current workspace', () => {
    expect(
      toPromptToken({
        type: 'note',
        id: NOTE_ID,
        label: TITLE,
        meta: { workspaceId: 'this-ws', isCurrentWorkspace: true },
      }),
    ).toBe(`@note[${NOTE_ID}|${TITLE}]`);
  });

  it('serializes the spec note with the same bracketed form', () => {
    expect(toPromptToken({ type: 'note', id: 'spec', label: 'Spec' })).toBe('@note[spec|Spec]');
  });

  it('round-trips through the chat renderer matcher as one whole mention', () => {
    const token = toPromptToken({ type: 'note', id: NOTE_ID, label: TITLE });
    expect(findInlineMentions(`${token} Read the transcript`)).toEqual([
      { index: 0, fullMatch: token, captured: token.slice(1) },
    ]);
  });

  it('still matches legacy @note/<id> tokens', () => {
    expect(findInlineMentions('see @note/spec now')).toEqual([
      { index: 4, fullMatch: '@note/spec', captured: 'note/spec' },
    ]);
  });
});

describe('serializeNoteMention / parseNoteMention', () => {
  it('round-trips id, title and workspace', () => {
    const token = serializeNoteMention({ id: NOTE_ID, title: TITLE, workspaceId: 'ws-2' });
    expect(parseNoteMention(token!)).toEqual({ id: NOTE_ID, title: TITLE, workspaceId: 'ws-2' });
  });

  it('replaces delimiter characters and newlines in titles', () => {
    expect(serializeNoteMention({ id: 'n1', title: 'A [draft] | B\nC' })).toBe(
      '@note[n1|A draft B C]',
    );
  });

  it('falls back to the id when the title is empty', () => {
    expect(serializeNoteMention({ id: 'n1', title: '  ' })).toBe('@note[n1|n1]');
  });

  it('refuses ids that are not token-safe', () => {
    expect(serializeNoteMention({ id: 'has space', title: 'x' })).toBeNull();
    expect(parseNoteMention('@note[has space|x]')).toBeNull();
    expect(parseNoteMention('@note[n1|x|bad ws]')).toBeNull();
    expect(parseNoteMention('@note[n1]')).toBeNull();
  });
});
