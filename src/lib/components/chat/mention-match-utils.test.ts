import { describe, expect, it } from 'vitest';
import { findInlineMentions } from './mention-match-utils';

describe('findInlineMentions', () => {
  it('does not match the domain of an email address (regression)', () => {
    expect(
      findInlineMentions('review contact details is clement@shv.com, no demo video link'),
    ).toEqual([]);
  });

  it('does not match word@domain.tld generally', () => {
    expect(findInlineMentions('email me at foo.bar@sub.example.co today')).toEqual([]);
  });

  it('does not match an @path immediately preceded by a non-whitespace character', () => {
    expect(findInlineMentions('see foo@src/main.rs there')).toEqual([]);
  });

  it('matches a context mention at the start of the string', () => {
    expect(findInlineMentions('@context[linear|AU-1|T] please')).toEqual([
      { index: 0, fullMatch: '@context[linear|AU-1|T]', captured: 'context[linear|AU-1|T]' },
    ]);
  });

  it('matches a note mention after whitespace', () => {
    expect(findInlineMentions('see @note/spec for details')).toEqual([
      { index: 4, fullMatch: '@note/spec', captured: 'note/spec' },
    ]);
  });

  it('matches a file path mention', () => {
    expect(findInlineMentions('check @src/foo.rs now')).toEqual([
      { index: 6, fullMatch: '@src/foo.rs', captured: 'src/foo.rs' },
    ]);
  });

  it('matches a bare file mention at the start of the string', () => {
    expect(findInlineMentions('@file.ts is broken')).toEqual([
      { index: 0, fullMatch: '@file.ts', captured: 'file.ts' },
    ]);
  });

  it('matches a file mention with a line range after punctuation and a space', () => {
    expect(findInlineMentions('fix this, @file.ts:L10-20 please')).toEqual([
      { index: 10, fullMatch: '@file.ts:L10-20', captured: 'file.ts:L10-20' },
    ]);
  });

  it('matches a mention after a newline', () => {
    expect(findInlineMentions('first line\n@note/spec next')).toEqual([
      { index: 11, fullMatch: '@note/spec', captured: 'note/spec' },
    ]);
  });

  it('matches multiple mentions and skips emails in the same text', () => {
    expect(findInlineMentions('@src/a.ts then mail bob@x.io then @note/spec')).toEqual([
      { index: 0, fullMatch: '@src/a.ts', captured: 'src/a.ts' },
      { index: 34, fullMatch: '@note/spec', captured: 'note/spec' },
    ]);
  });

  it('returns an empty array for text without mentions', () => {
    expect(findInlineMentions('plain text with no at-signs')).toEqual([]);
  });
});
