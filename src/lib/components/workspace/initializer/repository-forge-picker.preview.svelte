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
      'both-gitlab': { props: { scenario: 'both-gitlab' } },
      'gitlab-unavailable': { props: { scenario: 'gitlab-unavailable' } },
      disconnected: { props: { scenario: 'disconnected' } },
      'github-plain-folder': { props: { scenario: 'github-plain-folder' } },
      'no-forge': { props: { scenario: 'no-forge' } },
      'no-forge-plain-folder': { props: { scenario: 'no-forge-plain-folder' } },
      'self-managed': { props: { scenario: 'self-managed' } },
    },
  });
</script>

<script lang="ts">
  import { onDestroy } from 'svelte';
  import { store as appStore } from '$store/renderer/store';
  import { setWorkspaceInitializerRecentRepos } from '$store/renderer/slices/workspace-initializer/workspace-initializer-slice';
  import { setGitHubAuthState } from '$store/renderer/slices/github-auth/github-auth-slice';
  import {
    resetGitLabAdmission,
    setGitLabAuthStatus,
  } from '$store/renderer/slices/gitlab-auth/gitlab-auth-slice';
  import { setGithubRepos } from '$store/renderer/slices/github-repos/github-repos-slice';
  import { selectGithubRepos } from '$store/renderer/slices/github-repos/github-repos-selectors';
  import RepoSelector, { type RepoChangeDetail } from './RepoSelector.svelte';
  import { checkoutPickerCopy } from './gitlab-checkout-presentation';
  import type { GitLabProjectPickerProps } from './gitlab-picker-types';

  let { scenario = 'github-only' }: { scenario?: string } = $props();
  const cleanup = setupFixture();
  const githubBefore = appStore.state.githubAuth;
  const reposBefore = selectGithubRepos.select(appStore.state);
  const names = ['app', 'a-deliberately-long-repository-name-that-must-truncate-in-this-list'];
  appStore.dispatch(
    setGithubRepos(
      names.map((name, index) => ({
        id: `${index ? 'missing-owner' : 'fixture-owner'}/${name}`,
        owner: index ? 'missing-owner' : 'fixture-owner',
        name,
      })),
    ),
  );
  // svelte-ignore state_referenced_locally -- one named fixture per mount
  appStore.dispatch(
    setGitHubAuthState({
      isAuthenticated: [
        'github-only',
        'github-plain-folder',
        'both',
        'both-gitlab',
        'gitlab-unavailable',
      ].includes(scenario),
      requiresDaemonAuth: false,
      user: null,
      needsScopeUpdate: false,
      oauthUrl: null,
    }),
  );
  // svelte-ignore state_referenced_locally -- one named fixture per mount
  const noForge = scenario.startsWith('no-forge');
  // svelte-ignore state_referenced_locally -- one named fixture per mount
  const plainFolderMode = scenario.endsWith('plain-folder');
  // Settled "nothing connected" forge status: the Clone tab is hidden.
  if (noForge)
    appStore.dispatch(
      setGitLabAuthStatus({
        host: 'gitlab.com',
        isConfigured: false,
        deviceGrantSupported: null,
        user: null,
        method: null,
      }),
    );
  onDestroy(() => {
    cleanup();
    if (noForge) appStore.dispatch(resetGitLabAdmission());
    appStore.dispatch(setGitHubAuthState(githubBefore));
    appStore.dispatch(setGithubRepos(reposBefore));
  });
  // Explicit saved URL fixture; workspace owner/name alone does not carry this identity.
  // svelte-ignore state_referenced_locally -- one named fixture per mount
  const instance =
    scenario === 'self-managed' ? 'https://git.example.test:8443/Forge' : 'https://gitlab.com';
  appStore.dispatch(
    setWorkspaceInitializerRecentRepos([
      ...names.map(
        (name) =>
          ({
            path: `${instance}/team/subgroup/${name}`,
            type: 'github',
            githubUrl: `${instance}/team/subgroup/${name}`,
            owner: 'team/subgroup',
            name,
          }) as const,
      ),
    ]),
  );
  let query = $state('');
  let selection = $state<RepoChangeDetail | string | null>(null);
  const gitlab = $derived<GitLabProjectPickerProps>({
    authenticated: [
      'gitlab-only',
      'both',
      'both-gitlab',
      'gitlab-unavailable',
      'self-managed',
    ].includes(scenario),
    instanceBaseUrl:
      scenario === 'self-managed' ? 'https://git.example.test:8443/Forge' : 'https://gitlab.com',
    scopeKey: 'fixture-owner/fixture-connection/fixture-capture',
    query,
    page:
      scenario === 'gitlab-unavailable'
        ? { status: 'unavailable', message: 'GitLab is unavailable', actionLabel: 'Refresh' }
        : {
            status: 'ready',
            items: names
              .map((name) => ({
                projectPath: `team/subgroup/${name}`,
                name,
                namespace: 'team/subgroup',
                ...(name === 'app'
                  ? { ownerAvatarUrl: `${instance}/uploads/fixture-namespace.png` }
                  : {}),
              }))
              .filter((project) => project.projectPath.includes(query)),
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
    gitlabSelected={scenario === 'both-gitlab' || scenario === 'gitlab-unavailable'}
    {plainFolderMode}
    triggerAriaLabel="Choose fixture repository"
    onchange={(event) => (selection = event.detail)}
  />
  <output class="sr-only" data-testid="repo-selection">{JSON.stringify(selection)}</output>
</section>
