import { describe, expect, it } from 'vitest';
import {
  MENTION_SERIALIZERS,
  MENTION_TOKEN_ENTRIES,
  hasMentionToken,
  hasParsedMention,
  mentionChipAttrs,
  mentionElement,
  mentionTokensToText,
  parsePathSuffix,
  scanMentions,
  stripContextMentions,
  toPromptToken,
  type MentionSurface,
} from './registry';

const NOTE_ID = '3f2a9c1e-7b4d-4e8a-9f10-2c5d6e7f8a9b';

function only(text: string, surface: MentionSurface) {
  const matches = scanMentions(text, surface);
  expect(matches).toHaveLength(1);
  return matches[0];
}

function base64Json(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return btoa(String.fromCharCode(...bytes));
}

describe('mention registry entries', () => {
  it('have unique names and no capturing groups', () => {
    const names = MENTION_TOKEN_ENTRIES.map((entry) => entry.name);
    expect(new Set(names).size).toBe(names.length);
    for (const entry of MENTION_TOKEN_ENTRIES) {
      // `x|` always matches the empty string; its group count is the source's.
      expect(new RegExp(`${entry.source}|`).exec('')!.length, entry.name).toBe(1);
    }
  });

  it('every entry is read by at least one surface', () => {
    for (const entry of MENTION_TOKEN_ENTRIES) expect(entry.surfaces.length).toBeGreaterThan(0);
  });
});

