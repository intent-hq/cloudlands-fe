<script lang="ts">
  import { logger } from '$lib/utils/client-logger';

  import { getWorkspaceContext } from '$features/workspace/workspace.context.svelte';
  import { invoke } from '$lib/electron-bridge';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Textarea } from '$lib/components/ui/textarea';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { Badge } from '$lib/components/ui/badge';
  import {
    faCodePullRequest,
    faExclamationCircle,
    faCircleCheck,
    faMagic,
    faPaperPlane,
    faSpinner,
    faCodeBranch,
    faXmark,
    faInfo,
  } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import type { PullRequestInfo } from '$shared/types';

  interface Props {
    onClose?: () => void;
    onCreated?: (pr: PullRequestInfo) => void;
  }

  let { onClose, onCreated }: Props = $props();

  let ctx = getWorkspaceContext();

  // Form state
  let generatingContent = $state(false);
  let creatingPR = $state(false);
  let error: string | null = $state(null);
  let success = $state(false);

  // PR Form fields with skeleton states
  let formData = $state({
    title: { value: '', loading: false },
    description: { value: '', loading: false },
    isDraft: false,
  });

  // User instructions for PR generation
  let userInstructions = $state('');

  // Track if we should auto-create after generation
  let autoCreatePending = $state(false);

  async function generatePRContent() {
    if (!ctx || !ctx.workspace) return;

    generatingContent = true;
    error = null;

    // Set all fields to loading
    formData = {
      title: { value: '', loading: true },
      description: { value: '', loading: true },
      isDraft: false,
    };

    try {
      const workspaceContext = {
        workspaceId: ctx.workspace.id,
        title: ctx.workspace.title,
        branch: ctx.workspace.branch,
        baseRef: ctx.workspace.baseRef,
        repositoryPath: ctx.workspace.repositoryPath,
        repositoryOwner: ctx.workspace.repositoryOwner,
        repositoryName: ctx.workspace.repositoryName,
        userInstructions: userInstructions || undefined,
      };

      const result = await invoke<string>('pr:generateContent', workspaceContext);

      if (result) {
        try {
          const parsed = JSON.parse(result);
          formData.title.value = parsed.title || '';
          formData.title.loading = false;
          formData.description.value = parsed.description || '';
          formData.description.loading = false;
        } catch (e) {
          logger.error('Failed to parse PR content:', e);
          error = 'Failed to generate PR content';
        }
      }
    } catch (err: any) {
      logger.error('Failed to generate PR content:', err);
      error = err.message || 'Failed to generate PR content';
      formData.title.loading = false;
      formData.description.loading = false;
      autoCreatePending = false;
    } finally {
      generatingContent = false;
    }
  }

  async function generateAndCreate() {
    autoCreatePending = true;
    await generatePRContent();
    // After generation completes, create the PR if we have a title
    if (autoCreatePending && formData.title.value) {
      await createPullRequest();
    }
    autoCreatePending = false;
  }

  async function createPullRequest() {
    if (!ctx || !ctx.workspace) return;
    if (!formData.title.value) {
      error = 'Please provide a title for the pull request';
      return;
    }

    creatingPR = true;
    error = null;

    try {
      const prData = {
        workspaceId: ctx.workspace.id,
        title: formData.title.value,
        description: formData.description.value,
        isDraft: formData.isDraft,
        branch: ctx.workspace.branch,
        baseRef: ctx.workspace.baseRef || 'main',
      };

      const result = await invoke<PullRequestInfo>('pr:create', prData);

      if (result) {
        success = true;
        // Update workspace context with the new PR
        if (ctx && ctx.workspace) {
          ctx.workspace.activePullRequest = result;
          ctx.workspace.prNumber = result.number;
        }

        // Notify parent
        if (onCreated) {
          onCreated(result);
        }

        // Auto-close after a short delay
        setTimeout(() => {
          if (onClose) onClose();
        }, 2000);
      }
    } catch (err: any) {
      logger.error('Failed to create PR:', err);
      error = err.message || 'Failed to create pull request';
    } finally {
      creatingPR = false;
    }
  }
</script>

