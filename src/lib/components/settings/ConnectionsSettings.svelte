<script lang="ts">
  import { onMount } from 'svelte';
  import { githubAuthStore } from '$features/github-auth/renderer/github-auth.store.svelte';
  import { linearAuthStore } from '$features/linear-auth/renderer/linear-auth.store.svelte';
  import { sentryAuthStore } from '$features/sentry-auth/renderer/sentry-auth.store.svelte';
  import { faGithub } from '@fortawesome/free-brands-svg-icons';
  import Fa from 'svelte-fa';
  import LinearIcon from '$lib/components/icons/LinearIcon.svelte';
  import SentryIcon from '$lib/components/icons/SentryIcon.svelte';
  import GitHubAuthConnection from './GitHubAuthConnection.svelte';
  import LinearAuthConnection from './LinearAuthConnection.svelte';
  import SentryAuthConnection from './SentryAuthConnection.svelte';

  // Track if initial load is complete
  let isLoading = $state(true);

  // Integration metadata for skeleton rendering
  const integrations = [
    {
      icon: 'github',
      name: 'GitHub',
      description: 'Push changes and create pull requests directly from workspaces.',
    },
    {
      icon: 'linear',
      name: 'Linear',
      description: 'Create workspaces tasks directly from tickets.',
    },
    { icon: 'sentry', name: 'Sentry', description: 'Create spaces directly from issues.' },
  ] as const;

  onMount(async () => {
    // Initialize all stores in parallel
    await Promise.all([
      githubAuthStore.initialize(),
      linearAuthStore.initialize(),
      sentryAuthStore.initialize(),
    ]);
    isLoading = false;
  });
</script>

{#if isLoading}
  <!-- Skeleton loading state - shows structure with known info -->
  <div class="space-y-6">
    {#each integrations as integration}
      <div class="flex items-start justify-between gap-4">
        <div class="space-y-1">
          <div class="flex items-center gap-2">
            {#if integration.icon === 'github'}
              <Fa icon={faGithub} class="w-4 h-4 text-ghost" />
            {:else if integration.icon === 'linear'}
              <LinearIcon size={14} class="text-ghost" />
            {:else if integration.icon === 'sentry'}
              <SentryIcon size={17} class="text-ghost" />
            {/if}
            <span class="text-sm text-foreground">{integration.name}</span>
            <!-- Status skeleton -->
            <div class="h-3 w-16 bg-muted/50 rounded animate-pulse"></div>
          </div>
          <p class="text-xs text-subtle pl-6">{integration.description}</p>
        </div>
        <!-- Action button skeleton -->
        <div class="h-4 w-14 bg-muted/50 rounded animate-pulse"></div>
      </div>
    {/each}
  </div>
{:else}
  <div class="space-y-6">
    <GitHubAuthConnection skipInitialize />
    <LinearAuthConnection skipInitialize />
    <SentryAuthConnection skipInitialize />
  </div>
{/if}
