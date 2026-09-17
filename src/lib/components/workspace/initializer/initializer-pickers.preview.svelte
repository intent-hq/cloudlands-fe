<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import { appClient } from '$lib/client';
  import { mockInvoke } from '$shared/ipc-mock-router';
  import { store as appStore } from '$store/renderer/store';
  import {
    loadGitBranches,
    readGitBranchStatusRequested,
    setGitBranches,
    setGitBranchStatus,
  } from '$store/renderer/slices/git/git-slice';
  import { getLocale, locales, overwriteGetLocale } from '$shared/paraglide/runtime.js';
  import { setupRecentRepositoriesPreview } from './recent-repositories.preview-fixtures';

  type Locale = (typeof locales)[number];

  function setupPickerFixture(onRefresh: () => void, locale: Locale) {
    const restoreRepos = setupRecentRepositoriesPreview();
    const originalGetLocale = getLocale;
    const originalGithubBranches = appClient.integrations.githubBranches;
    const originalGithubCached = appClient.integrations.githubBranchesCached;
    const originalDispatch = appStore.dispatch;
    overwriteGetLocale(() => locale);
    const originalBridge = Object.getOwnPropertyDescriptor(window, 'electronAPI');
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        versions: { electron: 'preview-native-controls' },
        invoke: (channel: string, ...args: unknown[]) =>
          channel === 'file:getDirectoryStatus'
            ? Promise.resolve({ success: true, data: { exists: true, isGitRepo: true } })
            : mockInvoke(channel, ...args),
        on: () => () => {},
      },
    });
    Object.defineProperty(appStore, 'dispatch', {
      configurable: true,
      value: (action: Parameters<typeof originalDispatch>[0]) => {
        const result = originalDispatch(action);
        if (action.type === loadGitBranches.type) {
          const [repoPath] = action.payload;
          onRefresh();
          originalDispatch(
            setGitBranches(repoPath, {
              branches: [
                'main',
                ...Array.from({ length: 30 }, (_, index) => `feature/task-${index}`),
              ],
              remoteBranches: ['origin/release'],
              defaultBranch: 'main',
              currentBranch: 'main',
            }),
          );
        } else if (action.type === readGitBranchStatusRequested.type) {
          const [repoPath, branchName] = action.payload;
          originalDispatch(
            setGitBranchStatus(repoPath, branchName, {
              branch: branchName,
              isCurrentBranch: branchName === 'main',
              ahead: 0,
              behind: 0,
              hasUncommittedChanges: true,
              currentBranch: 'main',
            }),
          );
        }
        return result;
      },
    });
    appClient.integrations.githubBranches = async () => ({
      branches: ['main', 'feature/inline-picker'],
      defaultBranch: 'main',
    });
    appClient.integrations.githubBranchesCached = async () => ({ cached: false, branches: [] });
    return () => {
      overwriteGetLocale(originalGetLocale);
      appClient.integrations.githubBranches = originalGithubBranches;
      appClient.integrations.githubBranchesCached = originalGithubCached;
      Object.defineProperty(appStore, 'dispatch', {
        configurable: true,
        value: originalDispatch,
      });
      if (originalBridge) Object.defineProperty(window, 'electronAPI', originalBridge);
      else Reflect.deleteProperty(window, 'electronAPI');
      restoreRepos();
    };
  }

  interface Props {
    position?: 'top' | 'bottom' | 'stacked';
    scenario?: 'local' | 'clone' | 'long' | 'remote';
    locale?: Locale;
  }
  export const preview = definePreview<Props>({
    id: 'initializer-pickers',
    title: 'Initializer repository and branch pickers',
    defaultState: 'top',
    states: {
      top: { props: { position: 'top' } },
      bottom: { props: { position: 'bottom' } },
      stacked: { props: { position: 'stacked' } },
      clone: { props: { scenario: 'clone' } },
      long: { props: { scenario: 'long' } },
      remote: { props: { scenario: 'remote' } },
      'remote-de': { props: { scenario: 'remote', locale: 'de' } },
    },
  });
</script>

<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import RepoAndBranchPicker from './RepoAndBranchPicker.svelte';
  import * as Tabs from '$lib/components/ui/tabs';

  let { position = 'top', scenario = 'local', locale = 'en' }: Props = $props();
  const initialScenario = untrack(() => scenario);
  let branch = $state(initialScenario === 'long' ? 'feature/a-long-selected-branch-name' : 'main');
  let repoPath = $state(
    initialScenario === 'clone'
      ? 'fixture-owner/app'
      : initialScenario === 'long'
        ? '/fixture/a-deliberately-long-selected-repository-name'
        : '/fixture/app',
  );
  let repoType = $state<'local' | 'github' | 'remote'>(
    initialScenario === 'clone' ? 'github' : initialScenario === 'remote' ? 'remote' : 'local',
  );
  let githubUrl = $state(initialScenario === 'clone' ? 'https://github.com/fixture-owner/app' : '');
  let skipIsolation = $state(false);
  let refreshes = $state(0);
  onDestroy(
    setupPickerFixture(
      () => (refreshes += 1),
      untrack(() => locale),
    ),
  );
</script>

<section
  class="relative isolate overflow-hidden w-full min-w-0 p-4 bg-sidebar"
  class:bottom={position !== 'top'}
  data-testid="initializer-pickers-fixture"
>
  <RepoAndBranchPicker
    {repoPath}
    {repoType}
    {githubUrl}
    {branch}
    {skipIsolation}
    remoteSetup={scenario === 'remote'
      ? {
          id: 'fixture-remote',
          name: 'dev-host',
          host: 'example.test',
          port: 22,
          username: 'dev',
          workspacePath: '/srv/app',
          branch: 'main',
        }
      : null}
    onRepoChange={(event) => {
      repoPath = event.detail.path;
      repoType = event.detail.type;
      githubUrl = event.detail.githubUrl ?? '';
    }}
    onBranchChange={(event) => (branch = event.detail.branch)}
    onSkipIsolationChange={(value) => (skipIsolation = value)}
  />
  <output class="sr-only" data-testid="initializer-selection">
    {JSON.stringify({ repoPath, branch, skipIsolation, refreshes })}
  </output>
</section>

{#if position === 'stacked'}
  <div class="fixed top-0 inset-x-0 z-20 bg-sidebar" data-testid="stacked-tabs">
    <Tabs.Root value="setup">
      <Tabs.List aria-label="Fixture panels">
        <Tabs.Trigger value="setup">Setup</Tabs.Trigger>
        <Tabs.Trigger value="preview">Preview</Tabs.Trigger>
      </Tabs.List>
    </Tabs.Root>
  </div>
{/if}

<style>
  .bottom {
    padding-top: max(1rem, calc(100dvh - 5rem));
  }
</style>
