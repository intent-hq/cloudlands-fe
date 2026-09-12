import { describe, expect, it } from 'vitest';
import {
  ALLOWLIST,
  findBarePnpmViolations,
  findStaleAllowlistEntries,
  formatViolation,
} from './check-package-scripts.mjs';

describe('package.json bare pnpm nesting guard', () => {
  it.each([
    ['a nested pnpm run', 'pnpm run lint:i18n-strings', 'pnpm run lint:i18n-strings'],
    ['pnpm exec', 'pnpm exec tsc -p tsconfig.json', 'pnpm exec tsc -p tsconfig.json'],
    [
      'a direct pnpm binary call',
      'pnpm tsc -p tsconfig.json --noEmit',
      'pnpm tsc -p tsconfig.json --noEmit',
    ],
    ['pnpm dlx', 'pnpm dlx some-tool', 'pnpm dlx some-tool'],
    [
      'a quoted concurrently member',
      'concurrently "pnpm run a" "node scripts/x.mjs"',
      'pnpm run a',
    ],
    ['a chained pnpm run', 'node scripts/x.mjs && pnpm run b', 'pnpm run b'],
    ['an or-chained pnpm run', 'node scripts/x.mjs || pnpm run b', 'pnpm run b'],
    ['a semicolon-chained pnpm run', 'node scripts/x.mjs; pnpm run b', 'pnpm run b'],
    ['a parenthesised pnpm run', '(pnpm run b)', 'pnpm run b'],
    ['an env-prefixed pnpm run', 'cross-env FOO=1 pnpm run b', 'pnpm run b'],
    ['a bare pnpm with no arguments', 'pnpm', 'pnpm'],
  ])('flags %s', (_name, value, fragment) => {
    expect(findBarePnpmViolations({ probe: value })).toMatchObject([{ script: 'probe', fragment }]);
  });

  it.each([
    ['the run wrapper', 'node scripts/pnpm-run.mjs lint:i18n-strings lint:dead-code'],
    [
      'a quoted run wrapper',
      'concurrently "node scripts/pnpm-run.mjs a" "node scripts/pnpm-run.mjs b"',
    ],
    ['the launcher path', 'node scripts/pnpm-launcher.mjs'],
    ['a bare binary', 'tsc -p tsconfig.json --noEmit'],
    ['a direct scanner', 'node scripts/check-deps-fresh.mjs && eslint --cache .'],
    ['a pnpm-prefixed file name', 'vitest run scripts/pnpm-run.test.ts'],
    ['pnpm inside an identifier', 'echo mypnpm && echo pnpmx'],
    ['npm version', 'npm version patch --no-git-tag-version'],
  ])('does not flag %s', (_name, value) => {
    expect(findBarePnpmViolations({ ok: value })).toEqual([]);
  });

  it('reports every offending fragment of a script in order', () => {
    const violations = findBarePnpmViolations({
      build: 'pnpm run a && concurrently "pnpm run b" "pnpm exec c"',
    });
    expect(violations.map((violation) => violation.fragment)).toEqual([
      'pnpm run a',
      'pnpm run b',
      'pnpm exec c',
    ]);
  });

  it('suggests the matching fix for each form', () => {
    const fixes = Object.fromEntries(
      findBarePnpmViolations({
        run: 'pnpm run lint:dead-code',
        exec: 'pnpm exec tsc -p tsconfig.json',
        bin: 'pnpm tsc -p tsconfig.json',
      }).map(({ script, fix }) => [script, fix]),
    );
    expect(fixes.run).toContain('node scripts/pnpm-run.mjs lint:dead-code');
    expect(fixes.exec).toContain('`tsc`');
    expect(fixes.bin).toContain('`tsc`');
  });

  it('skips allowlisted scripts and ignores non-string values', () => {
    const scripts = { legacy: 'pnpm run x', other: 'pnpm run y', weird: 42 };
    expect(findBarePnpmViolations(scripts, { legacy: 'documented reason' })).toMatchObject([
      { script: 'other', fragment: 'pnpm run y' },
    ]);
  });

  it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty'])(
    'flags a script named %s despite the empty allowlist',
    (name) => {
      const scripts = JSON.parse(`{"${name}": "pnpm run lint:i18n-strings"}`);
      expect(findBarePnpmViolations(scripts)).toMatchObject([
        { script: name, fragment: 'pnpm run lint:i18n-strings' },
      ]);
      expect(findBarePnpmViolations(scripts, {})).toHaveLength(1);
    },
  );

  it('honours only an explicit allowlist entry for a prototype-colliding name', () => {
    const scripts = JSON.parse('{"constructor": "pnpm run x", "toString": "pnpm run y"}');
    expect(findBarePnpmViolations(scripts, { constructor: 'documented reason' })).toMatchObject([
      { script: 'toString', fragment: 'pnpm run y' },
    ]);
  });

  it('treats a prototype-colliding allowlist entry as stale only when its script is absent', () => {
    const scripts = JSON.parse('{"constructor": "pnpm run x"}');
    expect(findStaleAllowlistEntries(scripts, { constructor: 'reason' })).toEqual([]);
    expect(findStaleAllowlistEntries({}, { toString: 'reason' })).toEqual(['toString']);
  });

  it('reports allowlist entries whose script is missing or clean', () => {
    const scripts = { clean: 'node scripts/pnpm-run.mjs x', dirty: 'pnpm run x' };
    const allowlist = { clean: 'stale', dirty: 'still needed', gone: 'removed script' };
    expect(findStaleAllowlistEntries(scripts, allowlist)).toEqual(['clean', 'gone']);
  });

  it('ships an empty allowlist', () => {
    expect(Object.keys(ALLOWLIST)).toEqual([]);
  });

  it('names the script and the fragment in the report line', () => {
    const [violation] = findBarePnpmViolations({ probe: 'pnpm run lint:i18n-strings' });
    expect(formatViolation(violation)).toContain('scripts.probe');
    expect(formatViolation(violation)).toContain('pnpm run lint:i18n-strings');
  });
});
