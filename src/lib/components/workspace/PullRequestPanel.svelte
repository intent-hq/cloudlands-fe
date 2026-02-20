<script lang="ts">
  import { tick } from 'svelte';
  import { logger } from '$lib/utils/client-logger';

  import { getWorkspaceContext } from '$features/workspace/workspace.context.svelte';
  import { invoke } from '$lib/electron-bridge';
  import { Button } from '$lib/components/ui/button';
  import { toast } from '$lib/components/ui/toast';
  import { Input } from '$lib/components/ui/input';
  import { Textarea } from '$lib/components/ui/textarea';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { Badge } from '$lib/components/ui/badge';
  import CollapsiblePanel from '$lib/components/ui/CollapsiblePanel.svelte';
  import Fa from 'svelte-fa';
  import {
    faCodePullRequest,
    faExternalLinkAlt,
    faExclamationCircle,
    faCircleCheck,
    faTimesCircle,
    faClock,
    faCodeMerge,
    faCommentDots,
    faPlus,
    faMagic,
    faPaperPlane,
    faSpinner,
    faCodeBranch,
    faUsers,
    faTag,
    faFileAlt,
    faCheckCircle,
    faExclamationTriangle,
    faComment,
    faWandMagicSparkles,
    faArrowsRotate,
  } from '@fortawesome/free-solid-svg-icons';
  import type { PullRequestInfo } from '$shared/types';
  import type { WorkspaceId } from '$shared/types/branded-ids';
  import {
    refreshPRStatus,
    startPRStatusPolling,
    registerWindowFocusRefresh,
  } from '$features/git-tracking/pr-status.service';
  import { githubAuthStore } from '$features/github-auth/renderer/github-auth.store.svelte';
  import GitHubAuthModal from '$lib/components/GitHubAuthModal.svelte';
  import { handleLink } from '$features/navigation/link-handler';

  let ctx = $state<ReturnType<typeof getWorkspaceContext>>(null as any);
  // Associate labels with form controls for better a11y

  // Get context - it should be available since parent component sets it during initialization
  try {
    ctx = getWorkspaceContext();
  } catch (e) {
    logger.error('Failed to get workspace context in PullRequestPanel:', e);
    throw e;
  }

  // Form state
  let showCreateForm = $state(false);
  let generatingContent = $state(false);
  let creatingPR = $state(false);
  let error: string | null = $state(null);

  // PR Form fields with skeleton states
  let formData = $state({
    title: { value: '', loading: false },
    description: { value: '', loading: false },
    isDraft: false,
    assignees: { value: [] as string[], loading: false },
    reviewers: { value: [] as string[], loading: false },
    labels: { value: [] as string[], loading: false },
  });

  // User instructions for PR generation
  let userInstructions = $state('');
  let showInstructionsInput = $state(false);

  // Streaming content parser state
  let streamBuffer = $state('');
  let lastParsedIndex = $state(0);

  async function generatePRContent() {
    if (!ctx || !ctx.workspace) return;

    generatingContent = true;
    error = null;

    // Reset form and set all fields to loading
    formData = {
      title: { value: '', loading: true },
      description: { value: '', loading: true },
      isDraft: false,
      assignees: { value: [], loading: true },
      reviewers: { value: [], loading: true },
      labels: { value: [], loading: true },
    };

    try {
      // Collect workspace context for the agent
      // Create a clean, serializable version to avoid "object could not be cloned" errors
      const workspaceContext = {
        workspaceId: ctx.workspace.id,
        title: ctx.workspace.title,
        branch: ctx.workspace.branch,
        baseRef: ctx.workspace.baseRef,
        repositoryPath: ctx.workspace.repositoryPath,
        repositoryOwner: ctx.workspace.repositoryOwner,
        repositoryName: ctx.workspace.repositoryName,
        userInstructions: userInstructions || undefined,
        requestFormat: {
          title: 'string',
          description: 'string (markdown)',
          assignees: 'string[]',
          reviewers: 'string[]',
          labels: 'string[]',
          isDraft: 'boolean',
        },
      };

      // Get code changes summary
      const changesResponse = (await invoke('get_workspace_changes', {
        workspaceId: ctx.workspace.id,
      })) as { data?: any };

      // Call agent to generate PR content
      const response = (await invoke('generate_pr_content', {
        workspaceContext,
        changes: changesResponse.data,
        streamResponse: true,
      })) as {
        success?: boolean;
        error?: string;
        stream?: ReadableStream;
        data?: any;
      };

      // Check for error response
      if (response.success === false) {
        throw new Error(response.error || 'Failed to generate PR content');
      }

      // Handle streaming response
      if (response.stream) {
        handleStreamingResponse(response.stream);
      } else if (response.data) {
        // Handle non-streaming response
        updateFormFromData(response.data);
      } else {
        throw new Error('No response data received from PR generation');
      }
    } catch (err) {
      logger.error('Failed to generate PR content:', err);
      error = err instanceof Error ? err.message : 'Failed to generate content';

      // Reset form to allow retry
      formData = {
        title: { value: '', loading: false },
        description: { value: '', loading: false },
        isDraft: false,
        assignees: { value: [], loading: false },
        reviewers: { value: [], loading: false },
        labels: { value: [], loading: false },
      };
    } finally {
      generatingContent = false;
    }
  }

  function handleStreamingResponse(stream: ReadableStream) {
    const reader = stream.getReader();
    const decoder = new TextDecoder();

    function read() {
      reader.read().then(({ done, value }) => {
        if (done) {
          // Parse any remaining buffer
          parseStreamBuffer();
          return;
        }

        streamBuffer += decoder.decode(value, { stream: true });
        parseStreamBuffer();
        read();
      });
    }

    read();
  }

  function parseStreamBuffer() {
    // Try to parse JSON chunks from the buffer
    try {
      // Look for complete JSON objects in the buffer
      const lines = streamBuffer.split('\n');

      for (const line of lines) {
        if (line.trim().startsWith('{') && line.trim().endsWith('}')) {
          try {
            const data = JSON.parse(line);
            updateFormFieldFromStream(data);
          } catch (e) {
            // Invalid JSON, continue
          }
        }
      }

      // Keep unparsed content in buffer
      const lastNewline = streamBuffer.lastIndexOf('\n');
      if (lastNewline > -1) {
        streamBuffer = streamBuffer.substring(lastNewline + 1);
      }
    } catch (err) {
      logger.error('Stream parsing error:', err);
    }
  }

  function updateFormFieldFromStream(data: any) {
    // Update specific fields as they arrive
    if (data.field && data.value !== undefined) {
      switch (data.field) {
        case 'title':
          formData.title = { value: data.value, loading: false };
          break;
        case 'description':
          formData.description = { value: data.value, loading: false };
          break;
        case 'assignees':
          formData.assignees = { value: data.value || [], loading: false };
          break;
        case 'reviewers':
          formData.reviewers = { value: data.value || [], loading: false };
          break;
        case 'labels':
          formData.labels = { value: data.value || [], loading: false };
          break;
        case 'isDraft':
          formData.isDraft = data.value;
          break;
      }
    }
  }

  function updateFormFromData(data: any) {
    formData = {
      title: { value: data.title || '', loading: false },
      description: { value: data.description || '', loading: false },
      isDraft: data.isDraft || false,
      assignees: { value: data.assignees || [], loading: false },
      reviewers: { value: data.reviewers || [], loading: false },
      labels: { value: data.labels || [], loading: false },
    };
  }

  async function createPullRequest() {
    if (!ctx || !ctx.workspace || !formData.title.value) return;

    creatingPR = true;
    error = null;

    try {
      // Extract owner and repo from workspace
      if (!ctx.workspace.repositoryOwner || !ctx.workspace.repositoryName) {
        throw new Error('Repository owner and name are required to create a pull request');
      }

      const response = (await invoke('git-tracking:create-pull-request', {
        owner: ctx.workspace.repositoryOwner,
        repo: ctx.workspace.repositoryName,
        options: {
          title: formData.title.value,
          body: formData.description.value,
          head: ctx.workspace.branch,
          base: ctx.workspace.baseRef || 'main',
          draft: formData.isDraft,
        },
      })) as {
        success?: boolean;
        data?: any;
      };

      if (response.success && response.data) {
        // Update workspace with PR info
        await invoke('workspace:update', {
          id: ctx.workspace.id,
          activePullRequest: response.data,
          prNumber: response.data.number,
          prUrl: response.data.html_url,
        });

        // Reset form
        showCreateForm = false;
        formData = {
          title: { value: '', loading: false },
          description: { value: '', loading: false },
          isDraft: false,
          assignees: { value: [], loading: false },
          reviewers: { value: [], loading: false },
          labels: { value: [], loading: false },
        };
      }
    } catch (err) {
      logger.error('Failed to create PR:', err);
      error = err instanceof Error ? err.message : 'Failed to create pull request';
    } finally {
      creatingPR = false;
    }
  }

  // PR status refresh state
  let isRefreshingPR = $state(false);
  let showGitHubAuthModal = $state(false);
  const githubAuthState = $derived(githubAuthStore.state);

  // Handle manual PR status refresh
  async function handleRefreshPRStatus() {
    if (isRefreshingPR || !ctx?.workspace?.id) return;
    isRefreshingPR = true;
    const refreshStart = Date.now();
    await tick();

    try {
      // Check GitHub authentication first
      if (!githubAuthState.isAuthenticated) {
        try {
          await githubAuthStore.initialize();
        } catch (error) {
          logger.warn('[PullRequestPanel] Failed to refresh GitHub auth state', error);
        }
      }

      if (!githubAuthState.isAuthenticated) {
        showGitHubAuthModal = true;
        toast.info('GitHub auth required to refresh PR status');
        return;
      }

      const result = await refreshPRStatus(ctx.workspace.id as WorkspaceId, { force: true });
      if (!result.success) {
        logger.warn('[PullRequestPanel] Failed to refresh PR status:', result.error);
        toast.error(result.error || 'Failed to refresh PR status');
      } else if (result.skipped) {
        toast.info(result.skipReason || 'PR refresh skipped');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to refresh PR status';
      logger.warn('[PullRequestPanel] Failed to refresh PR status:', error);
      toast.error(message);
    } finally {
      const elapsed = Date.now() - refreshStart;
      if (elapsed < 300) {
        await new Promise((resolve) => setTimeout(resolve, 300 - elapsed));
      }
      isRefreshingPR = false;
    }
  }

  function handleGitHubAuthModalClose() {
    showGitHubAuthModal = false;
  }

  function handleGitHubAuthModalSuccess() {
    showGitHubAuthModal = false;
    if (githubAuthState.isAuthenticated) {
      handleRefreshPRStatus();
    }
  }

  // Set up PR status polling and window focus refresh when we have an active PR
  $effect(() => {
    if (ctx?.workspace?.activePullRequest && ctx.workspace.id) {
      const workspaceId = ctx.workspace.id as WorkspaceId;
      // Start polling
      const stopPolling = startPRStatusPolling(workspaceId);
      // Register window focus listener
      const unregisterFocus = registerWindowFocusRefresh(workspaceId);

      return () => {
        stopPolling();
        unregisterFocus();
      };
    }
  });

  function getPRStatusIcon(status: string) {
    switch (status) {
      case 'Open':
        return faCodePullRequest;
      case 'Draft':
        return faFileAlt;
      case 'Merged':
        return faCodeMerge;
      case 'Closed':
        return faTimesCircle;
      default:
        return faCodePullRequest;
    }
  }

  function getPRStatusColor(status: string) {
    switch (status) {
      case 'Open':
        return 'text-green-500';
      case 'Draft':
        return 'text-gray-500';
      case 'Merged':
        return 'text-purple-500';
      case 'Closed':
        return 'text-red-500';
      default:
        return 'text-gray-500';
    }
  }
</script>

<div class="flex flex-col border-b border-border">
  <!-- Custom Header -->
  <div class="px-4 py-2 flex items-center justify-between hover:bg-muted/50 transition-colors">
    <h3 class="text-xs font-medium text-muted-foreground uppercase tracking-wider">Pull Request</h3>
    {#if !ctx?.workspace?.activePullRequest && !showCreateForm}
      <Button variant="ghost-light" size="sm" onclick={() => (showCreateForm = true)}>
        <Fa icon={faPlus} size="sm" />
        Create
      </Button>
    {/if}
  </div>

  <!-- Content -->
  {#if ctx?.workspace?.activePullRequest || showCreateForm}
    <div class="p-4 space-y-4">
      {#if ctx?.workspace?.activePullRequest}
        <!-- Existing PR Display -->
        <div class="space-y-3">
          <div class="flex items-start justify-between">
            <div class="flex-1 space-y-2">
              <div class="flex items-center gap-2">
                <Fa
                  icon={getPRStatusIcon(ctx.workspace.activePullRequest.status)}
                  size="sm"
                  class={getPRStatusColor(ctx.workspace.activePullRequest.status)}
                />
                <span class="font-medium text-sm">
                  #{ctx.workspace.activePullRequest.number}
                </span>
                <Badge variant="outline" class="text-xs">
                  {ctx.workspace.activePullRequest.status}
                </Badge>
              </div>
              <h4 class="text-sm font-medium">
                {ctx.workspace.activePullRequest.title}
              </h4>
            </div>
            <div class="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onclick={() => handleRefreshPRStatus()}
                disabled={isRefreshingPR}
                class="gap-1 cursor-pointer"
                title="Refresh PR status"
              >
                <Fa
                  icon={faArrowsRotate}
                  class="opacity-50 text-[10px] {isRefreshingPR ? 'animate-spin' : ''}"
                />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onclick={(e) => {
                  handleLink(ctx.workspace!.activePullRequest!.url, {
                    workspaceId: ctx.workspace!.id as WorkspaceId,
                    event: e,
                  });
                }}
                class="gap-1"
              >
                <Fa icon={faExternalLinkAlt} size="sm" />
                View
              </Button>
            </div>
          </div>

          <!-- PR Status Indicators -->
          {#if ctx.workspace.activePullRequest.checks}
            <div class="flex items-center gap-4 text-xs">
              {#if ctx.workspace.activePullRequest.checks.failed > 0}
                <div class="flex items-center gap-1 text-red-500">
                  <Fa icon={faTimesCircle} size="sm" />
                  {ctx.workspace.activePullRequest.checks.failed} failed
                </div>
              {/if}
              {#if ctx.workspace.activePullRequest.checks.passed > 0}
                <div class="flex items-center gap-1 text-green-500">
                  <Fa icon={faCheckCircle} size="xs" />
                  {ctx.workspace.activePullRequest.checks.passed} passed
                </div>
              {/if}
              {#if ctx.workspace.activePullRequest.checks.pending > 0}
                <div class="flex items-center gap-1 text-yellow-500">
                  <Fa icon={faClock} size="xs" />
                  {ctx.workspace.activePullRequest.checks.pending} pending
                </div>
              {/if}
            </div>
          {/if}

          <!-- Merge Conflicts Warning -->
          {#if ctx.workspace.activePullRequest.mergeConflicts}
            <div
              class="flex items-center gap-2 p-2 bg-red-50 dark:bg-red-950 rounded text-xs text-red-600 dark:text-red-400"
            >
              <Fa icon={faExclamationTriangle} size="xs" />
              Merge conflicts detected
              <Button
                variant="ghost"
                size="sm"
                onclick={() =>
                  invoke('resolve_merge_conflicts', {
                    workspaceId: ctx.workspace?.id,
                  })}
                class="ml-auto text-xs h-6"
              >
                Resolve
              </Button>
            </div>
          {/if}

          <!-- PR Stats -->
          <div class="flex items-center gap-4 text-xs text-muted-foreground">
            {#if ctx.workspace.activePullRequest.additions}
              <span class="text-green-600">
                +{ctx.workspace.activePullRequest.additions}
              </span>
            {/if}
            {#if ctx.workspace.activePullRequest.deletions}
              <span class="text-red-600">
                -{ctx.workspace.activePullRequest.deletions}
              </span>
            {/if}
            {#if ctx.workspace.activePullRequest.changedFiles}
              <span>{ctx.workspace.activePullRequest.changedFiles} files</span>
            {/if}
            {#if ctx.workspace.activePullRequest.comments}
              <div class="flex items-center gap-1">
                <Fa icon={faCommentDots} size="xs" />
                {ctx.workspace.activePullRequest.comments}
              </div>
            {/if}
          </div>
        </div>

        <!-- Additional PRs -->
        {#if ctx.workspace.pullRequests && ctx.workspace.pullRequests.length > 1}
          <div class="border-t border-border pt-3">
            <h5 class="text-xs font-medium mb-2">Other Pull Requests</h5>
            <div class="space-y-1">
              {#each ctx.workspace.pullRequests.filter((pr) => pr.id !== ctx.workspace?.activePullRequest?.id) as pr (pr.id)}
                <div class="flex items-center justify-between text-xs">
                  <div class="flex items-center gap-2">
                    <Fa
                      icon={getPRStatusIcon(pr.status)}
                      size="xs"
                      class={getPRStatusColor(pr.status)}
                    />
                    <span>#{pr.number}</span>
                    <span class="text-muted-foreground truncate max-w-[150px]">
                      {pr.title}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onclick={(e) => {
                      handleLink(pr.url, {
                        workspaceId: ctx.workspace!.id as WorkspaceId,
                        event: e,
                      });
                    }}
                    class="h-6 w-6 p-0"
                  >
                    <Fa icon={faExternalLinkAlt} size="xs" />
                  </Button>
                </div>
              {/each}
            </div>
          </div>
        {/if}
      {:else if showCreateForm}
        <!-- PR Creation Form -->
        <div class="space-y-4">
          {#if showInstructionsInput}
            <div class="space-y-2">
              <label for="pr-instructions" class="text-xs font-medium"
                >Instructions (optional)</label
              >
              <Textarea
                id="pr-instructions"
                bind:value={userInstructions}
                placeholder="e.g., Create as draft, add specific reviewers, mention breaking changes..."
                class="min-h-[60px] text-xs"
              />
            </div>
          {:else}
            <button
              type="button"
              onclick={() => (showInstructionsInput = true)}
              class="text-xs text-muted-foreground hover:text-foreground"
            >
              + Add instructions
            </button>
          {/if}

          {#if !generatingContent && formData.title.value === ''}
            <Button onclick={generatePRContent} disabled={generatingContent} class="w-full gap-2">
              <Fa icon={faWandMagicSparkles} size="sm" />
              Generate PR Content
            </Button>
          {/if}

          {#if generatingContent || formData.title.value !== '' || formData.title.loading}
            <div class="space-y-3">
              <!-- Title Field -->
              <div class="space-y-2">
                <label for="pr-title" class="text-xs font-medium">Title</label>
                {#if formData.title.loading}
                  <Skeleton class="h-9 w-full" />
                {:else}
                  <Input bind:value={formData.title.value} placeholder="PR title" class="text-sm" />
                {/if}
              </div>

              <!-- Description Field -->
              <div class="space-y-2">
                <label for="pr-description" class="text-xs font-medium">Description</label>
                {#if formData.description.loading}
                  <Skeleton class="h-24 w-full" />
                {:else}
                  <Textarea
                    id="pr-description"
                    bind:value={formData.description.value}
                    placeholder="PR description (supports markdown)"
                    class="min-h-[100px] text-sm"
                  />
                {/if}
              </div>

              <!-- Assignees Field -->
              <div class="space-y-2">
                <label for="pr-assignees" class="text-xs font-medium flex items-center gap-1">
                  <Fa icon={faUsers} size="xs" />
                  Assignees
                </label>
                {#if formData.assignees.loading}
                  <Skeleton class="h-9 w-full" />
                {:else}
                  <Input
                    id="pr-assignees"
                    value={formData.assignees.value.join(', ')}
                    onchange={(e) => {
                      formData.assignees.value = e.currentTarget.value
                        .split(',')
                        .map((s) => s.trim())
                        .filter(Boolean);
                    }}
                    placeholder="user1, user2..."
                    class="text-sm"
                  />
                {/if}
              </div>

              <!-- Reviewers Field -->
              <div class="space-y-2">
                <label for="pr-reviewers" class="text-xs font-medium flex items-center gap-1">
                  <Fa icon={faUsers} size="xs" />
                  Reviewers
                </label>
                {#if formData.reviewers.loading}
                  <Skeleton class="h-9 w-full" />
                {:else}
                  <Input
                    id="pr-reviewers"
                    value={formData.reviewers.value.join(', ')}
                    onchange={(e) => {
                      formData.reviewers.value = e.currentTarget.value
                        .split(',')
                        .map((s) => s.trim())
                        .filter(Boolean);
                    }}
                    placeholder="reviewer1, reviewer2..."
                    class="text-sm"
                  />
                {/if}
              </div>

              <!-- Labels Field -->
              <div class="space-y-2">
                <label for="pr-labels" class="text-xs font-medium flex items-center gap-1">
                  <Fa icon={faTag} size="xs" />
                  Labels
                </label>
                {#if formData.labels.loading}
                  <Skeleton class="h-9 w-full" />
                {:else}
                  <Input
                    id="pr-labels"
                    value={formData.labels.value.join(', ')}
                    onchange={(e) => {
                      formData.labels.value = e.currentTarget.value
                        .split(',')
                        .map((s) => s.trim())
                        .filter(Boolean);
                    }}
                    placeholder="bug, enhancement, documentation..."
                    class="text-sm"
                  />
                {/if}
              </div>

              <!-- Draft Checkbox -->
              <div class="flex items-center gap-2">
                <input
                  type="checkbox"
                  bind:checked={formData.isDraft}
                  id="draft-pr"
                  class="h-4 w-4"
                />
                <label for="draft-pr" class="text-xs"> Create as draft pull request </label>
              </div>

              <!-- Action Buttons -->
              <div class="flex gap-2 justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onclick={createPullRequest}
                  disabled={creatingPR || !formData.title.value || generatingContent}
                  class="gap-2"
                >
                  {#if creatingPR}
                    <Fa icon={faSpinner} size="sm" class="animate-spin" />
                    Creating...
                  {:else}
                    <Fa icon={faPaperPlane} size="sm" />
                    Create Pull Request
                  {/if}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onclick={() => {
                    showCreateForm = false;
                    formData = {
                      title: { value: '', loading: false },
                      description: { value: '', loading: false },
                      isDraft: false,
                      assignees: { value: [], loading: false },
                      reviewers: { value: [], loading: false },
                      labels: { value: [], loading: false },
                    };
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          {/if}

          {#if error}
            <div class="text-xs text-red-500 bg-red-50 dark:bg-red-950 p-2 rounded">
              {error}
            </div>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</div>

{#if showGitHubAuthModal}
  <GitHubAuthModal
    open={showGitHubAuthModal}
    onClose={handleGitHubAuthModalClose}
    onSuccess={handleGitHubAuthModalSuccess}
  />
{/if}
