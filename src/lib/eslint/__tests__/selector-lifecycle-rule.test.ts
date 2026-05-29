import {
  describe,
  expect,
  it,
} from 'vitest';
import { ESLint } from 'eslint';
import typescriptParser from '@typescript-eslint/parser';
import svelteParser from 'svelte-eslint-parser';

import selectorLifecycleRule from '../../../../eslint-rules/selector-lifecycle.js';

async function lintSvelte(code: string) {
  const eslint = new ESLint({
    ignore: false,
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: ['**/*.svelte'],
        languageOptions: {
          parser: svelteParser as any,
          parserOptions: {
            parser: typescriptParser as any,
            ecmaVersion: 2022,
            sourceType: 'module',
          },
        },
        plugins: {
          intent: {
            rules: {
              'selector-lifecycle': selectorLifecycleRule,
            },
          },
        },
        rules: {
          'intent/selector-lifecycle': 'warn',
        },
      },
    ],
  });

  const [result] = await eslint.lintText(code, { filePath: 'Component.svelte' });
  return result.messages;
}

describe('selector-lifecycle ESLint rule', () => {
  it('allows top-level selector initialization and Store-first dispatch', async () => {
    const messages = await lintSvelte(`
      <script lang="ts">
        import { selectThing } from '$lib/store/slices/example/example-selectors';
        import { saveThing } from '$lib/store/slices/example/example-slice';
        import { store as appStore } from '$lib/store/store';

        const thing = selectThing();

        function handleClick() {
          const currentThing = selectThing.select(appStore.state);
          if (currentThing) {
            appStore.dispatch(saveThing(currentThing.id));
          }
        }
      </script>
    `);

    expect(messages).toHaveLength(0);
  });

  it('warns on nested selector calls', async () => {
    const messages = await lintSvelte(`
      <script lang="ts">
        import { selectThing } from '$lib/store/slices/example/example-selectors';

        function handleClick() {
          const thing = selectThing();
        }
      </script>
    `);

    expect(messages.map((message) => message.ruleId)).toEqual(['intent/selector-lifecycle']);
    expect(messages[0]?.message).toContain('selector.select(store.state, ...)');
  });

  it('warns on top-level module-script selector initialization', async () => {
    const messages = await lintSvelte(`
      <script context="module" lang="ts">
        import { selectThing } from '$lib/store/slices/example/example-selectors';

        const thing = selectThing();
      </script>
    `);

    expect(messages.map((message) => message.ruleId)).toEqual(['intent/selector-lifecycle']);
  });

  it('warns on get(selectThing()) but not on get(nonSelectorStore)', async () => {
    const messages = await lintSvelte(`
      <script lang="ts">
        import {
  get,
  writable,
} from 'svelte/store';
        import { selectThing } from '$lib/store/slices/example/example-selectors';

        const plainStore = writable(1);
        const a = get(selectThing());
        const b = get(plainStore);
      </script>
    `);

    expect(messages).toHaveLength(1);
    expect(messages[0]?.message).toContain('Do not wrap selector readables with svelte/store get()');
    expect(messages[0]?.message).toContain('selector.select(store.state, ...)');
  });

  it('only warns on get(...) for wrapped selector calls in restricted contexts', async () => {
    const messages = await lintSvelte(`
      <script lang="ts">
        import { get } from 'svelte/store';
        import { selectThing } from '$lib/store/slices/example/example-selectors';

        function handleClick() {
          const thing = get((selectThing()));
        }
      </script>
    `);

    expect(messages).toHaveLength(1);
    expect(messages[0]?.message).toContain('Do not wrap selector readables with svelte/store get()');
  });

  it('warns for callback-style props like onClose', async () => {
    const messages = await lintSvelte(`
      <script lang="ts">
        import { selectThing } from '$lib/store/slices/example/example-selectors';
      </script>

      <Dialog onClose={selectThing()} />
    `);

    expect(messages).toHaveLength(1);
    expect(messages[0]?.message).toContain('must be created during component initialization');
  });

  it('does not warn for non-callback props like onboarding', async () => {
    const messages = await lintSvelte(`
      <script lang="ts">
        import { selectThing } from '$lib/store/slices/example/example-selectors';
      </script>

      <Dialog onboarding={selectThing()} />
    `);

    expect(messages).toHaveLength(0);
  });

  it('warns on redundant readable aliases created with $derived($readable$)', async () => {
    const messages = await lintSvelte(`
      <script lang="ts">
        const agentSessionIsStreaming$ = selectAgentSessionIsStreaming();
        const isStreaming = $derived($agentSessionIsStreaming$);
      </script>
    `);

    expect(messages).toHaveLength(1);
    expect(messages[0]?.message).toContain('Do not mirror readable values with $derived($readable$)');
  });

  it('allows computed derived expressions and $derived.by callbacks', async () => {
    const messages = await lintSvelte(`
      <script lang="ts">
        const agentSessionIsStreaming$ = selectAgentSessionIsStreaming();
        const hasPendingWork$ = selectHasPendingWork();
        const isBusy = $derived($agentSessionIsStreaming$ || $hasPendingWork$);
        const status = $derived.by(() => $agentSessionIsStreaming$ ? 'streaming' : 'idle');
      </script>
    `);

    expect(messages).toHaveLength(0);
  });
});