<script lang="ts">
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import { ActionRow, Indicator } from '$lib/components/ui/menu';
  import { cn } from '$lib/utils';
  import { workspacePickerStyles } from './workspace-picker-styles';
  import RepositoryPickerIcon from './RepositoryPickerIcon.svelte';
  import { faGithub, faGitlab } from '@fortawesome/free-brands-svg-icons';
  import Fa from 'svelte-fa';

  let {
    owner,
    name,
    suffix,
    provider,
    avatarUrl,
    local = false,
    showOwner = true,
    showForge = false,
    recent = false,
    option = false,
    selected = false,
    formStyle = false,
    checked,
    class: className = '',
    ...button
  }: Omit<HTMLButtonAttributes, 'children' | 'name' | 'title' | 'role'> & {
    owner?: string;
    name: string;
    suffix?: string;
    provider?: 'github' | 'gitlab';
    avatarUrl?: string;
    local?: boolean;
    showOwner?: boolean;
    showForge?: boolean;
    recent?: boolean;
    option?: boolean;
    selected?: boolean;
    /** New Workspace form menus: shared 40px body rows with a selected check. */
    formStyle?: boolean;
    /** Check state when it differs from the highlight (`selected`). */
    checked?: boolean;
  } = $props();

  const forgeLabels = { github: 'GitHub', gitlab: 'GitLab' }; // i18n-ignore (brand names)
</script>

{#snippet formTrailing()}
  {#if checked ?? selected}
    <Indicator state="checked" class={cn(workspacePickerStyles.check, 'self-center')} />
  {/if}
{/snippet}

<ActionRow
  {...button}
  trailing={formStyle ? formTrailing : undefined}
  role={option ? 'option' : undefined}
  {selected}
  class={formStyle
    ? cn(
        workspacePickerStyles.row,
        'cursor-pointer focus-visible:outline-none [--menu-icon-size:1.25rem]',
        className,
      )
    : `gap-2 py-1.5 cursor-pointer ${className}`}
>
  {#snippet leading()}
    <RepositoryPickerIcon {owner} {provider} {avatarUrl} {local} size={formStyle ? 20 : 16} />
  {/snippet}
  {#snippet title()}
    <span class="flex min-w-0 items-center gap-2 {formStyle ? '' : 'text-sm'}">
      <span class="truncate" data-recent-repo-label={recent ? '' : undefined}>
        {#if showOwner && owner}<span class="text-subtle mr-1">{owner} /</span>{/if}
        {name}
        {#if suffix}<span class="text-subtle ml-1">({suffix})</span>{/if}
      </span>
      {#if showForge && provider && !formStyle}
        <span role="img" aria-label={forgeLabels[provider]} class="text-subtle shrink-0">
          <Fa icon={provider === 'github' ? faGithub : faGitlab} size={12} />
        </span>
      {/if}
    </span>
  {/snippet}
</ActionRow>