describe('scanMentions', () => {
  it('reads a note token whose title has spaces as one note', () => {
    const match = only(`see @note[${NOTE_ID}:Meeting with Andre] now`, 'markdown');
    expect(match.entry.name).toBe('note');
    expect(match.parsed).toEqual({
      kind: 'note',
      form: 'token',
      note: { id: NOTE_ID, title: 'Meeting with Andre' },
    });
  });

  it('reads terminal and script tokens', () => {
    const [terminal, script] = scanMentions(
      '@terminal[pty-0:Build server] @script[s1:Dev]',
      'chat',
    );
    expect(terminal.parsed).toEqual({
      kind: 'runtime',
      mention: { kind: 'terminal', id: 'pty-0', name: 'Build server' },
    });
    expect(script.parsed).toEqual({
      kind: 'runtime',
      mention: { kind: 'script', id: 's1', name: 'Dev' },
    });
  });

  it('keeps reading the legacy forms', () => {
    expect(only('@note/spec', 'chat').parsed).toEqual({
      kind: 'note',
      form: 'legacy',
      note: { id: 'spec', title: 'spec' },
    });
    // Legacy terminal tokens read as a path, as they always have.
    expect(only('@terminal/zsh', 'chat').parsed).toMatchObject({
      kind: 'path',
      path: 'terminal/zsh',
    });
    expect(only('intent://local/ws-2/note/n1', 'markdown').parsed).toEqual({
      kind: 'note',
      form: 'intent-url',
      note: { id: 'n1', title: 'n1' },
      url: 'intent://local/ws-2/note/n1',
      workspaceId: 'ws-2',
    });
    expect(only('src/lib/a.ts', 'markdown').parsed).toMatchObject({
      kind: 'path',
      path: 'src/lib/a.ts',
      metaKey: 'fullPath',
    });
  });

  it('reads base64 and pipe context tokens', () => {
    const encoded = base64Json({ provider: 'linear', identifier: 'AU-1', title: 'Fix ✓' });
    expect(only(`@context[${encoded}]`, 'chat').parsed).toEqual({
      kind: 'context',
      context: { itemType: 'linear-issue', provider: 'linear', identifier: 'AU-1', title: 'Fix ✓' },
    });
    expect(only('@context[github|#12|Title [draft]]', 'markdown').parsed).toEqual({
      kind: 'context',
      context: {
        itemType: 'github-issue',
        provider: 'github',
        identifier: '#12',
        title: 'Title [draft]',
      },
    });
  });

  it('marks a malformed token as unparsed so readers keep its text', () => {
    const match = only('@member[bm90LWpzb24=]', 'markdown');
    expect(match.entry.name).toBe('member');
    expect(match.parsed).toBeNull();
  });

  it('prefers the earliest match, then the first listed entry', () => {
    // A bare file name inside the note title must not win over the note token.
    const matches = scanMentions(`@note[${NOTE_ID}:readme.md notes]`, 'markdown');
    expect(matches.map((m) => m.entry.name)).toEqual(['note']);
    // `@note/` beats the path heuristics at the same position.
    expect(only('@note/abc', 'markdown').entry.name).toBe('legacy-note');
  });

  it('skips email addresses in chat but not in markdown', () => {
    expect(scanMentions('mail clement@shv.com', 'chat')).toEqual([]);
    expect(scanMentions('(@note/spec)', 'chat').map((m) => m.text)).toEqual(['@note/spec']);
  });

  it('chips bare file names only in markdown', () => {
    expect(scanMentions('open readme.md', 'chat')).toEqual([]);
    expect(only('open readme.md', 'markdown').parsed).toMatchObject({
      kind: 'path',
      path: 'readme.md',
      metaKey: 'filename',
    });
  });

  it('reads every line suffix form on paths', () => {
    for (const [suffix, line] of [
      [':12', 12],
      [':12:3', 12],
      ['#L3-7', 3],
      [':L3-7', 3],
    ] as const) {
      for (const surface of ['chat', 'markdown'] as const) {
        const match = only(`@src/lib/a.ts${suffix} next`, surface);
        expect(match.text, `${surface} ${suffix}`).toBe(`@src/lib/a.ts${suffix}`);
        expect(match.parsed).toMatchObject({ kind: 'path', path: 'src/lib/a.ts', line });
      }
    }
  });

  it('decodes the matched text before parsing when asked', () => {
    const match = only('@terminal[t1:R&amp;D]', 'markdown');
    expect(match.parsed).toMatchObject({ mention: { name: 'R&amp;D' } });
    const decoded = scanMentions('@terminal[t1:R&amp;D]', 'markdown', {
      decode: (s) => s.replace(/&amp;/g, '&'),
    });
    expect(decoded[0].parsed).toMatchObject({ mention: { name: 'R&D' } });
    expect(decoded[0].text).toBe('@terminal[t1:R&amp;D]');
  });

  it('hasMentionToken matches what scanMentions finds', () => {
    expect(hasMentionToken('plain words only', 'markdown')).toBe(false);
    expect(hasMentionToken('see @script[s1:Dev]', 'markdown')).toBe(true);
    // The shared regex state does not leak between calls.
    expect(hasMentionToken('see @script[s1:Dev]', 'markdown')).toBe(true);
  });
});

describe('reader regressions', () => {
  it('keeps a #L<line>C<column> suffix through a chip round trip', () => {
    const chip = mentionChipAttrs(only('@/abs/a.ts#L3C5', 'markdown').parsed!)!;
    expect(chip.meta).toEqual({ fullPath: '/abs/a.ts', line: 3, lineSuffix: '#L3C5' });
    expect(toPromptToken({ type: 'file', id: chip.id!, label: chip.label, meta: chip.meta })).toBe(
      '@/abs/a.ts#L3C5',
    );
  });

  it('keeps an unsupported suffix as part of the path', () => {
    expect(only('@/abs/a.ts#Lx', 'markdown').parsed).toEqual({
      kind: 'path',
      path: '/abs/a.ts#Lx',
      target: '/abs/a.ts#Lx',
      metaKey: 'fullPath',
    });
  });

  it('reads and strips legacy context tokens with an unbalanced bracket', () => {
    const token = '@context[github|1|Fix [WIP thing]';
    expect(only(`see ${token} now`, 'chat').parsed).toMatchObject({
      kind: 'context',
      context: { provider: 'github', identifier: '1', title: 'Fix [WIP thing' },
    });
    expect(stripContextMentions(`see ${token} now`)).toBe('see  now');
  });
});

