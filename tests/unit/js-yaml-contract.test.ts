/**
 * Pins the js-yaml semantics our scripts and tests rely on (workflow,
 * electron-builder and update-feed YAML), so a dependency upgrade that
 * changes loading, dumping or tag safety fails here first.
 */
import { describe, expect, it } from 'vitest';
import { dump, load } from 'js-yaml';

const workflowLike = `name: CI
on:
  push:
    branches: [main]
  workflow_dispatch: {}
env:
  RETRIES: 3
  RATIO: 0.5
  ENABLED: true
  EMPTY: null
  VERSION: '2.310.0'
  BUILD: 2.310.0
  YES_WORD: yes
  OFF_WORD: off
  OCTAL_LIKE: 0755
  DATE: 2026-11-10
  UNDERSCORED: 1_000
jobs:
  test:
    runs-on: ubuntu-24.04
    steps:
      - run: |
          echo one
          echo two
      - name: folded
        run: >-
          pnpm run
          test:unit
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0
`;

const expectedWorkflow = {
  name: 'CI',
  on: { push: { branches: ['main'] }, workflow_dispatch: {} },
  env: {
    RETRIES: 3,
    RATIO: 0.5,
    ENABLED: true,
    EMPTY: null,
    VERSION: '2.310.0',
    BUILD: '2.310.0',
    YES_WORD: 'yes',
    OFF_WORD: 'off',
    OCTAL_LIKE: 755,
    DATE: '2026-11-10',
    UNDERSCORED: '1_000',
  },
  jobs: {
    test: {
      'runs-on': 'ubuntu-24.04',
      steps: [
        { run: 'echo one\necho two\n' },
        { name: 'folded', run: 'pnpm run test:unit' },
        { uses: 'actions/checkout@v6', with: { 'fetch-depth': 0 } },
      ],
    },
  },
};

const feed = {
  version: '2.310.0',
  files: [
    {
      url: 'Intent-Setup-2.310.0.exe',
      sha512: 'q1w2e3+/r4t5==',
      size: 123456789,
    },
  ],
  path: 'Intent-Setup-2.310.0.exe',
  sha512: 'q1w2e3+/r4t5==',
  releaseDate: '2026-11-10T10:00:00.000Z',
  publisherName: ['Clement Pang'],
};

describe('js-yaml contract', () => {
  it('loads workflow-style YAML with YAML 1.2 core scalar rules', () => {
    expect(load(workflowLike)).toStrictEqual(expectedWorkflow);
  });

  it('round-trips representative documents through dump and load', () => {
    for (const value of [expectedWorkflow, feed]) {
      expect(load(dump(value))).toStrictEqual(value);
    }
  });

  it('dumps an update feed in the block style electron-updater reads', () => {
    expect(dump(feed)).toBe(`version: 2.310.0
files:
  - url: Intent-Setup-2.310.0.exe
    sha512: q1w2e3+/r4t5==
    size: 123456789
path: Intent-Setup-2.310.0.exe
sha512: q1w2e3+/r4t5==
releaseDate: '2026-11-10T10:00:00.000Z'
publisherName:
  - Clement Pang
`);
  });

  it('quotes strings that would otherwise load as other types', () => {
    const ambiguous = { a: 'true', b: '123', c: 'null', d: 'yes', e: '2026-11-10', f: '' };
    expect(load(dump(ambiguous))).toStrictEqual(ambiguous);
  });

  it.each([
    ['JS function', 'x: !!js/function "function () { return 1 }"'],
    ['JS regexp', 'x: !!js/regexp /a/g'],
    ['JS undefined', 'x: !!js/undefined ""'],
    ['verbatim JS function', 'x: !<tag:yaml.org,2002:js/function> "function () {}"'],
    ['Python object', 'x: !!python/object:os.system ["id"]'],
    ['unknown local tag', 'x: !custom value'],
  ])('rejects the unsafe or unknown %s tag', (_label, source) => {
    expect(() => load(source)).toThrow();
  });

  it('rejects duplicate mapping keys', () => {
    expect(() => load('a: 1\na: 2\n')).toThrow();
  });

  it('does not apply YAML 1.1 merge keys by default', () => {
    const loaded = load('base: &base\n  a: 1\nderived:\n  <<: *base\n  b: 2\n') as {
      derived: Record<string, unknown>;
    };
    expect(loaded.derived).not.toHaveProperty('a');
  });

  it('throws on empty input instead of returning undefined', () => {
    expect(() => load('')).toThrow();
  });
});
