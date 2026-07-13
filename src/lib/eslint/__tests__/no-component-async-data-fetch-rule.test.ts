import {
  describe,
  expect,
  it,
} from 'vitest';
import { ESLint } from 'eslint';
import typescriptParser from '@typescript-eslint/parser';
import svelteParser from 'svelte-eslint-parser';

import noComponentAsyncDataFetchRule from '../../../../eslint-rules/no-component-async-data-fetch.js';

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
              'no-component-async-data-fetch': noComponentAsyncDataFetchRule,
            },
          },
        },
        rules: {
          'intent/no-component-async-data-fetch': 'error',
        },
      },
    ],
  });

  const [result] = await eslint.lintText(code, { filePath: 'Component.svelte' });
  return result.messages;
}

describe('no-component-async-data-fetch ESLint rule', () => {
  it('allows Redux dispatch and selector reads from component code', async () => {
    const messages = await lintSvelte(`
      <script lang="ts">
        import {
  onMount,
  tick,
} from 'svelte';
        import { loadWebSocketApiStatus } from '$store/renderer/slices/websocket-api/websocket-api-slice';
        import { selectWebSocketApiEnabled } from '$store/renderer/slices/websocket-api/websocket-api-selectors';
        import { store as appStore } from '$store/renderer/store';

        const enabled$ = selectWebSocketApiEnabled();

        onMount(() => {
          appStore.dispatch(loadWebSocketApiStatus());
        });
      </script>
    `);

    expect(messages).toHaveLength(0);
  });

  it('allows component-local DOM and visual async work', async () => {
    const messages = await lintSvelte(`
      <script lang="ts">


        async function focusInput() {
          await tick();
          await new Promise((resolve) => requestAnimationFrame(resolve));
          await onSearch('local option');
        }
      </script>
    `);

    expect(messages).toHaveLength(0);
  });

  it('allows safe UI-only helper async work', async () => {
    const messages = await lintSvelte(`
      <script lang="ts">
        import { animateSelection } from './animation-helpers';

        async function focusInput() {
          await animateSelection();
        }
      </script>
    `);

    expect(messages).toHaveLength(0);
  });

  it('reports direct fetch calls in lifecycle and effect callbacks', async () => {
    const messages = await lintSvelte(`
      <script lang="ts">


        onMount(async () => {
          const response = await fetch('/api/things');
        });

        $effect(() => {
          window.fetch('/api/other');
        });
      </script>
    `);

    expect(messages.map((message) => message.ruleId)).toEqual([
      'intent/no-component-async-data-fetch',
      'intent/no-component-async-data-fetch',
    ]);
  });

  it('reports awaited API, client, provider, and IPC calls', async () => {
    const messages = await lintSvelte(`
      <script lang="ts">

        import { workspaceApi } from '$lib/api/workspace-api';
        import { issueClient } from '$lib/clients/issue-client';
        import { invoke } from '$shared/generated/ipc-client';

        onMount(async () => {
          const workspace = await workspaceApi.get('workspace-id');
          const issues = await issueClient.list('workspace-id');
          const settings = await invoke('settings:get', {});
        });
      </script>
    `);

    expect(messages).toHaveLength(3);
    expect(messages[0]?.message).toContain('store.dispatch(action)');
  });

  it('reports async loader functions that populate component-local state', async () => {
    const messages = await lintSvelte(`
      <script lang="ts">
        import { loadWorkspaceNotes } from '$lib/services/workspace-notes-service';

        let notes = [];

        async function loadNotes() {
          notes = await loadWorkspaceNotes('workspace-id');
        }
      </script>
    `);

    expect(messages).toHaveLength(1);
    expect(messages[0]?.message).toContain('sagas or service layers');
  });

  it('reports imported domain loaders in promise chains and fire-and-forget calls', async () => {
    const messages = await lintSvelte(`
      <script lang="ts">
        import { onMount } from 'svelte';
        import { loadWorkspaceNotes } from '$lib/services/workspace-notes-service';
        import { workspaceApi } from '$lib/api/workspace-api';

        onMount(() => {
          loadWorkspaceNotes('workspace-id').then((notes) => console.log(notes));
          void workspaceApi.get('workspace-id');
        });
      </script>
    `);

    expect(messages).toHaveLength(2);
    expect(messages.every((message) => message.ruleId === 'intent/no-component-async-data-fetch')).toBe(true);
  });

  it('reports local command/helper wrapper bypasses around IPC work', async () => {
    const messages = await lintSvelte(`
      <script lang="ts">
        import { chooseParentFolder } from '$features/onboarding/utils/choose-parent-folder';
        import { applyPrimitivePatch } from './patch-block-commands';
        import {
  resolveRtkAvailability,
  persistRtkEnabled,
} from './rtk-settings-commands';

        async function runHelpers(workspaceId, patch) {
          await chooseParentFolder();
          await applyPrimitivePatch(workspaceId, patch);
          resolveRtkAvailability();
          persistRtkEnabled(true);
        }
      </script>
    `);

    expect(messages).toHaveLength(4);
    expect(messages.every((message) => message.ruleId === 'intent/no-component-async-data-fetch')).toBe(true);
  });

  it('ignores module script setup code outside component instances', async () => {
    const messages = await lintSvelte(`
      <script context="module" lang="ts">
        export async function loadMetadata() {
          return await fetch('/metadata.json');
        }
      </script>
    `);

    expect(messages).toHaveLength(0);
  });

  it('ignores Svelte 5 boolean module scripts outside component instances', async () => {
    const messages = await lintSvelte(`
      <script module lang="ts">


        export async function loadMetadata() {
          return await workspaceApi.get('workspace-id');
        }
      </script>
    `);

    expect(messages).toHaveLength(0);
  });
});