<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import GitHubRepoTab from './GitHubRepoTab.svelte';
  import { store as appStore } from '$store/renderer/store';
  import { setGitHubAuthState } from '$store/renderer/slices/github-auth/github-auth-slice';
  import {
    setGithubRepos,
    type GithubRepoItem,
  } from '$store/renderer/slices/github-repos/github-repos-slice';
  import { getItems } from '@themislib/themis/utils/collections/collection-utils';

  let {
    repos,
    onGithubUrlChange = () => {},
  }: {
    repos: GithubRepoItem[];
    onGithubUrlChange?: (url: string) => void;
  } = $props();

  let githubUrl = $state('');
  function handleChange(url: string) {
    githubUrl = url;
    onGithubUrlChange(url);
  }

  const previousAuth = appStore.state.githubAuth;
  const previousRepos = getItems(appStore.state.githubRepos.repos);
  appStore.dispatch(
    setGitHubAuthState({
      isAuthenticated: true,
      requiresDaemonAuth: false,
      user: { login: 'octocat', name: 'Octo Cat', email: null, avatar_url: '' },
      needsScopeUpdate: false,
      oauthUrl: null,
    }),
  );
  appStore.dispatch(setGithubRepos(untrack(() => repos)));
  onDestroy(() => {
    appStore.dispatch(setGitHubAuthState(previousAuth));
    appStore.dispatch(setGithubRepos(previousRepos));
  });
</script>

<div class="w-[640px] bg-background p-4 text-foreground">
  <GitHubRepoTab {githubUrl} onGithubUrlChange={handleChange} />
</div>
