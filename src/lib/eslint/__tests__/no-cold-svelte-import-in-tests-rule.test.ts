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

  it('reports a no-substitution template-literal specifier like a string literal', async () => {
    const messages = await lintCode(`
      it('renders', async () => {
        const Foo = (await import(\`../Foo.svelte\`)).default;
        render(Foo);
      });
    `);

    expect(messages.map((message) => message.ruleId)).toEqual([RULE_ID]);
    expect(messages[0]?.message).toContain("'../Foo.svelte'");
  });

  it('reports an import in a helper returned from vi.hoisted and called from a test', async () => {
    const messages = await lintCode(`
      const { load } = vi.hoisted(() => ({ load: () => import('../Foo.svelte') }));
      it('renders', async () => { render((await load()).default); });
    `);

    expect(messages.map((message) => message.ruleId)).toEqual([RULE_ID]);
  });

  it('reports an import in a function defined inside beforeAll but invoked from a test', async () => {
    const messages = await lintCode(`
      let load;
      beforeAll(() => { load = async () => (await import('../Foo.svelte')).default; });
      it('renders', async () => { render(await load()); });
    `);

    expect(messages.map((message) => message.ruleId)).toEqual([RULE_ID]);
  });

  it('reports a vi.doMock factory import, which runs lazily where the call sits', async () => {
    const messages = await lintCode(`
      it('renders', async () => {
        vi.doMock('svelte-fa', async () => ({ default: (await import('./mocks/Fa.svelte')).default }));
        await import('../foo-service');
      });
    `);

    expect(messages.map((message) => message.ruleId)).toEqual([RULE_ID]);
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

  it('allows dynamic .svelte imports directly inside vi.mock and vi.hoisted callbacks', async () => {
    const messages = await lintCode(`
      vi.mock('$lib/components/ui/Header.svelte', async () => ({
        default: (await import('./mocks/MockSimple.svelte')).default,
      }));
      const { MockFa } = await vi.hoisted(async () => ({
        MockFa: (await import('./mocks/Fa.svelte')).default,
      }));
    `);

    expect(messages).toHaveLength(0);
  });

  it('allows a cold helper import when warmImport warms the same specifier', async () => {
    const messages = await lintCode(`
      warmImport(() => import('./mocks/SlotOnly.svelte'));
      async function slotOnly() {
        return { default: (await import('./mocks/SlotOnly.svelte')).default };
      }
      vi.mock('$lib/components/settings/ProviderSelector.svelte', slotOnly);
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
