import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';
import typescriptParser from '@typescript-eslint/parser';
import svelteParser from 'svelte-eslint-parser';

import noComponentAsyncDataFetchRule from '../../../../eslint-rules/no-component-async-data-fetch.js';

const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Lints a component that sits next to real modules on disk, so the rule can
 * inspect what each relative import actually contains.
 */
async function lintSvelteWithModules(
  code: string,
  modules: Record<string, string>,
  componentPath = 'Component.svelte',
) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'no-component-async-data-fetch-'));
  fixtureDirs.push(dir);
  for (const [relativePath, source] of Object.entries(modules)) {
    const filePath = path.join(dir, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, source);
  }
  return lintSvelte(code, { cwd: dir, filePath: path.join(dir, componentPath) });
}

async function lintSvelte(
  code: string,
  { cwd, filePath = 'Component.svelte' }: { cwd?: string; filePath?: string } = {},
) {
  const eslint = new ESLint({
    ...(cwd ? { cwd } : {}),
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

  const [result] = await eslint.lintText(code, { filePath });
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
    expect(
      messages.every((message) => message.ruleId === 'intent/no-component-async-data-fetch'),
    ).toBe(true);
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
    expect(
      messages.every((message) => message.ruleId === 'intent/no-component-async-data-fetch'),
    ).toBe(true);
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

  describe('local modules classified by content rather than file name', () => {
    const sidebarRepositoryDefault = `
      export interface SidebarRepository {
        id: string;
        lastUsedAt: number;
      }

      export function sidebarRepositorySelection(
        repositories: SidebarRepository[],
        selectedId: string | null,
      ): string | null {
        if (selectedId && repositories.some((repository) => repository.id === selectedId)) {
          return selectedId;
        }
        const [latest] = [...repositories].sort((a, b) => b.lastUsedAt - a.lastUsedAt);
        return latest?.id ?? null;
      }
    `;

    const workspaceRepository = `
      export async function loadWorkspaces() {
        const response = await fetch('/api/workspaces');
        return response.json();
      }

      export function workspaceCount(workspaces: unknown[]) {
        return workspaces.length;
      }
    `;

    it('allows a pure helper from a "repository"-named module in a click handler', async () => {
      const messages = await lintSvelteWithModules(
        `
          <script lang="ts">
            import { store as appStore } from '$store/renderer/store';
            import { sidebarRepositorySelection } from './initializer/sidebar-repository-default';

            let { repositories, selectedId } = $props();

            function createWorkspace() {
              const repositoryId = sidebarRepositorySelection(repositories, selectedId);
              appStore.dispatch({ type: 'workspace/createRequested', payload: { repositoryId } });
            }
          </script>

          <button onclick={() => createWorkspace()}>New workspace</button>
          <button on:click={() => sidebarRepositorySelection(repositories, null)}>Reset</button>
        `,
        { 'initializer/sidebar-repository-default.ts': sidebarRepositoryDefault },
      );

      expect(messages).toEqual([]);
    });

    it('allows pure helpers whose own imports are pure "repository"/"provider" modules', async () => {
      const messages = await lintSvelteWithModules(
        `
          <script lang="ts">
            import { providerLabel } from './utils/provider-label';

            let { repository } = $props();
            const label = $derived(providerLabel(repository));
          </script>

          <span>{label}</span>
        `,
        {
          'utils/provider-label.ts': `
            import { repositoryTargetKey } from '../types/repository-context';
            import type { Remote } from '../api/remote-client';
            // An old version fetched this; it is computed locally now.

            export const providerLabel = (repository: { host: string; name: string }) =>
              repositoryTargetKey(repository).toUpperCase();
          `,
          'types/repository-context.ts': `
            export function repositoryTargetKey(target: { host: string; name: string }) {
              return target.host + '/' + target.name;
            }
          `,
        },
      );

      expect(messages).toEqual([]);
    });

    it('allows real pure helpers from domain-named modules in the app', async () => {
      const messages = await lintSvelte(`
        <script lang="ts">
          import { prRepositoryOptions } from '$features/accept-changes/utils/pr-repository-options';
          import { isOnboardingProviderVisible } from '$features/onboarding/utils/is-onboarding-provider-visible';

          let { context, provider } = $props();

          function choose() {
            const options = prRepositoryOptions(context);
            const visible = isOnboardingProviderVisible({ provider, isFeatureEnabled: () => true });
            return { options, visible };
          }
        </script>

        <button onclick={choose}>Choose</button>
      `);

      expect(messages).toEqual([]);
    });

    it('still reports calls into a local repository module that fetches', async () => {
      const messages = await lintSvelteWithModules(
        `
          <script lang="ts">
            import { loadWorkspaces, workspaceCount } from './workspace-repository';

            function refresh() {
              loadWorkspaces();
              return workspaceCount([]);
            }
          </script>

          <button onclick={refresh}>Refresh</button>
        `,
        { 'workspace-repository.ts': workspaceRepository },
      );

      expect(messages.map((message) => message.ruleId)).toEqual([
        'intent/no-component-async-data-fetch',
        'intent/no-component-async-data-fetch',
      ]);
    });

    it('still reports a synchronous-looking client module that re-exports a fetching one', async () => {
      const messages = await lintSvelteWithModules(
        `
          <script lang="ts">
            import { loadWorkspaces } from './issue-client';
            import { issueClientDefaults } from './issue-client-defaults';

            function refresh() {
              loadWorkspaces();
              issueClientDefaults();
            }
          </script>

          <button onclick={refresh}>Refresh</button>
        `,
        {
          'workspace-repository.ts': workspaceRepository,
          'issue-client.ts': `export { loadWorkspaces } from './workspace-repository';`,
          'issue-client-defaults.ts': `
            import { workspaceCount } from './workspace-repository';

            export function issueClientDefaults() {
              return { count: workspaceCount([]) };
            }
          `,
        },
      );

      expect(messages).toHaveLength(2);
      expect(
        messages.every((message) => message.ruleId === 'intent/no-component-async-data-fetch'),
      ).toBe(true);
    });

    it('still reports a pure-looking provider helper that imports a fetch wrapper', async () => {
      const messages = await lintSvelteWithModules(
        `
          <script lang="ts">
            import { providerStatus } from './provider-status';

            function refresh() {
              providerStatus('github');
            }
          </script>

          <button onclick={refresh}>Refresh</button>
        `,
        {
          'provider-status.ts': `
            import { getJson } from './http';

            export function providerStatus(id: string) {
              return getJson('/providers/' + id);
            }
          `,
          'http.ts': `export const getJson = (url: string) => fetch(url);`,
        },
      );

      expect(messages).toHaveLength(1);
    });

    it('still reports domain-named imports whose module cannot be resolved', async () => {
      const messages = await lintSvelteWithModules(
        `
          <script lang="ts">
            import { loadIssues } from './missing-issue-client';
            import { readRepository } from '$lib/repositories/workspace-repository';

            function refresh() {
              loadIssues();
              readRepository();
            }
          </script>

          <button onclick={refresh}>Refresh</button>
        `,
        {},
      );

      expect(messages).toHaveLength(2);
    });
  });

  describe('test transport fixtures', () => {
    const fixtureHost = `
      <script lang="ts">
        import { onDestroy } from 'svelte';
        import {
          emitMockIpcEvent,
          overrideMockIpcHandler,
          registerMockIpcHandler,
          unregisterMockIpcHandler,
        } from '$shared/ipc-mock-router';
        import {
          createMockBridgeListeners,
          installMockElectronBridge,
        } from '../../../test/ct-mock-electron-bridge';

        const { detachAll } = createMockBridgeListeners();
        installMockElectronBridge({ 'agent.get': () => ({ id: 'a' }) });
        registerMockIpcHandler('codex:get-models', () => ({ success: true, data: [] }));
        const restore = overrideMockIpcHandler('shell:openExternal', () => undefined);
        const push = () => emitMockIpcEvent('backend:notification', { method: 'x' });

        onDestroy(() => {
          unregisterMockIpcHandler('codex:get-models');
          restore();
          detachAll();
        });
      </script>

      <button onclick={push}>Push</button>
    `;
    const fixtureCallCount = 6;
    const inRepo = (relativePath: string) => path.resolve(process.cwd(), relativePath);

    it.each([
      ['a test host', 'src/lib/components/__tests__/FixtureHost.svelte'],
      ['a preview', 'src/lib/components/previews/fixture-host.preview.svelte'],
    ])('allows %s to drive the mock IPC router and fake desktop bridge', async (_, filePath) => {
      expect(await lintSvelte(fixtureHost, { filePath: inRepo(filePath) })).toEqual([]);
    });

    it('still reports a production component that imports the test transports', async () => {
      const messages = await lintSvelte(fixtureHost, {
        filePath: inRepo('src/lib/components/fixtures/FixtureHost.svelte'),
      });

      expect(messages).toHaveLength(fixtureCallCount);
    });

    it('still reports a test host that calls the desktop bridge directly', async () => {
      const messages = await lintSvelte(
        `
          <script lang="ts">
            import { installMockElectronBridge } from '../../../test/ct-mock-electron-bridge';

            installMockElectronBridge({});
            const refresh = () => window.electronAPI.invoke('workspace:list');
          </script>

          <button onclick={refresh}>Refresh</button>
        `,
        { filePath: inRepo('src/lib/components/__tests__/FixtureHost.svelte') },
      );

      expect(messages).toHaveLength(1);
      expect(messages[0].line).toBe(6);
    });

    it('still reports real IPC wrappers and lookalike mock modules in test hosts', async () => {
      const messages = await lintSvelteWithModules(
        `
          <script lang="ts">
            import { listWorkspaces } from '../ipc/workspace-ipc';
            import { registerMockIpcHandler } from '../ipc-mock-router';

            function refresh() {
              listWorkspaces();
              registerMockIpcHandler('workspace:list', () => []);
            }
          </script>

          <button onclick={refresh}>Refresh</button>
        `,
        {
          'src/lib/ipc/workspace-ipc.ts': `export const listWorkspaces = () => window.electronAPI.invoke('workspace:list');`,
          'src/lib/ipc-mock-router.ts': `export const registerMockIpcHandler = (channel: string, handler: () => unknown) => window.electronAPI.invoke(channel, handler);`,
        },
        'src/lib/__tests__/FixtureHost.svelte',
      );

      expect(messages).toHaveLength(2);
    });
  });
});
