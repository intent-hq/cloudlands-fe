<script lang="ts">
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import { ActionRow } from '$lib/components/ui/menu';
  import GitHubAvatar from '$lib/components/ui/GitHubAvatar.svelte';
  import PrincipalAvatar from '$lib/components/ui/PrincipalAvatar.svelte';
  import { faGithub, faGitlab } from '@fortawesome/free-brands-svg-icons';
  import Fa from 'svelte-fa';

  let {
    owner,
    name,
    suffix,
    provider,
    avatarUrl,
    showOwner = true,
    showForge = false,
    recent = false,
    option = false,
    selected = false,
    class: className = '',
    ...button
  }: Omit<HTMLButtonAttributes, 'children' | 'name' | 'title' | 'role'> & {
    owner?: string;
    name: string;
    suffix?: string;
    provider?: 'github' | 'gitlab';
    avatarUrl?: string;
    showOwner?: boolean;
    showForge?: boolean;
    recent?: boolean;
    option?: boolean;
    selected?: boolean;
  } = $props();

  const forgeLabels = { github: 'GitHub', gitlab: 'GitLab' }; // i18n-ignore (brand names)
</script>

<ActionRow
  {...button}
  role={option ? 'option' : undefined}
  {selected}
  class={`gap-2 py-1.5 cursor-pointer ${className}`}
>
  {#snippet leading()}
    {#if avatarUrl}
      <PrincipalAvatar {avatarUrl} label={owner || name} size={16} referrerpolicy="no-referrer" />
    {:else if owner && provider === 'github'}
      <GitHubAvatar identity={owner} class="size-4 rounded-full">
        {#snippet fallback()}<PrincipalAvatar label={owner} size={16} />{/snippet}
      </GitHubAvatar>
    {:else}
      <PrincipalAvatar label={owner || name} size={16} />
    {/if}
  {/snippet}
  {#snippet title()}
    <span class="flex min-w-0 items-center gap-2 text-sm">
      <span class="truncate" data-recent-repo-label={recent ? '' : undefined}>
        {#if showOwner && owner}<span class="text-subtle mr-1">{owner} /</span>{/if}
        {name}
        {#if suffix}<span class="text-subtle ml-1">({suffix})</span>{/if}
      </span>
      {#if showForge && provider}
        <span role="img" aria-label={forgeLabels[provider]} class="text-subtle shrink-0">
          <Fa icon={provider === 'github' ? faGithub : faGitlab} size={12} />
        </span>
      {/if}
    </span>
  {/snippet}
</ActionRow>
