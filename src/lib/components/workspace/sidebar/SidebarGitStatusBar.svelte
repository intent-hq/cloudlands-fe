<script lang="ts">
  /**
   * SidebarGitStatusBar - Horizontal bar showing commits to push and PRs
   */
  import { tick } from 'svelte';
  import Fa from 'svelte-fa';
  import {
    faCodeCommit,
    faCodePullRequest,
    faArrowUp,
    faSpinner,
    faArrowsRotate,
    faExclamationTriangle,
  } from '@fortawesome/free-solid-svg-icons';
  import { Button } from '$lib/components/ui/button';
  import { gitStore } from '$features/git/git.store.svelte';
  import { gitClient } from '$features/git/git.client';
  import { gitCache } from '$features/git/git-cache';
  import { fileTrackingStore } from '$features/file-tracking/file-tracking.store.svelte';
  import { AcceptChangesClient } from '$features/accept-changes/accept-changes.client';
  import type { WorkspaceId } from '$shared/types/branded-ids';
  import { toast } from 'svelte-sonner';
  import type { PRInfo } from '$lib/components/file-tracking/accept-changes/types';
  import { workspaceStore } from '$features/workspace/workspace.store.svelte';
  import { refreshPRStatus } from '$features/git-tracking/pr-status.service';
  import { githubAuthStore } from '$features/github-auth/renderer/github-auth.store.svelte';
  import GitHubAuthModal from '$lib/components/GitHubAuthModal.svelte';
  import { terminalOverlayStore } from '$lib/stores/terminal-overlay.store.svelte';
  import { logger } from '$lib/utils/client-logger';
  import DividerButton from './DividerButton.svelte';
  import DividerPanel from './DividerPanel.svelte';

  interface Props {
    workspaceId: string;
  }

  let { workspaceId }: Props = $props();

  // Get workspace for PR info
  const workspace = $derived(workspaceStore.findById(workspaceId as WorkspaceId));

  // Get unpushed commit count from git status
  const unpushedCount = $derived(gitStore.ahead);

  // Pull requests from workspace - derive from activePullRequest
  const pullRequests = $derived<PRInfo[]>(
    workspace?.activePullRequest
      ? [
          {
            number: workspace.activePullRequest.number,
            title: workspace.activePullRequest.title,
            url: workspace.activePullRequest.url,
            htmlUrl: workspace.activePullRequest.url,
            status:
              workspace.activePullRequest.status === 'Open'
                ? 'open'
                : workspace.activePullRequest.status === 'Merged'
                  ? 'merged'
                  : workspace.activePullRequest.status === 'Draft'
                    ? 'draft'
                    : 'closed',
            createdAt: workspace.activePullRequest.createdAt,
            updatedAt: workspace.activePullRequest.updatedAt,
          },
        ]
      : [],
  );

  // Check if PR is merged or closed - don't show push button in these cases
  const isPRMerged = $derived(pullRequests.length > 0 && pullRequests[0].status === 'merged');
  const isPRClosed = $derived(pullRequests.length > 0 && pullRequests[0].status === 'closed');
  const isPRFinished = $derived(isPRMerged || isPRClosed);

  // Only show unpushed commits if PR is not finished
  const hasCommits = $derived(unpushedCount > 0 && !isPRFinished);
  const hasPRs = $derived(pullRequests.length > 0);
  const hasContent = $derived(hasCommits || hasPRs);

  let isPushing = $state(false);
  let isRefreshingPR = $state(false);
  let showGitHubAuthModal = $state(false);
  let forcePushDrawerOpen = $state(false);
  let isForcePushing = $state(false);
  const githubAuthState = $derived(githubAuthStore.state);

  // Check if branches have diverged (need force push)
  const isDiverged = $derived(gitStore.status?.diverged ?? false);

  // Debug logging for divergence detection
  $effect(() => {
    console.log('[SidebarGitStatusBar] gitStore.status:', {
      branch: gitStore.status?.branch,
      ahead: gitStore.status?.ahead,
      behind: gitStore.status?.behind,
      diverged: gitStore.status?.diverged,
    });
  });

  /**
   * Opens a terminal to run the git pull command, so the user can see the output
   * and resolve any conflicts if needed.
   */
  async function openPullTerminal() {
    if (!workspaceId) return;

    const worktreePath = workspace?.worktreePath || workspace?.repositoryPath;
    if (!worktreePath) {
      toast.error('Cannot find space path');
      return;
    }

    try {
      // Use workspace.branch which is the remote feature branch name (e.g., "add-dark-mode")
      // This is different from the local worktree branch name (e.g., "dark-mode-6inv")
      // The push targets workspace.branch, so we need to pull from the same remote branch
      const remoteBranch = workspace?.branch || 'HEAD';
      const pullCommand = `git pull --rebase origin ${remoteBranch}`;

      // Create terminal with the pull command
      const result = await window.electronAPI.invoke('terminal:createWithCommand', {
        workspaceId,
        command: pullCommand,
        cwd: worktreePath,
        title: `Pull from origin/${remoteBranch}`,
      });

      if (result.ok && result.terminalId) {
        // Open the terminal in the quake terminal bar
        terminalOverlayStore.addTerminal(result.terminalId, `Pull from origin/${remoteBranch}`);
        terminalOverlayStore.open(workspaceId, result.terminalId);

        toast.success('Pull started in terminal', {
          description: 'After pull completes, click Refresh then retry push.',
          action: {
            label: 'Refresh',
            onClick: async () => {
              gitCache.invalidate(`git-status-${workspaceId}`);
              await Promise.all([
                gitStore.loadStatus(workspaceId as WorkspaceId, true),
                fileTrackingStore.refresh(),
              ]);
              toast.success('Git status refreshed');
            },
          },
          duration: 30000, // Keep toast visible longer
        });
      } else {
        toast.error(result.error || 'Failed to open terminal');
      }
    } catch (error) {
      logger.error('Failed to open pull terminal', error as Error);
      toast.error('Failed to open terminal');
    }
  }

  async function handlePush() {
    if (!hasCommits) return;
    isPushing = true;
    try {
      const result = await AcceptChangesClient.execute(workspaceId as WorkspaceId, 'push');
      if (result.success) {
        toast.success('Changes pushed');
        // Invalidate cache and refresh stores to update UI (don't await - let UI update reactively)
        gitCache.invalidate(`git-status-${workspaceId}`);
        Promise.all([
          gitStore.loadStatus(workspaceId as WorkspaceId, true),
          fileTrackingStore.refresh(),
        ]);
      } else {
        const errorMsg = result.error || 'Failed to push changes';
        logger.info('[SidebarGitStatusBar] Push failed with error:', { errorMsg });
        // Check if this is a diverged branch error - offer to pull in terminal
        if (errorMsg.includes('Pull the latest changes') || errorMsg.includes('behind')) {
          logger.info('[SidebarGitStatusBar] Showing toast with Pull in Terminal action');
          toast.error('Remote has new commits', {
            description: 'Pull the latest changes before pushing.',
            action: {
              label: 'Pull in Terminal',
              onClick: () => openPullTerminal(),
            },
            duration: 10000,
          });
        } else {
          toast.error(errorMsg);
        }
      }
    } catch (error) {
      toast.error('Failed to push changes');
    } finally {
      isPushing = false;
    }
  }

  async function handleRefreshPRStatus() {
    if (isRefreshingPR) return;
    isRefreshingPR = true;
    const refreshStart = Date.now();
    await tick();

    try {
      // Check GitHub authentication first
      if (!githubAuthState.isAuthenticated) {
        try {
          await githubAuthStore.initialize();
        } catch (error) {
          console.warn('[SidebarGitStatusBar] Failed to refresh GitHub auth state', error);
        }
      }

      if (!githubAuthState.isAuthenticated) {
        showGitHubAuthModal = true;
        return;
      }

      // Fetch remote changes first to update remote tracking branches
      // This ensures divergence detection works correctly
      try {
        const fetchResult = await gitClient.fetch(workspaceId as WorkspaceId);
        if (!fetchResult.ok) {
          // Log but don't block - fetch failures (network, auth) shouldn't prevent status refresh
          logger.warn('[SidebarGitStatusBar] Git fetch failed:', { error: fetchResult.error });
        }
      } catch (error) {
        logger.warn('[SidebarGitStatusBar] Git fetch error:', error);
      }

      // Refresh git status after fetch to get updated ahead/behind counts
      gitCache.invalidate(`git-status-${workspaceId}`);
      await gitStore.loadStatus(workspaceId as WorkspaceId, true);

      // Now refresh PR status
      const result = await refreshPRStatus(workspaceId as WorkspaceId, { force: true });
      if (!result.success && result.error) {
        toast.error('Failed to refresh PR status');
      }
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

  async function handleForcePush() {
    isForcePushing = true;
    try {
      const result = await gitStore.push(workspaceId as WorkspaceId, true);
      if (result.ok) {
        toast.warning('Force push completed');
        forcePushDrawerOpen = false;
        // Invalidate cache and refresh stores to update UI
        gitCache.invalidate(`git-status-${workspaceId}`);
        Promise.all([
          gitStore.loadStatus(workspaceId as WorkspaceId, true),
          fileTrackingStore.refresh(),
        ]);
      } else {
        toast.error(result.error || 'Force push failed');
      }
    } catch (error) {
      logger.error('Force push failed', error as Error);
      toast.error('Force push failed');
    } finally {
      isForcePushing = false;
    }
  }

  function handleCancelForcePush() {
    forcePushDrawerOpen = false;
  }
</script>

{#if hasContent || isDiverged}
  <div class="flex flex-col border-b border-border/50 bg-muted/20">
    <div class="flex items-center gap-3 px-3.5 py-2">
      <!-- Commits -->
      {#if hasCommits}
        <div class="flex items-center gap-2">
          <div class="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Fa icon={faCodeCommit} size="xs" class="opacity-50" />
            <span>{unpushedCount} commit{unpushedCount === 1 ? '' : 's'}</span>
          </div>
          <Button
            variant="ghost"
            size="xs"
            class="h-5 px-2 text-[10px]"
            onclick={handlePush}
            disabled={isPushing}
          >
            {#if isPushing}
              <Fa icon={faSpinner} size="xs" class="animate-spin mr-1" />
            {:else}
              <Fa icon={faArrowUp} size="xs" class="mr-1" />
            {/if}
            Push
          </Button>
        </div>
      {/if}

      <!-- PRs -->
      {#if hasPRs}
        {@const prStatus = pullRequests[0].status}
        {@const prColor =
          prStatus === 'open'
            ? 'text-emerald-500/70'
            : prStatus === 'merged'
              ? 'text-purple-500'
              : prStatus === 'closed'
                ? 'text-red-500'
                : 'text-muted-foreground'}
        {@const prLabel =
          prStatus === 'merged' ? 'Merged' : prStatus === 'closed' ? 'Closed' : 'PR'}
        <div class="flex items-center gap-2">
          <div class="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Fa icon={faCodePullRequest} size="xs" class={prColor} />
            <span class={prColor}>{prLabel}</span>
          </div>
          <button
            type="button"
            class="p-0.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground disabled:opacity-50 cursor-pointer"
            onclick={() => handleRefreshPRStatus()}
            disabled={isRefreshingPR}
            title="Refresh PR status"
          >
            <Fa
              icon={faArrowsRotate}
              class="opacity-50 text-[8px] {isRefreshingPR ? 'animate-spin' : ''}"
            />
          </button>
        </div>
      {/if}
    </div>

    <!-- Force Push Section - shown when branches have diverged -->
    {#if isDiverged}
      <div class="px-3.5 pb-2 flex flex-wrap items-start gap-2">
        <DividerButton
          onclick={() => {
            forcePushDrawerOpen = !forcePushDrawerOpen;
          }}
          expanded={forcePushDrawerOpen}
          showArrow={true}
        >
          <Fa icon={faExclamationTriangle} size="xs" class="text-amber-500" />
          <span class="text-amber-600 dark:text-amber-400">Force Push</span>
        </DividerButton>
        <DividerPanel open={forcePushDrawerOpen}>
          <div class="flex items-start gap-2 text-amber-600 dark:text-amber-400 mb-2">
            <Fa icon={faExclamationTriangle} size="sm" class="mt-0.5 flex-shrink-0" />
            <p class="text-xs">
              <strong>Warning:</strong> This will overwrite remote commits. Are you sure you want to
              force push?
            </p>
          </div>
          <p class="text-xs text-muted-foreground mb-3">
            Your local branch has diverged from the remote. Force pushing will replace the remote
            history with your local history.
          </p>
          <div class="flex items-center gap-2">
            <Button
              variant="destructive"
              size="xs"
              onclick={handleForcePush}
              disabled={isForcePushing}
            >
              {#if isForcePushing}
                <Fa icon={faSpinner} size="xs" class="animate-spin mr-1" />
                <span>Pushing...</span>
              {:else}
                <span>Yes, Force Push</span>
              {/if}
            </Button>
            <Button
              variant="outline"
              size="xs"
              onclick={handleCancelForcePush}
              disabled={isForcePushing}
            >
              Cancel
            </Button>
          </div>
        </DividerPanel>
      </div>
    {/if}
  </div>
{/if}

{#if showGitHubAuthModal}
  <GitHubAuthModal
    open={showGitHubAuthModal}
    onClose={handleGitHubAuthModalClose}
    onSuccess={handleGitHubAuthModalSuccess}
  />
{/if}
