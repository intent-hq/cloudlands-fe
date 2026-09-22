// @vitest-environment node
// @verify-changed-triggers: eslint.config.js, eslint-rules/internal-module-import-patterns.js, svelte.config.js

import { describe, expect, it } from 'vitest';
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

const block = (rule: string, ...options: unknown[]) => ({
  files: FILES,
  rules: { [rule]: ['error', ...options] },
});
const check = (...blocks: unknown[]) => checkRestrictedImportSpellings(blocks, ALIASES);
const entries = (...blocks: unknown[]) => check(...blocks).map((violation) => violation.entry);

describe('restricted-import spellings guard', () => {
  it.each([
    ['$features/agent/agent.client', true],
    ['./agent.client', true],
    ['../../features/agent/agent.client.ts', true],
    ['/src/features/agent/agent.client', true],
    ['src/features/agent/agent.client', true],
    ['**/features/agent/agent.client', true],
    ['electron', false],
    ['child_process', false],
    ['@playwright/experimental-ct-svelte', false],
    ['node:fs', false],
  ])('classifies %s as internal=%s', (source, internal) => {
    expect(isInternalSource(source)).toBe(internal);
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
    expect(checkRestrictedImportSpellings(config, ALIASES)).toHaveLength(group.length);
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
    for (const stray of [
      'src/features/agent/agent.client',
      '../agent.client',
      '$unknown/x',
      '**/main/x',
    ]) {
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
