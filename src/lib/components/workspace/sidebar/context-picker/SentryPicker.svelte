<script lang="ts">
  /**
   * SentryPicker - Picker component for Sentry issues
   *
   * Shows list of Sentry issues with search/filter.
   * Handles authentication flow if not authenticated.
   */
  import type { SentryIssueResult } from '$store/renderer/slices/sentry-auth/sentry-auth-types';
  import {
  selectSentryIsAuthenticated,
  selectSentryIssues,
  selectSentryIsLoadingIssues,
  selectSentryIsConnecting,
} from '$store/renderer/slices/sentry-auth/sentry-auth-selectors';
  import {
  initializeSentryAuth,
  connectSentry,
  fetchSentryIssues,
} from '$store/renderer/slices/sentry-auth/sentry-auth-slice';

  import SentryIcon from '$lib/components/icons/SentryIcon.svelte';
  import { Input } from '$lib/components/ui/input';
  import { Button } from '$lib/components/ui/button';
  import {
  faSpinner,
  faSearch,
} from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { onMount } from 'svelte';
  import { store as appStore } from '$store/renderer/store';
  import { m } from '$shared/paraglide/messages.js';


  interface Props {
    workspaceId: string;
    onSelect: (item: { type: string; title: string; url: string; identifier: string; metadata?: Record<string, unknown> }) => void;
    onClose: () => void;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let { workspaceId, onSelect, onClose }: Props = $props();

  const isAuthenticated$ = selectSentryIsAuthenticated();
  const issues$ = selectSentryIssues();
  const isLoadingIssues$ = selectSentryIsLoadingIssues();
  const storeIsConnecting$ = selectSentryIsConnecting();

  let searchQuery = $state('');
  let pendingConnect = $state(false);

  // Config form for unauthenticated users
  let showConfigForm = $state(false);
  let sentryOrg = $state('');
  let sentryToken = $state('');

  const filteredIssues = $derived.by(() => {
    if (!searchQuery.trim()) return $issues$;
    const query = searchQuery.toLowerCase();
    return $issues$.filter(
      (issue: SentryIssueResult) =>
        issue.title.toLowerCase().includes(query) ||
        issue.shortId.toLowerCase().includes(query) ||
        issue.projectName?.toLowerCase().includes(query),
    );
  });

  // When connect completes successfully, fetch issues
  $effect(() => {
    if (pendingConnect && !$storeIsConnecting$) {
      pendingConnect = false;
      if ($isAuthenticated$) {
        showConfigForm = false;
        appStore.dispatch(fetchSentryIssues());
      }
    }
  });

  function handleConnect() {
    if (!sentryOrg || !sentryToken) return;
    pendingConnect = true;
    appStore.dispatch(connectSentry(sentryOrg, sentryToken));
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
    appStore.dispatch(initializeSentryAuth());
    // Fetch issues if already authenticated (state may persist from previous mount)
    if ($isAuthenticated$) {
      appStore.dispatch(fetchSentryIssues());
    }
  });

  // When auth state becomes true (e.g. after init), fetch issues
  $effect(() => {
    if ($isAuthenticated$ && $issues$.length === 0 && !$isLoadingIssues$) {
      appStore.dispatch(fetchSentryIssues());
    }
  });
</script>

{#if !$isAuthenticated$}
  <div class="p-6 flex flex-col items-center gap-4">
    <SentryIcon size={48} class="text-subtle" />
    <p class="text-sm text-subtle text-center">{m.workspace_sentryPicker_connectPrompt_label()}</p>

    {#if showConfigForm}
      <div class="w-full space-y-3">
        <Input
          bind:value={sentryOrg}
          placeholder={m.workspace_sentryPicker_orgSlug_placeholder()}
          class="h-9"
        />
        <Input
          bind:value={sentryToken}
          placeholder={m.workspace_sentryPicker_authToken_placeholder()}
          type="password"
          class="h-9"
        />
        <div class="flex gap-2">
          <Button variant="outline" onclick={() => (showConfigForm = false)} class="flex-1">
            {m.workspace_prCreator_cancel_label()}
          </Button>
          <Button onclick={handleConnect} disabled={$storeIsConnecting$ || !sentryOrg || !sentryToken} class="flex-1">
            {#if $storeIsConnecting$}
              <Fa icon={faSpinner} class="animate-spin mr-2" />
            {/if}
            {m.workspace_sentryPicker_connect_label()}
          </Button>
        </div>
      </div>
    {:else}
      <Button onclick={() => (showConfigForm = true)}>
        {m.workspace_sentryPicker_configure_label()}
      </Button>
    {/if}
  </div>
{:else if $isLoadingIssues$}
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
        placeholder={m.workspace_contextPicker_searchIssues_placeholder()}
        class="pl-9 h-9"
        autofocus
      />
    </div>
  </div>

  <!-- Issues list continues in next chunk due to line limit -->
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
            <SentryIcon size={14} class="text-ghost" />
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <span class="text-xs font-mono text-subtle">{issue.shortId}</span>
              {#if issue.projectName}
                <span class="text-xs text-subtle">• {issue.projectName}</span>
              {/if}
            </div>
            <p class="text-sm truncate mt-0.5">{issue.title}</p>
          </div>
        </button>
      {/each}
    {/if}
  </div>
{/if}
