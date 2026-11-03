import { describe, expect, it } from 'vitest';
import {
  PICKED_MENTIONS_METADATA_KEY,
  pickedMentionsMetadata,
  readPickedMentionTokens,
  scanChatMentions,
} from './registry';

describe('pickedMentionsMetadata', () => {
  it('records the tokens of file and folder chips the composer saves', () => {
    expect(
      pickedMentionsMetadata([
        { type: 'file', id: 'src/a.ts', label: 'a.ts', meta: { fullPath: 'src/a.ts' } },
        { type: 'folder', id: 'src/lib', label: 'lib', meta: { fullPath: 'src/lib' } },
        {
          type: 'file-range',
          id: 'src/b.ts',
          label: 'b.ts',
          meta: { fullPath: 'src/b.ts', range: { start: 3, end: 7 } },
        },
        { type: 'rule', id: 'r', label: 'r.md', meta: { path: '.intent/rules/r.md' } },
      ]),
    ).toEqual({
      [PICKED_MENTIONS_METADATA_KEY]: [
        '@src/a.ts',
        '@src/lib/',
        '@src/b.ts:L3-7',
        '@.intent/rules/r.md',
      ],
    });
  });

  it('records nothing for chips with their own token syntax, and dedupes', () => {
    expect(
      pickedMentionsMetadata([
        { type: 'note', id: 'spec', label: 'Spec' },
        { type: 'branch', id: 'feature/x', label: 'feature/x' },
        { type: 'file', id: 'a.ts', label: 'a.ts', meta: { fullPath: 'a.ts' } },
        { type: 'file', id: 'a.ts', label: 'a.ts', meta: { fullPath: 'a.ts' } },
      ]),
    ).toEqual({ [PICKED_MENTIONS_METADATA_KEY]: ['@a.ts'] });
  });

  it('records an empty list when nothing was picked', () => {
    expect(pickedMentionsMetadata([])).toEqual({ [PICKED_MENTIONS_METADATA_KEY]: [] });
  });
});

describe('readPickedMentionTokens', () => {
  it('is null for messages sent without a record', () => {
    expect(readPickedMentionTokens(undefined)).toBeNull();
    expect(readPickedMentionTokens(null)).toBeNull();
    expect(readPickedMentionTokens({ type: 'question_answers' })).toBeNull();
    expect(readPickedMentionTokens({ mentionTokens: 'nope' })).toBeNull();
  });

  it('reads the recorded tokens, ignoring anything that is not a string', () => {
    expect(readPickedMentionTokens({ mentionTokens: ['@a.ts', 3, null, '@b/'] })).toEqual([
      '@a.ts',
      '@b/',
    ]);
    expect(readPickedMentionTokens({ mentionTokens: [] })).toEqual([]);
  });

  it('joins the records of queued messages the daemon merged', () => {
    expect(
      readPickedMentionTokens({
        mentionTokens: ['@a.ts'],
        mergedMessageMetadata: [{ mentionTokens: ['@a.ts'] }, { mentionTokens: ['@b.ts'] }],
      }),
    ).toEqual(['@a.ts', '@b.ts']);
  });

  it('falls back to guessing when any merged part has no record', () => {
    expect(
      readPickedMentionTokens({
        mentionTokens: ['@a.ts'],
        mergedMessageMetadata: [{ mentionTokens: ['@a.ts'] }, null],
      }),
    ).toBeNull();
    expect(
      readPickedMentionTokens({
        mentionTokens: ['@a.ts'],
        mergedMessageMetadata: [{ mentionTokens: ['@a.ts'] }, { fromPrincipalId: 'p' }],
      }),
    ).toBeNull();
  });
});

describe('scanChatMentions with a record', () => {
  const texts = (text: string, picked: readonly string[] | null) =>
    scanChatMentions(text, picked).map((match) => match.text);

  it('leaves pasted package specs as text (regression)', () => {
    expect(texts('npm dist-tag add @intent-hq/web@2.277.0 latest', [])).toEqual([]);
    expect(texts('npm i @types/node and see @user/repo', [])).toEqual([]);
  });

  it('chips only the recorded paths', () => {
    expect(texts('compare @src/a.ts with @src/b.ts', ['@src/b.ts'])).toEqual(['@src/b.ts']);
  });

  it('keeps chipping tokens with their own syntax', () => {
    expect(texts('see @note/spec and @note[spec:Spec]', [])).toEqual([
      '@note/spec',
      '@note[spec:Spec]',
    ]);
  });

  it('chips a recorded path that guessing would reject or cut short', () => {
    expect(texts('ship @intent-hq/web@2.277.0 now', ['@intent-hq/web@2.277.0'])).toEqual([
      '@intent-hq/web@2.277.0',
    ]);
    expect(texts('open @my docs/a.md now', ['@my docs/a.md'])).toEqual(['@my docs/a.md']);
    expect(texts('run @Makefile', ['@Makefile'])).toEqual(['@Makefile']);
  });

  it('needs a boundary on both sides of a recorded path', () => {
    expect(texts('see @src/a.tsx', ['@src/a.ts'])).toEqual([]);
    expect(texts('see x@src/a.ts', ['@src/a.ts'])).toEqual([]);
    expect(texts('see @src/a.ts.bak', ['@src/a.ts'])).toEqual([]);
    expect(texts('see (@src/a.ts), then @src/a.ts.', ['@src/a.ts'])).toEqual([
      '@src/a.ts',
      '@src/a.ts',
    ]);
  });

  it('prefers the longest recorded path at a position', () => {
    expect(texts('see @src/lib/a.ts', ['@src/lib/', '@src/lib/a.ts'])).toEqual(['@src/lib/a.ts']);
  });

  it('parses recorded files and folders', () => {
    const [file, folder] = scanChatMentions('@src/a.ts:L3-7 @src/lib/', [
      '@src/a.ts:L3-7',
      '@src/lib/',
    ]);
    expect(file.parsed).toMatchObject({ kind: 'path', path: 'src/a.ts', line: 3 });
    expect(folder.parsed).toMatchObject({ kind: 'folder', path: 'src/lib' });
  });
});

describe('scanChatMentions without a record (older messages)', () => {
  const parsed = (text: string) =>
    scanChatMentions(text, null).map((match) => [match.text, match.parsed !== null]);

  it('does not chip a package@version spec (regression)', () => {
    expect(parsed('npm dist-tag add @intent-hq/web@2.277.0 latest')).toEqual([
      ['@intent-hq/web@2.277.0', false],
    ]);
    expect(parsed('npm i @scope/pkg@latest')).toEqual([['@scope/pkg@latest', false]]);
    expect(parsed('npm i @scope/pkg@^1.2.0')).toEqual([['@scope/pkg@^1.2.0', false]]);
  });

  it('still chips paths with an @ that is not a version', () => {
    expect(parsed('see @assets/icon@2x.png')).toEqual([['@assets/icon@2x.png', true]]);
    expect(parsed('check @src/foo.rs now')).toEqual([['@src/foo.rs', true]]);
  });
});