describe('parsePathSuffix', () => {
  it('splits the serializer range form and the link forms', () => {
    expect(parsePathSuffix('a.ts:L3-7')).toEqual({ path: 'a.ts', line: 3 });
    expect(parsePathSuffix('a.ts#L3-7')).toEqual({ path: 'a.ts', line: 3 });
    expect(parsePathSuffix('src/a.ts:12')).toEqual({ path: 'src/a.ts', line: 12 });
    expect(parsePathSuffix('src/a.ts')).toEqual({ path: 'src/a.ts' });
  });
});

describe('chips', () => {
  it('labels a path chip with its suffix and keeps the suffix for saving', () => {
    const parsed = only('@src/a.ts:12', 'markdown').parsed!;
    const chip = mentionChipAttrs(parsed)!;
    expect(chip).toEqual({
      type: 'file',
      id: 'src/a.ts',
      label: 'src/a.ts:12',
      meta: { fullPath: 'src/a.ts', line: 12, lineSuffix: ':12' },
    });
    expect(toPromptToken({ type: 'file', id: chip.id!, label: chip.label, meta: chip.meta })).toBe(
      '@src/a.ts:12',
    );
  });

  it('round-trips a file name chip without doubling the suffix', () => {
    const chip = mentionChipAttrs(only('@a.ts#L3-7', 'markdown').parsed!)!;
    expect(chip.meta).toEqual({ filename: 'a.ts', line: 3, lineSuffix: '#L3-7' });
    expect(toPromptToken({ type: 'file', id: chip.id!, label: chip.label, meta: chip.meta })).toBe(
      '@a.ts#L3-7',
    );
  });

  it('emits chip attributes in a fixed order', () => {
    const element = mentionElement(only('@note/spec', 'markdown').parsed!)!;
    expect(element.attributes.map(([name]) => name)).toEqual([
      'data-mention',
      'data-type',
      'data-id',
      'data-label',
      'data-meta',
    ]);
    expect(element.text).toBe('spec');
  });

  it('emits a context element with the title as text', () => {
    const element = mentionElement(only('@context[linear|AU-1|Fix it]', 'markdown').parsed!)!;
    expect(element.text).toBe('Fix it');
    expect(Object.fromEntries(element.attributes)).toMatchObject({
      'data-type': 'context-mention',
      'data-item-type': 'linear-issue',
      'data-provider': 'linear',
      'data-identifier': 'AU-1',
    });
  });
});

describe('previews', () => {
  it('renders tokens as their labels and leaves other text alone', () => {
    expect(
      mentionTokensToText(
        `Run @script[s1:Dev server] in @terminal[pty-0:zsh] for @note[${NOTE_ID}:Plan] @terminal/old`,
      ),
    ).toBe('Run @Dev server in @zsh for @Plan @terminal/old');
  });

  it('strips context tokens, including bracketed titles', () => {
    expect(stripContextMentions('a @context[github|#1|T [x]] b')).toBe('a  b');
  });

  it('finds parsed mentions of one kind', () => {
    expect(hasParsedMention(`hi @note[${NOTE_ID}:Plan]`, 'preview', 'member')).toBe(false);
    expect(hasParsedMention(`hi @note[${NOTE_ID}:Plan]`, 'preview', 'note')).toBe(true);
  });
});

