import { describe, expect, it } from 'vitest';
import { findInstructionThemisPinViolations } from './check-instruction-themis-pins.mjs';

const instructionFile = (path: string, lines: string[]) => ({ path, content: lines.join('\n') });

describe('instruction Themis pin guard', () => {
  it('passes an instruction file that refers to the package.json version', () => {
    const files = [
      instructionFile('src/store/renderer/AGENTS.md', [
        '# Redux Store — Agent Directives',
        '',
        '> The `@augmentcode/themis` version declared in `package.json` is the canonical',
        '> Store implementation.',
        '',
        '- Import helpers from `@augmentcode/themis/utils/collections/collection-utils`.',
        "import { createAction } from '@augmentcode/themis/utils/store/create-action';",
      ]),
    ];
    expect(findInstructionThemisPinViolations(files)).toEqual([]);
  });

  it('flags a literal version pin with its path and line', () => {
    const files = [
      instructionFile('src/store/renderer/AGENTS.md', [
        '# Redux Store — Agent Directives',
        '',
        '> `@augmentcode/themis@0.1.1` is the canonical Store implementation.',
      ]),
    ];
    expect(findInstructionThemisPinViolations(files)).toEqual([
      { path: 'src/store/renderer/AGENTS.md', line: 3, match: '@augmentcode/themis@0.1.1' },
    ]);
  });

  it('flags a pin even when it matches the installed version', () => {
    const files = [instructionFile('AGENTS.md', ['Use `@augmentcode/themis@0.2.5` everywhere.'])];
    expect(findInstructionThemisPinViolations(files)).toHaveLength(1);
    expect(findInstructionThemisPinViolations(files)[0]).toMatchObject({
      line: 1,
      match: '@augmentcode/themis@0.2.5',
    });
  });

  it.each([
    ['a bare package reference', 'The `@augmentcode/themis` package owns the Store.'],
    [
      'a subpath import',
      "import { getItem } from '@augmentcode/themis/utils/collections/collection-utils';",
    ],
    ['a subpath reference in prose', 'Reference: `@augmentcode/themis/utils/store/create-action`.'],
  ])('does not flag %s', (_name, line) => {
    expect(
      findInstructionThemisPinViolations([instructionFile('src/features/AGENTS.md', [line])]),
    ).toEqual([]);
  });

  it('ignores files that are not AGENTS.md', () => {
    const files = [
      instructionFile('CHANGELOG.md', ['- bump to `@augmentcode/themis@0.2.5`']),
      instructionFile('package.json', ['"@augmentcode/themis@0.2.5"']),
      instructionFile('src/store/renderer/docs/AGENTS.md.bak', ['`@augmentcode/themis@0.1.1`']),
    ];
    expect(findInstructionThemisPinViolations(files)).toEqual([]);
  });

  it('reports every pin across lines and files in order', () => {
    const files = [
      instructionFile('AGENTS.md', [
        'ok',
        '`@augmentcode/themis@0.1.1`',
        'ok',
        '`@augmentcode/themis@next`',
      ]),
      instructionFile('src/AGENTS.md', ['`@augmentcode/themis@^0.2.0`']),
    ];
    expect(findInstructionThemisPinViolations(files)).toEqual([
      { path: 'AGENTS.md', line: 2, match: '@augmentcode/themis@0.1.1' },
      { path: 'AGENTS.md', line: 4, match: '@augmentcode/themis@next' },
      { path: 'src/AGENTS.md', line: 1, match: '@augmentcode/themis@^0.2.0' },
    ]);
  });
});
