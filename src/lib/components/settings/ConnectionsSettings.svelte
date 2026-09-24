<script lang="ts">
  import { selectLabsGitLabEnabled } from '$store/renderer/slices/user-preferences/user-preferences-selectors';
  import { selectGitLabAuthIsConfigured } from '$store/renderer/slices/gitlab-auth/gitlab-auth-selectors';
  import { onMount } from 'svelte';
  import { m } from '$shared/paraglide/messages.js';
  import { store as appStore } from '$store/renderer/store';
  import { initializeGitHubAuth } from '$store/renderer/slices/github-auth/github-auth-slice';
  import { initializeGitLabAuth } from '$store/renderer/slices/gitlab-auth/gitlab-auth-slice';
  import { initializeLinearAuth } from '$store/renderer/slices/linear-auth/linear-auth-slice';
  import { initializeSentryAuth } from '$store/renderer/slices/sentry-auth/sentry-auth-slice';
  import { faGithub, faGitlab } from '@fortawesome/free-brands-svg-icons';
  import Fa from 'svelte-fa';
  import LinearIcon from '$lib/components/icons/LinearIcon.svelte';
  import SentryIcon from '$lib/components/icons/SentryIcon.svelte';
  import GitHubAuthConnection from './GitHubAuthConnection.svelte';
  import GitLabAuthConnection from './GitLabAuthConnection.svelte';
  import ForgeIdentityChoice from './ForgeIdentityChoice.svelte';
  import LinearAuthConnection from './LinearAuthConnection.svelte';
  import SentryAuthConnection from './SentryAuthConnection.svelte';

  // Track if initial load is complete
  let isLoading = $state(true);

  // Integration metadata for skeleton rendering (names are brand names — not translated)
  const gitlabEnabled$ = selectLabsGitLabEnabled();
  const gitlabConfigured$ = selectGitLabAuthIsConfigured();
  const integrations = [
    {
      icon: 'github',
      name: 'GitHub',
      description: m.settings_connections_github_description(),
    },
    {
      icon: 'gitlab',
      name: 'GitLab',
      description: m.settings_connections_gitlab_description(),
    },
    {
      icon: 'linear',
      name: 'Linear',
      description: m.settings_connections_linear_description(),
    },
    { icon: 'sentry', name: 'Sentry', description: m.settings_connections_sentry_description() },
  ] as const;

  onMount(() => {
    // Initialize all stores in parallel
    appStore.dispatch(initializeGitHubAuth());
    appStore.dispatch(initializeGitLabAuth());
    appStore.dispatch(initializeLinearAuth());
    appStore.dispatch(initializeSentryAuth());
    isLoading = false;
  });
</script>

{#if isLoading}
  <!-- Skeleton loading state - shows structure with known info -->
  <div class="divide-y divide-border [&>*:first-child]:pt-0 [&>*:last-child]:pb-0">
    {#each integrations.filter((item) => item.icon !== 'gitlab' || $gitlabEnabled$ || $gitlabConfigured$) as integration}
      <div class="grid grid-cols-[1rem_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 py-3">
        <div class="first-line-icon type-body w-4 text-ghost">
          {#if integration.icon === 'github'}
            <Fa icon={faGithub} class="size-4" />
          {:else if integration.icon === 'gitlab'}
            <Fa icon={faGitlab} class="size-4" />
          {:else if integration.icon === 'linear'}
            <LinearIcon size={16} />
          {:else if integration.icon === 'sentry'}
            <SentryIcon size={16} />
          {/if}
        </div>
        <div class="flex min-w-0 items-center gap-3">
          <span class="type-body font-medium text-foreground">{integration.name}</span>
          <div class="h-3 w-16 animate-pulse rounded bg-muted/50"></div>
        </div>
        <!-- Action button skeleton -->
        <div class="mt-1 h-4 w-14 animate-pulse rounded bg-muted/50"></div>
        <p class="type-body col-start-2 text-muted-foreground">{integration.description}</p>
      </div>
    {/each}
  </div>
{:else}
  <div class="divide-y divide-border [&>*:first-child]:pt-0 [&>*:last-child]:pb-0">
    <GitHubAuthConnection />
    <GitLabAuthConnection />
    <ForgeIdentityChoice />
    <LinearAuthConnection />
    <SentryAuthConnection />
  </div>
{/if}
