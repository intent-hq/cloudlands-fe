import { describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';
import typescriptParser from '@typescript-eslint/parser';
import svelteParser from 'svelte-eslint-parser';

import noFlushSyncInTeardownRule from '../../../../eslint-rules/no-flushsync-in-teardown.js';

const RULE_ID = 'intent/no-flushsync-in-teardown';

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
          intent: { rules: { 'no-flushsync-in-teardown': noFlushSyncInTeardownRule } },
        },
        rules: { [RULE_ID]: 'error' },
      },
    ],
  });

  const [result] = await eslint.lintText(code, { filePath: 'Component.svelte' });
  return result.messages;
}

function component(script: string, markup = '') {
  return `<script lang="ts">\n${script}\n</script>\n${markup}\n`;
}

describe('no-flushsync-in-teardown ESLint rule', () => {
  it('reports flushSync called directly from an $effect cleanup', async () => {
    const messages = await lintSvelte(
      component(`
        import { flushSync } from 'svelte';
        let tracking = $state(false);
        $effect(() => {
          tracking = true;
          return () => {
            tracking = false;
            flushSync();
          };
        });
      `),
    );

    expect(messages.map((message) => [message.ruleId, message.line])).toEqual([[RULE_ID, 9]]);
    expect(messages[0]?.message).toContain('$effect');
    expect(messages[0]?.message).toContain('effect_in_teardown');
  });

  it('reports flushSync from an $effect.pre cleanup and from an arrow-body cleanup', async () => {
    const messages = await lintSvelte(
      component(`
        import { flushSync } from 'svelte';
        $effect.pre(() => {
          return () => flushSync();
        });
        $effect(() => () => flushSync());
      `),
    );

    expect(messages.map((message) => message.line)).toEqual([5, 7]);
  });

  it('reports flushSync reached through a same-file helper (pre-fix WorkspaceTabStrip pattern)', async () => {
    const messages = await lintSvelte(
      component(`
        import { flushSync } from 'svelte';
        let { onActiveTabTrackingChange } = $props();
        let layoutTracking = false;
        function reportActiveTabTracking() {
          flushSync(() => onActiveTabTrackingChange?.(layoutTracking));
        }
        $effect(() => {
          layoutTracking = true;
          reportActiveTabTracking();
          return () => {
            layoutTracking = false;
            reportActiveTabTracking();
          };
        });
      `),
    );

    expect(messages.map((message) => message.line)).toEqual([14]);
    expect(messages[0]?.message).toContain('reportActiveTabTracking() (which calls flushSync)');
  });

  it('reports flushSync inside the destroy() of an action used with use:', async () => {
    const messages = await lintSvelte(
      component(
        `
        import { flushSync } from 'svelte';
        let { onBoundsChange } = $props();
        const emitBounds = (bounds: DOMRect | null) => flushSync(() => onBoundsChange?.(bounds));
        function reportBounds(node: HTMLElement, isActive: boolean) {
          let active = isActive;
          const measure = () => emitBounds(node.getBoundingClientRect());
          measure();
          return {
            update(next: boolean) {
              active = next;
              measure();
            },
            destroy() {
              if (active) emitBounds(null);
            },
          };
        }
      `,
        '<div use:reportBounds={true}></div>',
      ),
    );

    expect(messages.map((message) => message.line)).toEqual([16]);
    expect(messages[0]?.message).toContain('use:reportBounds');
  });

  it('reports flushSync inside an onDestroy callback', async () => {
    const messages = await lintSvelte(
      component(`
        import { flushSync, onDestroy } from 'svelte';
        onDestroy(() => {
          flushSync();
        });
      `),
    );

    expect(messages.map((message) => message.line)).toEqual([5]);
    expect(messages[0]?.message).toContain('onDestroy');
  });

  it('reports an aliased flushSync import inside an onMount cleanup', async () => {
    const messages = await lintSvelte(
      component(`
        import { flushSync as flush, onMount } from 'svelte';
        onMount(() => {
          return () => {
            flush();
          };
        });
      `),
    );

    expect(messages.map((message) => message.line)).toEqual([6]);
    expect(messages[0]?.message).toContain('onMount');
  });

  it('allows flushSync in the $effect body, event handlers, and action update()', async () => {
    const messages = await lintSvelte(
      component(
        `
        import { flushSync } from 'svelte';
        let { onChange } = $props();
        let dragged = $state<string | null>(null);
        const emit = (value: string | null) => flushSync(() => onChange?.(value));
        $effect(() => {
          emit(dragged);
          flushSync();
          return () => {
            dragged = null;
          };
        });
        function handlePointerDown(id: string) {
          flushSync(() => (dragged = id));
        }
        function track(node: HTMLElement, value: string) {
          emit(value);
          return {
            update(next: string) {
              emit(next);
            },
            destroy() {
              node.remove();
            },
          };
        }
      `,
        '<div use:track={"a"} onpointerdown={() => handlePointerDown("a")}></div>',
      ),
    );

    expect(messages).toHaveLength(0);
  });

  it('allows a helper whose flush is opted out by a caller-controlled parameter (#2248 fix pattern)', async () => {
    const messages = await lintSvelte(
      component(
        `
        import { flushSync } from 'svelte';
        let { onTrackingChange, onBoundsChange } = $props();
        let layoutTracking = false;
        const run = (sync: boolean, fn: () => void) => (sync ? flushSync(fn) : fn());
        const reportTracking = ({ sync = true } = {}) =>
          run(sync, () => onTrackingChange?.(layoutTracking));
        const emitBounds = (bounds: DOMRect | null, { sync = true } = {}) =>
          run(sync, () => onBoundsChange?.(bounds));
        $effect(() => {
          layoutTracking = true;
          reportTracking();
          return () => {
            layoutTracking = false;
            reportTracking({ sync: false });
          };
        });
        function reportBounds(node: HTMLElement) {
          return {
            destroy() {
              emitBounds(null, { sync: false });
            },
          };
        }
      `,
        '<div use:reportBounds></div>',
      ),
    );

    expect(messages).toHaveLength(0);
  });

  it('still follows a helper whose flush is guarded only by component state', async () => {
    const messages = await lintSvelte(
      component(`
        import { flushSync } from 'svelte';
        let { onChange } = $props();
        let enabled = $state(true);
        function report() {
          if (enabled) flushSync(() => onChange?.());
        }
        $effect(() => {
          return () => report();
        });
      `),
    );

    expect(messages.map((message) => message.line)).toEqual([10]);
  });

  it('allows a helper that only flushes asynchronously to run from a cleanup', async () => {
    const messages = await lintSvelte(
      component(`
        import { flushSync } from 'svelte';
        function flushLater() {
          requestAnimationFrame(() => flushSync());
        }
        $effect(() => {
          return () => flushLater();
        });
      `),
    );

    expect(messages).toHaveLength(0);
  });

  it('ignores a destroy() method on an object that is not returned by a use: action', async () => {
    const messages = await lintSvelte(
      component(`
        import { flushSync } from 'svelte';
        function createController() {
          return {
            destroy() {
              flushSync();
            },
          };
        }
        const controller = createController();
      `),
    );

    expect(messages).toHaveLength(0);
  });

  it('ignores a locally defined flushSync that is not the svelte export', async () => {
    const messages = await lintSvelte(
      component(`
        const flushSync = () => {};
        $effect(() => {
          return () => flushSync();
        });
      `),
    );

    expect(messages).toHaveLength(0);
  });
});
