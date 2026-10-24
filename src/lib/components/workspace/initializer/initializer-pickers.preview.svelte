<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import { appClient } from '$lib/client';
  import { mockInvoke } from '$shared/ipc-mock-router';
  import { getLocale, locales, overwriteGetLocale } from '$shared/paraglide/runtime.js';
  import { setupRecentRepositoriesPreview } from './recent-repositories.preview-fixtures';

  type Locale = (typeof locales)[number];

  function setupPickerFixture(onRefresh: () => void, locale: Locale, showBranchDesign = false) {
    const restoreRepos = setupRecentRepositoriesPreview();
    const originalGetLocale = getLocale;
    overwriteGetLocale(() => locale);
    const originalBranches = appClient.git.getBranches;
    const originalStatus = appClient.git.branchStatus;
    const originalGithubBranches = appClient.integrations.githubBranches;
    const originalGithubCached = appClient.integrations.githubBranchesCached;
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
    let branchReads = 0;
    appClient.git.getBranches = async () => {
      branchReads += 1;
      onRefresh();
      return {
        branches: showBranchDesign
          ? [
              'main',
              'add-ci-and-linting',
              'add-opengraph-tags',
              'add-platform-page',
              'address-pr-feedback',
              'careers-role-page-template',
              'workspace/amber-forest',
              'workspace/quiet-heron',
              'workspace/bright-otter',
              'dependabot/npm_and_yarn/vite',
              'dependabot/npm_and_yarn/svelte',
            ]
          : ['main', ...Array.from({ length: 30 }, (_, index) => `feature/task-${index}`)],
        remoteBranches: showBranchDesign
          ? branchReads > 1
            ? ['origin/release', 'origin/hotfix-login']
            : []
          : ['origin/release'],
        defaultBranch: 'main',
        currentBranch: 'main',
      };
    };
    appClient.git.branchStatus = async (_repoPath, branchName) => ({
      branch: branchName,
      isCurrentBranch: branchName === 'main',
      ahead: 0,
      behind: 0,
      hasUncommittedChanges: !showBranchDesign,
      currentBranch: 'main',
    });
    appClient.integrations.githubBranches = async () => ({
      branches: ['main', 'feature/inline-picker'],
      defaultBranch: 'main',
    });
    appClient.integrations.githubBranchesCached = async () => ({ cached: false, branches: [] });
    return () => {
      overwriteGetLocale(originalGetLocale);
      appClient.git.getBranches = originalBranches;
      appClient.git.branchStatus = originalStatus;
      appClient.integrations.githubBranches = originalGithubBranches;
      appClient.integrations.githubBranchesCached = originalGithubCached;
      if (originalBridge) Object.defineProperty(window, 'electronAPI', originalBridge);
      else Reflect.deleteProperty(window, 'electronAPI');
      restoreRepos();
    };
  }

  interface Props {
    position?: 'top' | 'bottom' | 'stacked';
    scenario?: 'local' | 'clone' | 'long' | 'remote';
    locale?: Locale;
    branchPreview?: 'groups-closed' | 'workspace-open' | 'remote-open' | 'direct-mode';
  }
  export const preview = definePreview<Props>({
    id: 'initializer-pickers',
    title: 'Initializer repository and branch pickers',
    defaultState: 'top',
    captureReadiness: { selector: '[data-picker-ready=true]' },
    states: {
      top: { props: { position: 'top' } },
      bottom: { props: { position: 'bottom' } },
      stacked: { props: { position: 'stacked' } },
      clone: { props: { scenario: 'clone' } },
      long: { props: { scenario: 'long' } },
      remote: { props: { scenario: 'remote' } },
      'remote-de': { props: { scenario: 'remote', locale: 'de' } },
      'groups-closed': { props: { branchPreview: 'groups-closed' } },
      'workspace-open': { props: { branchPreview: 'workspace-open' } },
      'remote-open': { props: { branchPreview: 'remote-open' } },
      'direct-mode': { props: { branchPreview: 'direct-mode' } },
    },
  });
</script>

<script lang="ts">
  import { onDestroy, tick, untrack } from 'svelte';
  import RepoAndBranchPicker from './RepoAndBranchPicker.svelte';
  import * as Tabs from '$lib/components/ui/tabs';

  let { position = 'top', scenario = 'local', locale = 'en', branchPreview }: Props = $props();
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
  let skipIsolation = $state(untrack(() => branchPreview === 'direct-mode'));
  let refreshes = $state(0);
  let branchesReady = $state(false);
  let previewReady = $state(false);
  let openedPreview = false;
  let expandedPreview = false;
  let fixtureEl: HTMLElement | undefined = $state();
  onDestroy(
    setupPickerFixture(
      () => (refreshes += 1),
      untrack(() => locale),
      untrack(() => Boolean(branchPreview)),
    ),
  );

  $effect(() => {
    if (!branchPreview || !fixtureEl || openedPreview) return;
    openedPreview = true;
    void tick().then(() => {
      fixtureEl?.querySelectorAll<HTMLButtonElement>('button[aria-haspopup="dialog"]')[1]?.click();
    });
  });

  $effect(() => {
    if (!branchPreview || !branchesReady || expandedPreview) return;
    expandedPreview = true;
    const group =
      branchPreview === 'workspace-open'
        ? 'workspace'
        : branchPreview === 'remote-open'
          ? 'remote'
          : null;
    void tick().then(async () => {
      if (group)
        fixtureEl?.ownerDocument
          .querySelector<HTMLButtonElement>(`[data-branch-group="${group}"]`)
          ?.click();
      await tick();
      previewReady = true;
    });
  });
</script>

<section
  bind:this={fixtureEl}
  class="relative isolate overflow-hidden w-full min-w-0 p-4 bg-sidebar"
  class:bottom={position !== 'top'}
  class:min-h-168={Boolean(branchPreview)}
  data-testid="initializer-pickers-fixture"
  data-picker-ready={!branchPreview || previewReady}
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
    onBranchesLoaded={() => (branchesReady = true)}
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
