<script lang="ts">
  import type { Snippet } from 'svelte';
  import * as Tabs from '$lib/components/ui/tabs';
  import { Button } from '$lib/components/ui/button';
  import GitHubIcon from '$lib/components/icons/GitHubIcon.svelte';
  import LinearIcon from '$lib/components/icons/LinearIcon.svelte';
  import Fa from 'svelte-fa';
  import { faPlus } from '@fortawesome/free-solid-svg-icons';
  import { m } from '$shared/paraglide/messages.js';

  let {
    customViewName,
    repositoryGithubUrl,
    canCreate,
    onCreate,
    onOpenRepository,
    actions,
  }: {
    customViewName?: string;
    repositoryGithubUrl: string | null;
    canCreate: boolean;
    onCreate: () => void;
    onOpenRepository: (url: string) => void;
    actions?: Snippet;
  } = $props();
</script>

<header class="home-header flex shrink-0 items-center gap-x-6 border-b border-border px-6">
  <Tabs.List class="home-tabs min-w-0 flex-1 gap-5 px-0" aria-label={m.home_views()}>
    <Tabs.Trigger value="workspaces">{m.home_tab_workspaces()}</Tabs.Trigger>
    <Tabs.Trigger value="prs" aria-label={m.home_tab_prs()}>
      <span class="home-tab-label">{m.home_tab_prs()}</span>
      <span class="home-tab-logo" aria-hidden="true"><GitHubIcon size={18} /></span>
    </Tabs.Trigger>
    <Tabs.Trigger value="linear" aria-label={m.home_tab_linear()}>
      <span class="home-tab-label">{m.home_tab_linear()}</span>
      <span class="home-tab-logo" aria-hidden="true"><LinearIcon size={18} /></span>
    </Tabs.Trigger>
    {#if customViewName}
      <Tabs.Trigger
        value="custom"
        aria-label={customViewName}
        title={customViewName}
        class="min-w-0 max-w-44 shrink"><span class="truncate">{customViewName}</span></Tabs.Trigger
      >
    {/if}
  </Tabs.List>
  <div class="home-header-actions ml-auto flex items-center gap-2 py-2">
    {#if repositoryGithubUrl}
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={m.home_repository_metadata_open_github()}
        tooltip={m.home_repository_metadata_open_github()}
        onclick={() => {
          if (repositoryGithubUrl) onOpenRepository(repositoryGithubUrl);
        }}><GitHubIcon size={16} /></Button
      >
    {/if}
    {@render actions?.()}
    {#if canCreate}
      <div class="home-create">
        <Button variant="primary" size="sm" onclick={onCreate}>
          {#snippet leadingIcon()}<Fa icon={faPlus} />{/snippet}{m.home_new_workspace()}
        </Button>
      </div>
    {/if}
  </div>
</header>
