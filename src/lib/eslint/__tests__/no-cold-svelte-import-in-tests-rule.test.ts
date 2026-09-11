import { describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';
import typescriptParser from '@typescript-eslint/parser';

import noColdSvelteImportInTestsRule from '../../../../eslint-rules/no-cold-svelte-import-in-tests.js';

const RULE_ID = 'intent/no-cold-svelte-import-in-tests';

async function lintCode(code: string, filePath = 'src/features/example/__tests__/example.test.ts') {
  const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: ['**/*.ts'],
        languageOptions: {
          parser: typescriptParser as any,
          parserOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
          },
        },
      },
      {
        files: ['**/*.{test,spec}.{js,ts}'],
        plugins: {
          intent: {
            rules: {
              'no-cold-svelte-import-in-tests': noColdSvelteImportInTestsRule,
            },
          },
        },
        rules: {
          [RULE_ID]: 'error',
        },
      },
    ],
  });

  const [result] = await eslint.lintText(code, { filePath, warnIgnored: false });
  return result?.messages ?? [];
}

const IN_TEST_IMPORT = `
  describe('Foo', () => {
    it('renders', async () => {
      const Foo = (await import('../Foo.svelte')).default;
      render(Foo);
    });
  });
`;

describe('no-cold-svelte-import-in-tests ESLint rule', () => {
  it('reports a dynamic .svelte import inside a test body with no warm-up', async () => {
    const messages = await lintCode(IN_TEST_IMPORT);

    expect(messages.map((message) => message.ruleId)).toEqual([RULE_ID]);
    expect(messages[0]?.message).toContain("'../Foo.svelte'");
    expect(messages[0]?.message).toContain('warmImport');
  });

  it('reports a dynamic .svelte import inside a module-scope render helper', async () => {
    const messages = await lintCode(`
      async function renderFoo() {
        const Foo = (await import('../Foo.svelte')).default;
        return render(Foo);
      }
      it('renders', async () => { await renderFoo(); });
    `);

    expect(messages.map((message) => message.ruleId)).toEqual([RULE_ID]);
  });

  it('reports a dynamic .svelte import inside beforeEach', async () => {
    const messages = await lintCode(`
      beforeEach(async () => { await import('../Foo.svelte'); });
      ${IN_TEST_IMPORT}
    `);

    expect(messages).toHaveLength(2);
    expect(messages.every((message) => message.ruleId === RULE_ID)).toBe(true);
  });

  it('reports when warmImport warms a different specifier than the test imports', async () => {
    const messages = await lintCode(`
      warmImport(() => import('../Bar.svelte'));
      ${IN_TEST_IMPORT}
    `);

    expect(messages.map((message) => message.ruleId)).toEqual([RULE_ID]);
  });

  it('allows in-test imports of a specifier warmed by warmImport', async () => {
    const messages = await lintCode(`
      warmImport(() => import('../Foo.svelte'));
      ${IN_TEST_IMPORT}
    `);

    expect(messages).toHaveLength(0);
  });

  it('allows in-test imports of a specifier warmed in beforeAll', async () => {
    const messages = await lintCode(`
      beforeAll(async () => { await import('../Foo.svelte'); });
      ${IN_TEST_IMPORT}
    `);

    expect(messages).toHaveLength(0);
  });

  it('allows in-test imports of a specifier imported statically', async () => {
    const messages = await lintCode(`
      import Foo from '../Foo.svelte';
      ${IN_TEST_IMPORT}
    `);

    expect(messages).toHaveLength(0);
  });

  it('allows in-test imports of a specifier preloaded at module scope', async () => {
    const messages = await lintCode(`
      const FooPreloaded = (await import('../Foo.svelte')).default;
      ${IN_TEST_IMPORT}
    `);

    expect(messages).toHaveLength(0);
  });

  it('allows dynamic .svelte imports inside vi.mock factories', async () => {
    const messages = await lintCode(`
      vi.mock('$lib/components/ui/Header.svelte', async () => ({
        default: (await import('./mocks/MockSimple.svelte')).default,
      }));
      vi.doMock('svelte-fa', async () => {
        const MockFa = (await import('./mocks/Fa.svelte')).default;
        return { default: MockFa };
      });
    `);

    expect(messages).toHaveLength(0);
  });

  it('ignores dynamic imports of non-.svelte modules inside tests', async () => {
    const messages = await lintCode(`
      it('loads', async () => {
        const mod = await import('../foo-service');
        expect(mod).toBeDefined();
      });
    `);

    expect(messages).toHaveLength(0);
  });

  it('does not apply to production source files', async () => {
    const messages = await lintCode(IN_TEST_IMPORT, 'src/features/example/example.ts');

    expect(messages).toHaveLength(0);
  });
});
