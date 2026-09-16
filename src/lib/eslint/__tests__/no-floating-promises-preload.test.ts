// @vitest-environment node
// @verify-changed-triggers: eslint.config.js, tsconfig.preload.json, tsconfig.preload.lint.json, src/preload/index.template.ts
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';
import ts from 'typescript';

const RULE_ID = '@typescript-eslint/no-floating-promises';
const LINT_PROJECT = 'tsconfig.preload.lint.json';

// The shipped src/preload/index.ts is generated and gitignored, so the tracked
// template is the only preload implementation `pnpm run lint` can see. Assert
// the effective config the real eslint.config.js (vitest runs from the package
// root) resolves for that path, without linting it: under CI=true
// typescript-eslint infers "single run" mode and builds its Program from disk,
// so a `lintText` probe whose content differs from the on-disk template is typed
// against the disk file and cannot report the rule (deterministic CI failure).
// The rule firing on disk is proven by the CLI probe recorded in the PR.
const PRELOAD_TEMPLATE = 'src/preload/index.template.ts';

const eslint = new ESLint({ cwd: process.cwd() });

function parserProjects(config: Awaited<ReturnType<ESLint['calculateConfigForFile']>>) {
  const project = config?.languageOptions?.parserOptions?.project;
  return Array.isArray(project) ? project : [project];
}

describe('no-floating-promises on the preload template under the real eslint.config.js', () => {
  it('does not ignore the tracked template', async () => {
    expect(existsSync(PRELOAD_TEMPLATE)).toBe(true);
    await expect(eslint.isPathIgnored(PRELOAD_TEMPLATE)).resolves.toBe(false);
  });

  it('type-lints the template through the lint-only preload project', async () => {
    const config = await eslint.calculateConfigForFile(PRELOAD_TEMPLATE);
    const projects = parserProjects(config).map((entry) => String(entry).replace(/^\.\//, ''));
    expect(projects).toContain(LINT_PROJECT);
    expect(config.languageOptions?.parserOptions?.tsconfigRootDir).toBe(process.cwd());
    expect(config.rules?.[RULE_ID]?.[0]).toBe(2);
  });

  it('resolves the template as a root file of the lint-only project without emitting', () => {
    const configPath = resolve(process.cwd(), LINT_PROJECT);
    const { config, error } = ts.readConfigFile(configPath, ts.sys.readFile);
    expect(error).toBeUndefined();
    const parsed = ts.parseJsonConfigFileContent(
      config,
      ts.sys,
      process.cwd(),
      undefined,
      configPath,
    );
    expect(parsed.errors.map((diagnostic) => diagnostic.messageText)).toEqual([]);
    expect(parsed.fileNames).toContain(resolve(process.cwd(), PRELOAD_TEMPLATE));
    expect(parsed.options.noEmit).toBe(true);
  });
});
