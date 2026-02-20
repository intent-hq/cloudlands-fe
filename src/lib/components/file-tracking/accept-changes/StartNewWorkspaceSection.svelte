<script lang="ts">
  /**
   * StartNewWorkspaceSection - Expandable form for creating a new workspace
   * Shows at the bottom of the Accept Changes panel when work is done
   */
  import { slide } from 'svelte/transition';
  import Fa from 'svelte-fa';
  import {
    faChevronRight,
    faCodeBranch,
    faServer,
    faSpinner,
    faArrowRight,
  } from '@fortawesome/free-solid-svg-icons';
  import { Button } from '$lib/components/ui/button';
  import RichTextarea from '$lib/components/ui/RichTextarea.svelte';
  import GitRepoIcon from '$lib/components/icons/GitRepoIcon.svelte';
  import type { Workspace } from '$shared/types';
  import { generateNoteLink } from '$lib/utils/workspaces-link-handler';

  interface Props {
    workspace: Workspace | null;
    workspaceTitle?: string;
    onCreateWorkspace?: (prompt: string) => void;
    isCreating?: boolean;
  }

  let { workspace, workspaceTitle = '', onCreateWorkspace, isCreating = false }: Props = $props();

  // Never expand by default - user should explicitly expand
  let isExpanded = $state(false);
  let promptValue = $state('');
  let richTextarea: { focus: () => void } | undefined = $state();

  // Generate a cross-workspace link to the current workspace's spec
  const specLink = $derived.by(() => {
    if (!workspace?.id) return '';
    return generateNoteLink('spec', workspace.id);
  });

  // Generate a helpful seed prompt based on current workspace
  // End with where the user would naturally start typing
  const seedPrompt = $derived.by(() => {
    const title = workspaceTitle || workspace?.title || '';
    // Create a markdown link to the previous workspace's spec
    const workspaceRef = specLink
      ? `[${title || 'previous workspace'}](${specLink})`
      : title || 'the previous workspace';
    return `I just finished ${workspaceRef}. Next, I want to `;
  });

  // Initialize prompt with seed on first expand
  $effect(() => {
    if (isExpanded && !promptValue) {
      promptValue = seedPrompt;
      // Focus the RichTextarea after it mounts
      setTimeout(() => {
        richTextarea?.focus();
      }, 100);
    }
  });

  // Extract display values from workspace
  const repoName = $derived.by(() => {
    if (!workspace?.repositoryPath) return 'No repository';
    const parts = workspace.repositoryPath.split('/');
    return parts[parts.length - 1] || workspace.repositoryPath;
  });

  const branchName = $derived(workspace?.baseRef || workspace?.branch || 'main');

  const hasRemoteEnv = $derived(
    workspace?.environmentConfig?.type === 'remote' && workspace?.environmentConfig?.ssh,
  );
  const remoteHost = $derived(workspace?.environmentConfig?.ssh?.host || '');

  function handleSubmit() {
    if (promptValue.trim() && onCreateWorkspace) {
      onCreateWorkspace(promptValue.trim());
    }
  }
</script>

<div class="rounded-lg overflow-hidden">
  <!-- Collapsible Header -->
  <button
    type="button"
    class="w-full flex items-center gap-1.5 px-2 py-1.5 text-left hover:bg-muted/30 transition-colors cursor-pointer rounded"
    onclick={() => (isExpanded = !isExpanded)}
  >
    <Fa
      icon={faChevronRight}
      class="h-2 w-2 text-muted-foreground/50 transition-transform duration-150 {isExpanded
        ? 'rotate-90'
        : ''}"
    />
    <span class="text-sm text-muted-foreground/70">Archive and start new Space</span>
  </button>

  <!-- Expanded Content - styled like WorkspaceInitializer -->
  {#if isExpanded}
    <div class="pt-2 space-y-1" transition:slide={{ duration: 150 }}>
      <!-- Prompt Input - matching initializer style -->
      <RichTextarea
        bind:this={richTextarea}
        bind:value={promptValue}
        placeholder="What would you like to work on next?"
        {workspace}
        minHeight={120}
        maxHeight={300}
        onsubmit={handleSubmit}
        class="border-none bg-sidebar dark:bg-black"
      />

      <!-- Configuration Row - non-interactive display -->
      <div class="flex items-center gap-1 text-xs text-muted-foreground/50 pb-3">
        <!-- Repository -->
        <div class="flex items-center gap-1.5 px-2 py-1" title={workspace?.repositoryPath}>
          <GitRepoIcon size={12} class="text-muted-foreground/50" />
          <span class="truncate max-w-[120px]">{repoName}</span>
        </div>

        <span class="text-muted-foreground/30">/</span>

        <!-- Branch -->
        <div class="flex items-center gap-1.5 px-2 py-1" title={branchName}>
          <Fa icon={faCodeBranch} class="h-3 w-3 text-muted-foreground/50" />
          <span class="truncate max-w-[100px]">{branchName}</span>
        </div>

        <!-- Remote Environment (if applicable) -->
        {#if hasRemoteEnv}
          <span class="text-muted-foreground/30 ml-auto">@</span>
          <div class="flex items-center gap-1.5 px-2 py-1" title={remoteHost}>
            <Fa icon={faServer} class="h-3 w-3 text-muted-foreground/50" />
            <span class="truncate max-w-[100px]">{remoteHost}</span>
          </div>
        {/if}
      </div>

      <!-- Submit Button - matching initializer style -->
      <Button
        onclick={handleSubmit}
        disabled={!promptValue.trim() || isCreating}
        class="w-full cursor-pointer disabled:bg-muted disabled:text-muted-foreground group"
        size="lg"
      >
        {#if isCreating}
          <Fa icon={faSpinner} class="h-3.5 w-3.5 animate-spin" />
          <span>Creating...</span>
        {:else}
          <span>Create new Space</span>
          <Fa
            icon={faArrowRight}
            class="h-3.5 w-3.5 ml-1 opacity-0 group-hover:opacity-100 transition-opacity"
          />
        {/if}
      </Button>
    </div>
  {/if}
</div>
