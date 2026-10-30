// @vitest-environment node
import path from 'node:path';
import { RuleTester } from 'eslint';
import svelteParser from 'svelte-eslint-parser';
import typescriptParser from '@typescript-eslint/parser';
import { describe, expect, it } from 'vitest';
import rule from './no-raw-workspace-navigation.js';

const tsFile = path.resolve('src/features/probe/probe-navigation.ts');
const svelteFile = path.resolve('src/features/probe/ProbeLink.svelte');

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    parser: typescriptParser,
  },
});

const svelte = (script) => ({
  code: `<script lang="ts">\n${script}\n</script>\n<div></div>\n`,
  filename: svelteFile,
  languageOptions: { parser: svelteParser, parserOptions: { parser: typescriptParser } },
});

const error = (navigator, line = 1) => ({
  messageId: 'rawWorkspaceNavigation',
  data: { navigator },
  line,
});

describe('no-raw-workspace-navigation guidance', () => {
  it('names the helper and the incident', () => {
    const message = rule.meta.messages.rawWorkspaceNavigation;
    expect(message).toContain('openAndShowWorkspace');
    expect(message).toContain('showWorkspaceSaga');
    expect(message).toContain('$lib/utils/show-workspace');
    expect(message).toContain('cloudlands-fe#3850');
  });

  it('takes no options', () => {
    expect(rule.meta.schema).toEqual([]);
  });
});

tester.run('no-raw-workspace-navigation', rule, {
  valid: [
    { code: 'await openAndShowWorkspace(id);', filename: tsFile },
    { code: "await goto('/workspace/new');", filename: tsFile },
    { code: 'await goto(`/workspace/new`);', filename: tsFile },
    { code: 'await goto(`/settings/${section}`);', filename: tsFile },
    { code: "await navigateToRoute('/');", filename: tsFile },
    { code: 'await goto(target);', filename: tsFile },
    { code: 'await goto(url.toString(), { replaceState: true });', filename: tsFile },
    { code: "await goto(isNew ? '/workspace/new' : '/');", filename: tsFile },
    { code: 'void navigate(`/workspace/${id}`);', filename: tsFile },
    { code: 'invoke(OPEN_NEW, { route: `/workspace/${id}` });', filename: tsFile },
    { code: 'yield* call(openWorkspace, `/workspace/${id}`);', filename: tsFile },
    svelte("  const open = () => goto('/workspace/new');"),
  ],
  invalid: [
    { code: 'await goto(`/workspace/${id}`);', filename: tsFile, errors: [error('goto')] },
    {
      code: 'void navigateToRoute(`/workspace/${encodeURIComponent(id)}?panel=terminal`);',
      filename: tsFile,
      errors: [error('navigateToRoute')],
    },
    {
      code: "onClick: () => navigateToRoute('/workspace/' + data.workspaceId);",
      filename: tsFile,
      errors: [error('navigateToRoute')],
    },
    {
      code: "await goto('/workspace/' + id + '?note=' + noteId);",
      filename: tsFile,
      errors: [error('goto')],
    },
    {
      code: 'void goto(next ? `/workspace/${next}` : fallback);',
      filename: tsFile,
      errors: [error('goto')],
    },
    {
      code: 'await goto(`/workspace/${id}` as string, { state });',
      filename: tsFile,
      errors: [error('goto')],
    },
    {
      code: 'function* s() { yield* call(navigateToRoute, `/workspace/${id}`); }',
      filename: tsFile,
      errors: [error('navigateToRoute')],
    },
    {
      code: 'function* s() { yield call(goto, `/workspace/${id}`, { state }); }',
      filename: tsFile,
      errors: [error('goto')],
    },
    {
      ...svelte('  async function open(id: string) {\n    await goto(`/workspace/${id}`);\n  }'),
      errors: [error('goto', 3)],
    },
  ],
});