<div class="flex flex-col h-full bg-background">
  <!-- Header -->
  <div class="flex items-center justify-between px-6 py-4 border-b border-border">
    <div class="flex items-center gap-3">
      <Fa icon={faCodePullRequest} size="lg" />
      <h2 class="text-lg font-semibold">Create Pull Request</h2>
      {#if ctx.workspace?.branch}
        <Badge variant="secondary" class="text-xs">
          <Fa icon={faCodeBranch} size="xs" class="mr-1" />
          {ctx.workspace.branch}
        </Badge>
      {/if}
    </div>
    {#if onClose}
      <Button variant="ghost" size="icon-sm" onclick={onClose}>
        <Fa icon={faXmark} size="sm" />
      </Button>
    {/if}
  </div>

  <!-- Content -->
  <div class="flex-1 overflow-y-auto">
    <div class="max-w-4xl mx-auto p-6 space-y-6">
      {#if error}
        <div class="flex items-start gap-2 p-3 bg-destructive/10 text-destructive-foreground rounded-lg">
          <Fa icon={faExclamationCircle} size="sm" class="mt-0.5" />
          <span class="text-sm">{error}</span>
        </div>
      {/if}

      {#if success}
        <div class="flex items-center gap-2 p-4 bg-green-500/10 text-green-600 rounded-lg">
          <Fa icon={faCircleCheck} size="lg" />
          <span>Pull request created successfully!</span>
        </div>
      {:else}
        <!-- User Instructions -->
        <div class="space-y-2">
          <label for="user-instructions" class="text-sm font-medium flex items-center gap-2">
            <Fa icon={faInfo} size="sm" />
            Additional Instructions (optional)
          </label>
          <Textarea
            id="user-instructions"
            bind:value={userInstructions}
            placeholder="Add any specific instructions for generating the PR content..."
            class="min-h-[80px]"
            disabled={generatingContent || creatingPR}
          />
        </div>

        <!-- Title Field -->
        <div class="space-y-2">
          <label for="pr-title" class="text-sm font-medium">Title</label>
          {#if formData.title.loading}
            <Skeleton class="h-10 w-full" />
          {:else}
            <Input
              id="pr-title"
              bind:value={formData.title.value}
              placeholder="Enter pull request title..."
              disabled={creatingPR}
            />
          {/if}
        </div>

        <!-- Description Field -->
        <div class="space-y-2">
          <label for="pr-description" class="text-sm font-medium">Description</label>
          {#if formData.description.loading}
            <div class="space-y-2">
              <Skeleton class="h-4 w-full" />
              <Skeleton class="h-4 w-3/4" />
              <Skeleton class="h-4 w-5/6" />
              <Skeleton class="h-4 w-2/3" />
            </div>
          {:else}
            <Textarea
              id="pr-description"
              bind:value={formData.description.value}
              placeholder="Enter pull request description..."
              class="min-h-[200px] font-mono text-sm"
              disabled={creatingPR}
            />
          {/if}
        </div>

        <!-- Draft Option -->
        <label class="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            bind:checked={formData.isDraft}
            disabled={creatingPR || generatingContent}
            class="rounded border-border"
          />
          <span class="text-sm">Create as draft pull request</span>
        </label>
      {/if}
    </div>
  </div>

  <!-- Footer -->
  {#if !success}
    <div class="flex items-center justify-between px-6 py-4 border-t border-border">
      <div class="text-xs text-subtle">
        {#if generatingContent && autoCreatePending}
          Generating and creating PR...
        {:else if generatingContent}
          Generating PR content from workspace changes...
        {:else if creatingPR}
          Creating pull request...
        {:else if formData.title.value}
          Review the generated content and make any necessary edits
        {:else}
          Fill in the PR details or use auto-fill
        {/if}
      </div>
      <div class="flex gap-2">
        {#if onClose}
          <Button variant="outline" onclick={onClose} disabled={creatingPR || generatingContent}
            >Cancel</Button
          >
        {/if}
        <Button
          onclick={generatePRContent}
          disabled={generatingContent || creatingPR}
          variant="ghost"
          class="gap-1.5"
        >
          {#if generatingContent && !autoCreatePending}
            <Fa icon={faSpinner} size="sm" class="animate-spin" />
            Generating...
          {:else}
            <Fa icon={faMagic} size="sm" />
            Auto-fill
          {/if}
        </Button>
        <Button
          onclick={generateAndCreate}
          disabled={generatingContent || creatingPR}
          variant="outline"
          class="gap-1.5"
        >
          {#if autoCreatePending}
            <Fa icon={faSpinner} size="sm" class="animate-spin" />
            {generatingContent ? 'Generating...' : 'Creating...'}
          {:else}
            <Fa icon={faMagic} size="sm" />
            Auto-fill & Create
          {/if}
        </Button>
        <Button
          onclick={createPullRequest}
          disabled={generatingContent || creatingPR || !formData.title.value}
        >
          {#if creatingPR && !autoCreatePending}
            <Fa icon={faSpinner} size="sm" class="animate-spin" />
            Creating...
          {:else}
            <Fa icon={faPaperPlane} size="sm" />
            Create
          {/if}
        </Button>
      </div>
    </div>
  {/if}
</div>
