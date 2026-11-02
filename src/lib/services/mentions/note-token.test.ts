import { describe, expect, it } from 'vitest';
import { mentionTokensToText } from './registry';
import { toPromptToken } from './registry';
import { findInlineMentions } from '$lib/components/chat/mention-match-utils';
import { parseNoteMention, serializeNoteMention } from '$lib/utils/note-mention-token';
import { stripUserMessagePrefixes } from '$lib/utils/text-utils';

const NOTE_ID = '3f2a9c1e-7b4d-4e8a-9f10-2c5d6e7f8a9b';
const TITLE = 'Meeting with Andre Oct 30 2026';

describe('note mention prompt token', () => {
  it('serializes a note mention with both its id and its multi-word title', () => {
    expect(toPromptToken({ type: 'note', id: NOTE_ID, label: TITLE })).toBe(
      `@note[${NOTE_ID}:${TITLE}]`,
    );
  });

  it('prefixes the workspace for a note from another workspace', () => {
    expect(
      toPromptToken({
        type: 'note',
        id: NOTE_ID,
        label: TITLE,
        meta: { workspaceId: 'other-ws', isExternalLink: true },
      }),
    ).toBe(`@note[other-ws/${NOTE_ID}:${TITLE}]`);
  });

  it('keeps the workspace of a cross-workspace chip rebuilt from an intent link', () => {
    expect(
      toPromptToken({
        type: 'note',
        id: 'n1',
        label: 'Plan',
        meta: { workspaceId: 'ws-2', isExternalLink: true },
      }),
    ).toBe('@note[ws-2/n1:Plan]');
  });

  it('omits the workspace for a note in the current workspace', () => {
    expect(
      toPromptToken({
        type: 'note',
        id: NOTE_ID,
        label: TITLE,
        meta: { workspaceId: 'this-ws' },
      }),
    ).toBe(`@note[${NOTE_ID}:${TITLE}]`);
  });

  it('serializes the spec note with the same bracketed form', () => {
    expect(toPromptToken({ type: 'note', id: 'spec', label: 'Spec' })).toBe('@note[spec:Spec]');
  });

  it('emits plain title text instead of a truncating @note/<title> when the id is unusable', () => {
    expect(toPromptToken({ type: 'note', id: '', label: TITLE })).toBe(TITLE);
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

  it('keeps ":" and "/" in titles without mistaking them for delimiters', () => {
    const token = serializeNoteMention({ id: 'n1', title: 'Call: ASG / Andre' });
    expect(token).toBe('@note[n1:Call: ASG / Andre]');
    expect(parseNoteMention(token!)).toEqual({ id: 'n1', title: 'Call: ASG / Andre' });
  });

  it('never emits a "|" (GFM table cell separator)', () => {
    expect(serializeNoteMention({ id: 'n1', title: 'Roadmap | Q3' })).toBe('@note[n1:Roadmap Q3]');
  });

  it('strips delimiter and markdown-significant characters and newlines from titles', () => {
    expect(serializeNoteMention({ id: 'n1', title: 'A [draft] *v2* `x` ~y~ <b>\\_\nC' })).toBe(
      '@note[n1:A draft v2 x y b C]',
    );
  });

  it('falls back to the id when the title is empty', () => {
    expect(serializeNoteMention({ id: 'n1', title: '  ' })).toBe('@note[n1:n1]');
  });

  it('refuses ids that are not token-safe', () => {
    expect(serializeNoteMention({ id: 'has space', title: 'x' })).toBeNull();
    expect(parseNoteMention('@note[has space:x]')).toBeNull();
    expect(parseNoteMention('@note[bad ws/n1:x]')).toBeNull();
    expect(parseNoteMention('@note[n1]')).toBeNull();
  });

  it('refuses an unsafe workspace id instead of dropping it to a same-workspace token', () => {
    expect(serializeNoteMention({ id: 'n1', title: 'x', workspaceId: 'bad ws' })).toBeNull();
  });

  it('strips @, :// and www. so markdown cannot autolink inside the token', () => {
    expect(
      serializeNoteMention({ id: 'n1', title: 'Read https://example.com/a and www.x.io bob@x.io' }),
    ).toBe('@note[n1:Read https example.com/a and www x.io bob x.io]');
  });

  it('does not let an unterminated token swallow later bracketed text', () => {
    expect(findInlineMentions('@note[n1:see notes, then check [x] done')).toEqual([]);
  });
});

describe('plain-text previews of note mentions', () => {
  it('mentionTokensToText renders tokens as @<title>', () => {
    expect(mentionTokensToText(`@note[${NOTE_ID}:${TITLE}] read it`)).toBe(`@${TITLE} read it`);
    expect(mentionTokensToText('@note[ws-2/n1:Plan] ok')).toBe('@Plan ok');
  });

  it('stripUserMessagePrefixes shows the note title, not the raw id token', () => {
    expect(stripUserMessagePrefixes(`@note[${NOTE_ID}:${TITLE}] Read the transcript`)).toBe(
      `@${TITLE} Read the transcript`,
    );
  });
});
