<script lang="ts">
  /**
   * LinearPicker - Picker component for Linear issues
   *
   * Shows list of Linear issues with search/filter.
   * Handles authentication flow if not authenticated.
   */
  import {
  linearAuthClient,
  type LinearIssueResult,
} from '$features/linear-auth/renderer/linear-auth.client';
  import LinearIcon from '$lib/components/icons/LinearIcon.svelte';
  import { Input } from '$lib/components/ui/input';
  import { Button } from '$lib/components/ui/button';
  import {
  faSpinner,
  faSearch,
} from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { onMount } from 'svelte';
  import { createLogger } from '$lib/utils/client-logger';

  import { startLinearAuth } from '$store/renderer/slices/linear-auth/linear-auth-slice';
  import { store as appStore } from '$store/renderer/store';

  const logger = createLogger('LinearPicker');

  interface Props {
    workspaceId: string;
    onSelect: (item: { type: string; title: string; url: string; identifier: string; metadata?: Record<string, unknown> }) => void;
    onClose: () => void;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let { workspaceId, onSelect, onClose }: Props = $props();


  let isAuthenticated = $state(false);
  let issues = $state<LinearIssueResult[]>([]);
  let isLoading = $state(false);
  let searchQuery = $state('');
  let isConnecting = $state(false);

  const filteredIssues = $derived.by(() => {
    if (!searchQuery.trim()) return issues;
    const query = searchQuery.toLowerCase();
    return issues.filter(
      (issue) =>
        issue.title.toLowerCase().includes(query) ||
        issue.identifier.toLowerCase().includes(query) ||
        issue.teamName?.toLowerCase().includes(query),
    );
  });

  async function loadIssues() {
    try {
      // Initialize via Redux (fire-and-forget), then check auth state via client
      const authState = await linearAuthClient.getAuthState(true);
      isAuthenticated = authState.isAuthenticated;

      if (!isAuthenticated) {
        logger.info('Linear not authenticated');
        return;
      }

      isLoading = true;
      const result = await linearAuthClient.fetchMyIssues('all');
      issues = result;
      logger.info('Loaded Linear issues', { count: result.length });
    } catch (error) {
      logger.error('Failed to load Linear issues', error as Error);
    } finally {
      isLoading = false;
    }
  }

  async function handleConnect() {
    isConnecting = true;
    try {
      appStore.dispatch(startLinearAuth());
      // Wait a bit for auth to potentially complete, then re-check
      // The user will complete OAuth externally, so we poll
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const authState = await linearAuthClient.getAuthState(true);
      if (authState.isAuthenticated) {
        isAuthenticated = true;
        await loadIssues();
      }
    } catch (error) {
      logger.error('Linear auth failed', error as Error);
    } finally {
      isConnecting = false;
    }
  }

  function handleSelect(issue: LinearIssueResult) {
    onSelect({
      type: 'linear-issue',
      title: issue.title,
      url: issue.url || `https://linear.app/issue/${issue.identifier}`,
      identifier: issue.identifier,
      metadata: {
        teamKey: issue.teamKey,
        teamName: issue.teamName,
        state: issue.state,
        priority: issue.priority,
      },
    });
    onClose();
  }

  onMount(() => {
    loadIssues();
  });
</script>

{#if !isAuthenticated}
  <div class="p-8 flex flex-col items-center gap-4">
    <LinearIcon size={48} class="text-subtle" />
    <p class="text-sm text-subtle text-center">Connect to Linear to see your issues</p>
    <Button onclick={handleConnect} disabled={isConnecting}>
      {#if isConnecting}
        <Fa icon={faSpinner} class="animate-spin mr-2" />
      {/if}
      Connect Linear
    </Button>
  </div>
{:else if isLoading}
  <div class="p-8 flex justify-center">
    <Fa icon={faSpinner} class="animate-spin text-subtle" size="lg" />
  </div>
{:else}
  <!-- Search -->
  <div class="p-3 border-b border-border">
    <div class="relative">
      <Fa icon={faSearch} class="absolute left-3 top-1/2 -translate-y-1/2 text-ghost" size="sm" />
      <Input
        bind:value={searchQuery}
        placeholder="Search issues..."
        class="pl-9 h-9"
        autofocus
      />
    </div>
  </div>

  <!-- Issues list -->
  <div class="max-h-80 overflow-y-auto">
    {#if filteredIssues.length === 0}
      <div class="p-8 text-center text-subtle text-sm">
        {searchQuery ? 'No matching issues found' : 'No issues found'}
      </div>
    {:else}
      {#each filteredIssues as issue (issue.id)}
        <button
          type="button"
          class="w-full text-left px-4 py-2.5 hover:bg-muted/50 transition-colors cursor-pointer flex items-start gap-3 border-b border-border/50 last:border-0"
          onclick={() => handleSelect(issue)}
        >
          <div class="shrink-0 mt-0.5">
            <LinearIcon size={14} class="text-ghost" />
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <span class="text-xs font-mono text-subtle">{issue.identifier}</span>
              {#if issue.teamName}
                <span class="text-xs text-subtle">• {issue.teamName}</span>
              {/if}
            </div>
            <p class="text-sm truncate mt-0.5">{issue.title}</p>
          </div>
        </button>
      {/each}
    {/if}
  </div>
{/if}
