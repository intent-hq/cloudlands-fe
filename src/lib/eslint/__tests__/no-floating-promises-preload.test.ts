// @vitest-environment node
// @verify-changed-triggers: eslint.config.js, tsconfig.preload.json, tsconfig.preload.lint.json, src/preload/index.template.ts
import { describe, expect, it } from 'vitest';
import { ESLint, type Linter } from 'eslint';

const RULE_ID = '@typescript-eslint/no-floating-promises';

// The shipped src/preload/index.ts is generated and gitignored, so the tracked
// template is the only preload implementation `pnpm run lint` can see. Lint it
// through the real eslint.config.js (vitest runs from the package root) so the
// type-aware block is proven against the actual preload path, not a stub.
const PRELOAD_TEMPLATE = 'src/preload/index.template.ts';

const eslint = new ESLint({ cwd: process.cwd() });

async function floatingPromiseMessages(code: string): Promise<Linter.LintMessage[]> {
  const [result] = await eslint.lintText(code, { filePath: PRELOAD_TEMPLATE });
  const fatal = result.messages.filter((message) => message.fatal);
  expect(fatal, 'the preload template must be inside a TS project').toEqual([]);
  return result.messages.filter((message) => message.ruleId === RULE_ID);
}

describe('no-floating-promises on the preload template under the real eslint.config.js', () => {
  it('reports an unawaited promise expression statement', async () => {
    const messages = await floatingPromiseMessages('export const p = 1;\nPromise.resolve();\n');
    expect(messages.map((message) => [message.line, message.severity])).toEqual([[2, 2]]);
  }, 60_000);

  it('accepts awaited and caught promises', async () => {
    const messages = await floatingPromiseMessages(
      [
        'export async function run(): Promise<void> {',
        '  await Promise.resolve();',
        '}',
        'Promise.resolve().catch(() => undefined);',
        '',
      ].join('\n'),
    );
    expect(messages).toEqual([]);
  }, 60_000);
});
