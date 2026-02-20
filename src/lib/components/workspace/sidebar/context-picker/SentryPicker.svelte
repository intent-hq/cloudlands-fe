<script lang="ts">
  /**
   * SentryPicker - Picker component for Sentry issues
   *
   * Shows list of Sentry issues with search/filter.
   * Handles authentication flow if not authenticated.
   */
  import { sentryAuthStore } from '$features/sentry-auth/renderer/sentry-auth.store.svelte';
  import type { SentryIssueResult } from '$features/sentry-auth/renderer/sentry-auth.store.svelte';
  import SentryIcon from '$lib/components/icons/SentryIcon.svelte';
  import { Input } from '$lib/components/ui/input';
  import { Button } from '$lib/components/ui/button';
  import { faSpinner, faSearch } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { onMount } from 'svelte';
  import { createLogger } from '$lib/utils/client-logger';

  const logger = createLogger('SentryPicker');

  interface Props {
    workspaceId: string;
    onSelect: (item: { type: string; title: string; url: string; identifier: string; metadata?: Record<string, unknown> }) => void;
    onClose: () => void;
  }

  let { workspaceId, onSelect, onClose }: Props = $props();

  let isAuthenticated = $state(false);
  let issues = $state<SentryIssueResult[]>([]);
  let isLoading = $state(false);
  let searchQuery = $state('');
  let isConnecting = $state(false);

  // Config form for unauthenticated users
  let showConfigForm = $state(false);
  let sentryOrg = $state('');
  let sentryToken = $state('');

  const filteredIssues = $derived.by(() => {
    if (!searchQuery.trim()) return issues;
    const query = searchQuery.toLowerCase();
    return issues.filter(
      (issue) =>
        issue.title.toLowerCase().includes(query) ||
        issue.shortId.toLowerCase().includes(query) ||
        issue.projectName?.toLowerCase().includes(query),
    );
  });

  async function loadIssues() {
    try {
      await sentryAuthStore.initialize();
      isAuthenticated = sentryAuthStore.state.isAuthenticated;

      if (!isAuthenticated) {
        logger.info('Sentry not authenticated');
        return;
      }

      isLoading = true;
      const result = await sentryAuthStore.fetchIssues();
      issues = result;
      logger.info('Loaded Sentry issues', { count: result.length });
    } catch (error) {
      logger.error('Failed to load Sentry issues', error as Error);
    } finally {
      isLoading = false;
    }
  }

  async function handleConnect() {
    if (!sentryOrg || !sentryToken) return;

    isConnecting = true;
    try {
      const success = await sentryAuthStore.connect(sentryOrg, sentryToken);
      if (success) {
        isAuthenticated = true;
        showConfigForm = false;
        await loadIssues();
      }
    } catch (error) {
      logger.error('Sentry auth failed', error as Error);
    } finally {
      isConnecting = false;
    }
  }

  function handleSelect(issue: SentryIssueResult) {
    onSelect({
      type: 'sentry-issue',
      title: issue.title,
      url: issue.url || `https://sentry.io/issues/${issue.id}`,
      identifier: issue.shortId,
      metadata: {
        project: issue.projectSlug,
        projectName: issue.projectName,
        type: issue.type,
        value: issue.value,
        count: issue.count,
        userCount: issue.userCount,
      },
    });
    onClose();
  }

  onMount(() => {
    loadIssues();
  });
</script>

{#if !isAuthenticated}
  <div class="p-6 flex flex-col items-center gap-4">
    <SentryIcon size={48} class="text-muted-foreground/50" />
    <p class="text-sm text-muted-foreground text-center">Connect to Sentry to see your issues</p>

    {#if showConfigForm}
      <div class="w-full space-y-3">
        <Input
          bind:value={sentryOrg}
          placeholder="Organization slug"
          class="h-9"
        />
        <Input
          bind:value={sentryToken}
          placeholder="Auth token"
          type="password"
          class="h-9"
        />
        <div class="flex gap-2">
          <Button variant="outline" onclick={() => (showConfigForm = false)} class="flex-1">
            Cancel
          </Button>
          <Button onclick={handleConnect} disabled={isConnecting || !sentryOrg || !sentryToken} class="flex-1">
            {#if isConnecting}
              <Fa icon={faSpinner} class="animate-spin mr-2" />
            {/if}
            Connect
          </Button>
        </div>
      </div>
    {:else}
      <Button onclick={() => (showConfigForm = true)}>
        Configure Sentry
      </Button>
    {/if}
  </div>
{:else if isLoading}
  <div class="p-8 flex justify-center">
    <Fa icon={faSpinner} class="animate-spin text-muted-foreground" size="lg" />
  </div>
{:else}
  <!-- Search -->
  <div class="p-3 border-b border-border">
    <div class="relative">
      <Fa icon={faSearch} class="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/50" size="sm" />
      <Input
        bind:value={searchQuery}
        placeholder="Search issues..."
        class="pl-9 h-9"
        autofocus
      />
    </div>
  </div>

  <!-- Issues list continues in next chunk due to line limit -->
  <div class="max-h-80 overflow-y-auto">
    {#if filteredIssues.length === 0}
      <div class="p-8 text-center text-muted-foreground text-sm">
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
            <SentryIcon size={14} class="text-muted-foreground" />
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <span class="text-xs font-mono text-muted-foreground">{issue.shortId}</span>
              {#if issue.projectName}
                <span class="text-xs text-muted-foreground/50">• {issue.projectName}</span>
              {/if}
            </div>
            <p class="text-sm truncate mt-0.5">{issue.title}</p>
          </div>
        </button>
      {/each}
    {/if}
  </div>
{/if}
