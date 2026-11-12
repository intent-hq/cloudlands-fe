<!-- @catalog-exempt: decorative repository identity shared by the catalogued picker rows and trigger -->
<script lang="ts">
  import GitHubAvatar from '$lib/components/ui/GitHubAvatar.svelte';
  import PrincipalAvatar from '$lib/components/ui/PrincipalAvatar.svelte';
  import GitRepoIcon from '$lib/components/icons/GitRepoIcon.svelte';
  import { faGithub, faGitlab } from '@fortawesome/free-brands-svg-icons';
  import { faFolder } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';

  let {
    owner,
    provider,
    avatarUrl,
    local = false,
    size = 20,
  }: {
    owner?: string;
    provider?: 'github' | 'gitlab';
    avatarUrl?: string;
    local?: boolean;
    size?: number;
  } = $props();
</script>

{#snippet fallback()}
  {#if local}
    <Fa icon={faFolder} {size} class="shrink-0 text-muted-foreground" />
  {:else if provider}
    <Fa
      icon={provider === 'github' ? faGithub : faGitlab}
      {size}
      class="shrink-0 text-muted-foreground"
    />
  {:else}
    <GitRepoIcon {size} class="shrink-0 text-muted-foreground" />
  {/if}
{/snippet}

{#if owner && provider === 'github'}
  <GitHubAvatar identity={owner} {avatarUrl} {size} class="shrink-0 rounded-full" {fallback} />
{:else if avatarUrl}
  <PrincipalAvatar {avatarUrl} label={owner ?? ''} {size} referrerpolicy="no-referrer" />
{:else}
  {@render fallback()}
{/if}
