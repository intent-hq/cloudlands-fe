// @vitest-environment node
// @verify-changed-triggers: eslint.config.js, eslint-rules/internal-module-import-patterns.js, svelte.config.js

import { describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';
import { internalModuleImportPatterns } from '../eslint-rules/internal-module-import-patterns.js';
import {
  HELPER_PATH,
  RULE_IDS,
  aliasDirectories,
  checkRestrictedImportSpellings,
  formatViolation,
  isInternalSource,
  loadInputs,
} from './check-restricted-import-spellings.mjs';

const ALIASES = aliasDirectories({
  $lib: './src/lib',
  $features: './src/features',
  '@fortawesome/free-solid-svg-icons': './src/lib/icons/phosphor-icons.ts',
});
const FILES = ['src/lib/components/chat/input/ModelPicker.svelte'];
const AGENT_CLIENT = internalModuleImportPatterns('$features', 'features/agent/agent.client');

const configured = (rule: string, ruleConfig: unknown) => ({
  files: FILES,
  rules: { [rule]: ruleConfig },
});
const block = (rule: string, ...options: unknown[]) => configured(rule, ['error', ...options]);
const check = (...blocks: unknown[]) => checkRestrictedImportSpellings(blocks, ALIASES);
const entries = (...blocks: unknown[]) => check(...blocks).map((violation) => violation.entry);

// The oracle: ESLint itself, on a probe module importing `source` under one
// `no-restricted-imports` configuration.
const restrictedMessages = async (ruleConfig: unknown, source: string) => {
  const eslint = new ESLint({
    cwd: process.cwd(),
    overrideConfigFile: true,
    overrideConfig: [{ files: ['**/*.js'], rules: { 'no-restricted-imports': ruleConfig } }],
  });
  const [result] = await eslint.lintText(`import * as m from '${source}';\nexport { m };\n`, {
    filePath: 'src/lib/components/chat/input/probe.js',
  });
  return (result?.messages ?? []).filter((message) => message.ruleId === 'no-restricted-imports');
};

describe('restricted-import spellings guard', () => {
  it.each([
    ['$features/agent/agent.client', true],
    ['$lib/foo', true],
    ['./agent.client', true],
    ['../../features/agent/agent.client.ts', true],
    ['/src/features/agent/agent.client', true],
    ['src/features/agent/agent.client', true],
    ['**/features/agent/agent.client', true],
    ['electron', false],
    ['child_process', false],
    ['@playwright/experimental-ct-svelte', false],
    ['node:fs', false],
    ['$app/navigation', false],
    ['$env/static/private', false],
    ['$service-worker', false],
  ])('classifies %s as internal=%s', (source, internal) => {
    expect(isInternalSource(source, ALIASES)).toBe(internal);
  });

  it('treats a `$` root outside kit.alias as a package, not an internal module', () => {
    expect(
      check(
        block('no-restricted-imports', { paths: ['$app/navigation', { name: '$app/stores' }] }),
        block('no-restricted-imports', { patterns: ['$service-worker'] }),
        block('no-restricted-imports', { patterns: [{ group: ['$env/static/private'] }] }),
        block('no-restricted-imports', { patterns: [{ group: [...AGENT_CLIENT, '$unknown/x'] }] }),
      ),
    ).toEqual([]);
    expect(entries(block('no-restricted-imports', { paths: ['$lib/foo'] }))).toEqual([
      'paths entry "$lib/foo"',
    ]);
    const withApp = aliasDirectories({ $lib: './src/lib', $app: './src/app' });
    const config = [block('no-restricted-imports', { paths: ['$app/navigation'] })];
    expect(checkRestrictedImportSpellings(config, withApp)).toHaveLength(1);
  });

  it('maps only `$alias` → `./src/<dir>` entries of kit.alias, so a new alias is picked up', () => {
    expect([...ALIASES]).toEqual([
      ['$lib', 'lib'],
      ['$features', 'features'],
    ]);
    const withNewAlias = aliasDirectories({ $widgets: './src/widgets/' });
    const group = internalModuleImportPatterns('$widgets', 'widgets/button');
    const config = [block('no-restricted-imports', { patterns: [{ group }] })];
    expect(checkRestrictedImportSpellings(config, withNewAlias)).toEqual([]);
    const unmapped = checkRestrictedImportSpellings(config, ALIASES).map((v) => v.entry);
    expect(unmapped).toEqual(
      group.filter((e) => e.startsWith('**/')).map((e) => JSON.stringify(e)),
    );
  });

  it.each(RULE_IDS)('flags an internal `paths` entry under %s in every option shape', (rule) => {
    const name = '$features/agent/agent.client';
    expect(entries(block(rule, name))).toEqual([`paths entry "${name}"`]);
    expect(entries(block(rule, { name, importNames: ['agentClient'] }))).toEqual([
      `paths entry "${name}"`,
    ]);
    expect(entries(block(rule, { paths: [name] }))).toEqual([`paths entry "${name}"`]);
    expect(entries(block(rule, { paths: [{ name }] }))).toEqual([`paths entry "${name}"`]);
    expect(entries(block(rule, { paths: ['../agent.client', { name: 'electron' }] }))).toEqual([
      'paths entry "../agent.client"',
    ]);
  });

  it('flags a bare-string internal `patterns` entry', () => {
    const config = block('no-restricted-imports', {
      patterns: ['$features/agent/*', 'electron/*', { group: ['lodash/*'] }],
    });
    expect(entries(config)).toEqual(['patterns entry "$features/agent/*"']);
  });

  it.each([
    [
      'the `.ts` alias variant',
      AGENT_CLIENT.filter((entry) => entry !== '$features/agent/agent.client.ts'),
    ],
    ['every `**/` companion', AGENT_CLIENT.filter((entry) => entry.startsWith('$'))],
    ['every `$alias` companion', AGENT_CLIENT.filter((entry) => entry.startsWith('**/'))],
    ['the bare alias form', AGENT_CLIENT.slice(1)],
  ])('flags a group missing %s and names the helper call', (_label, group) => {
    const [violation, ...rest] = check(block('no-restricted-imports', { patterns: [{ group }] }));
    expect(rest).toEqual([]);
    expect(violation.block).toBe(`files [${FILES[0]}]`);
    expect(violation.entry).toContain(group[0]);
    const missing = AGENT_CLIENT.filter((entry) => !group.includes(entry));
    for (const entry of missing) expect(violation.reason).toContain(`"${entry}"`);
    expect(violation.reason).toContain(
      "internalModuleImportPatterns('$features', 'features/agent/agent.client')",
    );
    expect(formatViolation(violation)).toContain(HELPER_PATH);
  });

  it('flags a group with a spelling the helper never emits', () => {
    for (const stray of ['src/features/agent/agent.client', '../agent.client', '**/main/x']) {
      const group = [...AGENT_CLIENT, stray];
      expect(entries(block('no-restricted-imports', { patterns: [{ group }] }))).toEqual([
        JSON.stringify(stray),
      ]);
    }
  });

  it('flags a multi-module group that is not the exact union of both helper sets', () => {
    const effort = internalModuleImportPatterns('$features', 'features/agent/reasoning-effort');
    const union = [...AGENT_CLIENT, ...effort];
    expect(check(block('no-restricted-imports', { patterns: [{ group: union }] }))).toEqual([]);
    const violations = check(
      block('no-restricted-imports', { patterns: [{ group: union.slice(0, -1) }] }),
    );
    expect(violations).toHaveLength(1);
    expect(violations[0].reason).toContain(`"${effort.at(-1)}"`);
  });

  it('flags `importNames` on an internal-module group but accepts `allowImportNames`', () => {
    const named = { group: AGENT_CLIENT, importNames: ['agentClient'] };
    const violations = check(block('no-restricted-imports', { patterns: [named] }));
    expect(violations).toHaveLength(1);
    expect(violations[0].reason).toMatch(/importNames \[agentClient\]/);
    const allowed = { group: AGENT_CLIENT, allowImportNames: ['type Foo'] };
    expect(check(block('no-restricted-imports', { patterns: [allowed] }))).toEqual([]);
    const pkg = { group: ['lodash', 'lodash/*'], importNames: ['chain'] };
    expect(check(block('no-restricted-imports', { patterns: [pkg] }))).toEqual([]);
  });

  it.each([['off'], [0]])(
    'skips a rule disabled with %j even when it retains internal options',
    (severity) => {
      const options = {
        paths: ['$features/agent/agent.client'],
        patterns: [{ group: ['$lib/x'] }],
      };
      expect(check(configured('no-restricted-imports', [severity, options]))).toEqual([]);
      expect(
        check(configured('@typescript-eslint/no-restricted-imports', [severity, options])),
      ).toEqual([]);
      expect(check(configured('no-restricted-imports', severity))).toEqual([]);
    },
  );

  it.each([['warn'], [1], ['error'], [2]])('still scans a rule enabled with %j', (severity) => {
    const options = { paths: ['$features/agent/agent.client'] };
    expect(entries(configured('no-restricted-imports', [severity, options]))).toEqual([
      'paths entry "$features/agent/agent.client"',
    ]);
  });

  it('a disabled rule is no ban under ESLint, while `warn` still reports', async () => {
    const source = '$features/agent/agent.client';
    await expect(restrictedMessages(['off', { paths: [source] }], source)).resolves.toEqual([]);
    const warned = await restrictedMessages(['warn', { paths: [source] }], source);
    expect(warned.map((message) => message.severity)).toEqual([1]);
  });

  // Each negation with the import spelling it reopens (relative to the probe
  // file under src/lib/components/chat/input/).
  const NEGATIONS = [
    [
      'the negated `.ts` spelling',
      '!**/features/agent/agent.client.ts',
      '../../../../features/agent/agent.client.ts',
    ],
    ['a generic `.ts` negation', '!**/*.ts', '../../../../features/agent/agent.client.ts'],
    ['a negated alias spelling', '!$features/agent/agent.client', '$features/agent/agent.client'],
  ] as const;

  it.each(NEGATIONS)('flags a complete group followed by %s', (_label, negation) => {
    const group = [...AGENT_CLIENT, negation];
    const violations = check(block('no-restricted-imports', { patterns: [{ group }] }));
    expect(violations).toHaveLength(1);
    expect(violations[0].entry).toBe(
      `{ group: [${AGENT_CLIENT.map((e) => `"${e}"`).join(', ')}] }`,
    );
    expect(violations[0].reason).toContain(`negated entries [${negation}]`);
  });

  it('leaves a negation inside a package-only group alone', () => {
    const group = ['lodash/*', '!lodash/fp'];
    expect(check(block('no-restricted-imports', { patterns: [{ group }] }))).toEqual([]);
  });

  // A negated entry reopens an import the complete group bans, which is exactly
  // the regression the scanner must refuse.
  describe('a negation is a real bypass under ESLint', () => {
    const patterns = (group: readonly string[]) => ['error', { patterns: [{ group: [...group] }] }];

    it.each(NEGATIONS)(
      '%s (%s) reopens %s, and the scanner catches it',
      async (_label, negation, source) => {
        await expect(restrictedMessages(patterns(AGENT_CLIENT), source)).resolves.toHaveLength(1);
        const group = [...AGENT_CLIENT, negation];
        await expect(restrictedMessages(patterns(group), source)).resolves.toHaveLength(0);
        expect(check(block('no-restricted-imports', { patterns: [{ group }] }))).toHaveLength(1);
      },
    );
  });

  it('accepts package `paths`, a complete helper-built group, and `regex` entries', () => {
    const config = [
      block('no-restricted-imports', 'electron', {
        name: 'child_process',
        importNames: ['execSync'],
      }),
      block('@typescript-eslint/no-restricted-imports', {
        paths: [{ name: '@playwright/experimental-ct-svelte', allowTypeImports: true }],
        patterns: [
          { regex: '(^|/)main(/|$)', message: 'no main' },
          { group: AGENT_CLIENT, message: 'use the mutator' },
          { group: [...AGENT_CLIENT, 'electron'] },
        ],
      }),
      { files: ['**/*.svelte'], rules: { 'no-restricted-imports': 'off' } },
      { rules: { 'no-console': 'error' } },
    ];
    expect(check(...config)).toEqual([]);
  });

  it('yields zero violations for the real eslint.config.js', async () => {
    const { config, aliases } = await loadInputs();
    expect(aliases.get('$features')).toBe('features');
    expect(config.length).toBeGreaterThan(0);
    expect(checkRestrictedImportSpellings(config, aliases)).toEqual([]);
  }, 30_000);
});
