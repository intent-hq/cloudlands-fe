<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import { setupRecentRepositoriesPreview } from './recent-repositories.preview-fixtures';

  function setupFixture() {
    return setupRecentRepositoriesPreview();
  }

  export const preview = definePreview({
    id: 'repository-forge-picker',
    title: 'Repository forge picker',
    defaultState: 'github-only',
    states: {
      'github-only': { props: { scenario: 'github-only' } },
      'gitlab-only': { props: { scenario: 'gitlab-only' } },
      both: { props: { scenario: 'both' } },
      disconnected: { props: { scenario: 'disconnected' } },
      'self-managed': { props: { scenario: 'self-managed' } },
    },
  });
</script>

<script lang="ts">
  import { onDestroy } from 'svelte';
  import { store as appStore } from '$store/renderer/store';
  import { setWorkspaceInitializerRecentRepos } from '$store/renderer/slices/workspace-initializer/workspace-initializer-slice';
  import { setGitHubAuthState } from '$store/renderer/slices/github-auth/github-auth-slice';
  import RepoSelector, { type RepoChangeDetail } from './RepoSelector.svelte';
  import { checkoutPickerCopy } from './gitlab-checkout-presentation';
  import type { GitLabProjectPickerProps } from './gitlab-picker-types';

  let { scenario = 'github-only' }: { scenario?: string } = $props();
  const cleanup = setupFixture();
  const githubBefore = appStore.state.githubAuth;
  // svelte-ignore state_referenced_locally -- one named fixture per mount
  appStore.dispatch(
    setGitHubAuthState({
      isAuthenticated: scenario === 'github-only' || scenario === 'both',
      requiresDaemonAuth: false,
      user: null,
      needsScopeUpdate: false,
      oauthUrl: null,
    }),
  );
  onDestroy(() => {
    cleanup();
    appStore.dispatch(setGitHubAuthState(githubBefore));
  });
  // Explicit saved URL fixture; workspace owner/name alone does not carry this identity.
  // svelte-ignore state_referenced_locally -- one named fixture per mount
  const instance =
    scenario === 'self-managed' ? 'https://git.example.test:8443/Forge' : 'https://gitlab.com';
  appStore.dispatch(
    setWorkspaceInitializerRecentRepos([
      {
        path: `${instance}/team/subgroup/app`,
        type: 'github',
        githubUrl: `${instance}/team/subgroup/app`,
        owner: 'team/subgroup',
        name: 'app',
      },
    ]),
  );
  let query = $state('');
  let selection = $state<RepoChangeDetail | string | null>(null);
  const gitlab = $derived<GitLabProjectPickerProps>({
    authenticated: scenario === 'gitlab-only' || scenario === 'both' || scenario === 'self-managed',
    instanceBaseUrl:
      scenario === 'self-managed' ? 'https://git.example.test:8443/Forge' : 'https://gitlab.com',
    scopeKey: 'fixture-owner/fixture-connection/fixture-capture',
    query,
    page: {
      status: 'ready',
      items: [{ projectPath: 'team/subgroup/app', name: 'app', namespace: 'team/subgroup' }].filter(
        (project) => project.projectPath.includes(query),
      ),
      hasMore: false,
    },
    copy: checkoutPickerCopy('projects'),
    onSearch: (value) => (query = value),
    onMore: () => {},
    onSelect: (value) => (selection = value),
  });
</script>

<section class="w-full min-w-0 p-4" data-testid="repository-forge-fixture">
  <RepoSelector
    {gitlab}
    triggerAriaLabel="Choose fixture repository"
    onchange={(event) => (selection = event.detail)}
  />
  <output class="sr-only" data-testid="repo-selection">{JSON.stringify(selection)}</output>
</section>