describe('serializers', () => {
  it('cover every mention type', () => {
    expect(Object.keys(MENTION_SERIALIZERS).length).toBeGreaterThan(0);
    expect(toPromptToken({ type: 'agent', id: 'agent-1', label: 'Build agent' })).toBe(
      '@Build agent',
    );
    expect(
      toPromptToken({
        type: 'specialist',
        id: 'specialist-implementor',
        label: 'Implementor',
        meta: { promptToken: 'specialist/implementor' } as never,
      }),
    ).toBe('@specialist/implementor');
  });

  it('writes a composer range as :L<a>-<b>', () => {
    expect(
      toPromptToken({
        type: 'file-range',
        id: 'x',
        label: 'a.ts',
        meta: { fullPath: 'src/a.ts', range: { start: 3, end: 7 } } as never,
      }),
    ).toBe('@src/a.ts:L3-7');
  });

  it('ignores a malformed saved suffix', () => {
    expect(
      toPromptToken({
        type: 'file',
        id: 'x',
        label: 'a.ts',
        meta: { fullPath: 'src/a.ts', lineSuffix: ' evil' } as never,
      }),
    ).toBe('@src/a.ts');
  });
});

describe('folder tokens', () => {
  const folders = (text: string, surface: MentionSurface) =>
    scanMentions(text, surface)
      .filter((match) => match.parsed?.kind === 'folder')
      .map((match) => match.text);

  it('saves a folder with a trailing slash, once', () => {
    for (const fullPath of ['src/lib', 'src/lib/', 'src']) {
      expect(
        toPromptToken({ type: 'folder', id: 'x', label: 'lib', meta: { fullPath } as never }),
      ).toBe(fullPath === 'src' ? '@src/' : '@src/lib/');
    }
    expect(
      toPromptToken({
        type: 'source-folder',
        id: 'x',
        label: 'lib',
        meta: { path: 'a/b' } as never,
      }),
    ).toBe('@a/b/');
  });

  it('reads a folder token as a folder chip that saves back the same token', () => {
    const match = only('see @src/lib/ now', 'markdown');
    expect(match.parsed).toEqual({ kind: 'folder', path: 'src/lib', target: 'src/lib/' });
    const chip = mentionChipAttrs(match.parsed!)!;
    expect(chip).toEqual({
      type: 'folder',
      id: 'src/lib',
      label: 'src/lib/',
      meta: { fullPath: 'src/lib' },
    });
    expect(toPromptToken({ ...chip, id: chip.id! })).toBe('@src/lib/');
  });

  it('reads one-segment folders and folders before sentence punctuation', () => {
    for (const surface of ['chat', 'markdown'] as const) {
      expect(folders('in @src/, then @src/lib/. Also (@docs/)', surface)).toEqual([
        '@src/',
        '@src/lib/',
        '@docs/',
      ]);
    }
  });

  it('does not chip plain text or legacy extensionless paths as folders', () => {
    for (const surface of ['chat', 'markdown'] as const) {
      expect(
        folders(
          'and/or @user/repo @src/lib @src/lib/a.ts @src/lib/.hidden x/y/ git@github.com:org/repo/',
          surface,
        ),
      ).toEqual([]);
    }
    expect(hasMentionToken('and/or, either/or', 'markdown')).toBe(false);
    expect(hasMentionToken('ping @user/repo', 'markdown')).toBe(false);
  });

  it('reads a folder under note/ as a folder, and keeps legacy @note/<id>', () => {
    for (const surface of ['chat', 'markdown'] as const) {
      expect(only('@note/assets/', surface).parsed).toEqual({
        kind: 'folder',
        path: 'note/assets',
        target: 'note/assets/',
      });
      expect(only('@note/abc', surface).parsed).toMatchObject({ kind: 'note', form: 'legacy' });
    }
  });

  it('ends a folder token at an HTML-escaped delimiter', () => {
    expect(folders('@docs/&quot; @src/&nbsp;next @a/&#160;b @lib/&lt;', 'markdown')).toEqual([
      '@docs/',
      '@src/',
      '@a/',
      '@lib/',
    ]);
  });

  it('leaves a folder token as written in previews', () => {
    expect(mentionTokensToText('look in @src/lib/ please')).toBe('look in @src/lib/ please');
  });
});
