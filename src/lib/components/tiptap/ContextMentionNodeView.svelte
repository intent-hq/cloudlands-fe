<script lang="ts">
  /**
   * ContextMentionNodeView - Renders a context mention as a clickable pill
   *
   * Displays provider icon + title as an inline pill with a rich hover card
   * showing more details. Clicking opens the URL.
   */
  import type { NodeViewProps } from '@tiptap/core';
  import { NodeViewWrapper } from '$lib/utils/tiptap/svelte-node-view';
  import ProviderIcon from '$lib/components/icons/ProviderIcon.svelte';
  import GitBranchIcon from '$lib/components/icons/GitBranchIcon.svelte';
  import {
  Tooltip,
  TooltipRich,
} from '$lib/components/ui/tooltip';
  import type { ContextProvider, ContextItemType } from '$features/context/types';
  import type { ContextMentionMetadata } from './ContextMention';
  import { handleLink } from '$features/navigation/link-handler';
  import { selectActiveWorkspaceId } from '$lib/store/slices/workspace/workspace-selectors';
  import { WorkspaceId } from '$shared/types/branded-ids';

  const activeWorkspaceId = selectActiveWorkspaceId();

  let { node, selected, deleteNode }: NodeViewProps = $props();

  // Track the currently selected branch from the initializer form (updated via custom event)
  let currentSelectedBranch = $state<string | null>(null);
  // Track whether we're in a context with the initializer (i.e., we've received at least one branch update event)
  let hasInitializerContext = $state(false);

  // Listen for branch selection updates from the parent form
  $effect(() => {
    const handleBranchUpdate = (e: CustomEvent<{ branch: string }>) => {
      currentSelectedBranch = e.detail.branch;
      hasInitializerContext = true;
    };

    // Listen on document for branch updates
    document.addEventListener('initializer-branch-updated', handleBranchUpdate as EventListener);

    return () => {
      document.removeEventListener('initializer-branch-updated', handleBranchUpdate as EventListener);
    };
  });

  function handleDelete(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    deleteNode();
  }

  const provider = $derived(node.attrs.provider as ContextProvider);
  const itemType = $derived(node.attrs.itemType as ContextItemType);
  const title = $derived(node.attrs.title as string);
  const identifier = $derived(node.attrs.identifier as string);
  const rawUrl = $derived(node.attrs.url as string);
  const description = $derived(node.attrs.description as string);

  // Parse metadata JSON (defined early so url() can use it)
  const metadata = $derived((): ContextMentionMetadata | null => {
    const raw = node.attrs.metadata as string | undefined;
    if (!raw) return null;
    try {
      return JSON.parse(raw) as ContextMentionMetadata;
    } catch {
      return null;
    }
  });

  // Compute the correct URL for GitHub items based on identifier
  // The stored URL may be incorrect (e.g., author's profile instead of PR/issue URL)
  // Identifier format: "owner/repo#number" -> URL: "https://github.com/owner/repo/pull/number" or "/issues/number"
  const url = $derived(() => {
    if (provider === 'github' && identifier) {
      const match = identifier.match(/^([^/]+)\/([^#]+)#(\d+)$/);
      if (match) {
        const [, owner, repo, number] = match;
        // Use 'pull' for PRs, 'issues' for issues
        // Check if metadata has sourceBranch (indicates it's a PR)
        const isPR = Boolean(metadata()?.sourceBranch);
        const pathType = isPR ? 'pull' : 'issues';
        return `https://github.com/${owner}/${repo}/${pathType}/${number}`;
      }
    }
    return rawUrl;
  });

  // Get the PR's source branch (check for non-empty string)
  const prSourceBranch = $derived(() => {
    const branch = metadata()?.sourceBranch;
    return branch && branch.length > 0 ? branch : null;
  });

  // Check if this is a GitHub PR with a source branch
  const isGitHubPR = $derived(
    provider === 'github' &&
    (itemType === 'github-pr' || itemType === 'github-issue') &&
    prSourceBranch() !== null
  );

  // Check if branch differs from currently selected branch
  // Only show if we're in a context with the initializer (has received branch update events)
  const branchDiffers = $derived(
    hasInitializerContext &&
    isGitHubPR &&
    prSourceBranch() &&
    prSourceBranch() !== currentSelectedBranch
  );

  // Handle switching to the PR's branch
  function handleSwitchToPRBranch(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();

    const branch = prSourceBranch();
    if (branch) {
      // Dispatch custom event for parent to handle
      const event = new CustomEvent('switch-to-pr-branch', {
        detail: {
          branch,
          prIdentifier: identifier,
        },
        bubbles: true,
      });
      document.dispatchEvent(event);
    }
  }

  // Format relative time
  function formatRelativeTime(dateStr: string | undefined): string {
    if (!dateStr) return '';
    try {
      const date = new Date(dateStr);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      if (diffDays === 0) return 'today';
      if (diffDays === 1) return 'yesterday';
      if (diffDays < 7) return `${diffDays}d ago`;
      if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
      if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
      return `${Math.floor(diffDays / 365)}y ago`;
    } catch {
      return '';
    }
  }

  // Get state color class
  function getStateColor(state: string | undefined): string {
    if (!state) return 'bg-muted text-subtle';
    const s = state.toLowerCase();
    // Open/active states
    if (s.includes('progress') || s.includes('active') || s.includes('open')) {
      return 'bg-blue-500/15 text-blue-500';
    }
    // Resolved/done states
    if (
      s.includes('done') ||
      s.includes('resolved') ||
      s.includes('closed') ||
      s.includes('complete')
    ) {
      return 'bg-green-500/15 text-green-500';
    }
    // Backlog/todo
    if (s.includes('backlog') || s.includes('todo') || s.includes('triage')) {
      return 'bg-muted text-subtle';
    }
    // Blocked/error states
    if (s.includes('block') || s.includes('error') || s.includes('cancel')) {
      return 'bg-red-500/15 text-red-500';
    }
    return 'bg-muted text-subtle';
  }

  // Get priority color/indicator
  function getPriorityIndicator(
    priority: string | undefined,
  ): { color: string; label: string } | null {
    if (!priority) return null;
    const p = priority.toLowerCase();
    if (p.includes('urgent') || p === '1') return { color: 'bg-red-500', label: '🔴' };
    if (p.includes('high') || p === '2') return { color: 'bg-orange-500', label: '🟠' };
    if (p.includes('medium') || p === '3') return { color: 'bg-yellow-500', label: '🟡' };
    if (p.includes('low') || p === '4') return { color: 'bg-blue-500', label: '🔵' };
    return null;
  }

  // Get Sentry level color
  function getLevelColor(level: string | undefined): string {
    if (!level) return '';
    const l = level.toLowerCase();
    if (l === 'error' || l === 'fatal') return 'text-red-500';
    if (l === 'warning') return 'text-yellow-500';
    return 'text-subtle';
  }

  // Display text - show title with identifier prefix for issues
  const displayText = $derived(() => {
    if (itemType === 'browser-url') {
      return title || url();
    }
    // For issues, show "identifier: title" truncated
    if (identifier && title) {
      return title;
    }
    return identifier || title;
  });

  // Provider display names
  const providerName = $derived(() => {
    switch (provider) {
      case 'linear':
        return 'Linear';
      case 'github':
        return 'GitHub';
      case 'sentry':
        return 'Sentry';
      case 'browser':
        return 'URL';
      case 'internal':
        return 'Internal';
      default:
        return provider;
    }
  });

  async function handleClick(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const targetUrl = url();
    if (targetUrl) {
      const wsId = $activeWorkspaceId;
      if (wsId) {
        await handleLink(targetUrl, {
          workspaceId: WorkspaceId(wsId),
          event: e,
        });
      }
    }
  }
</script>

<NodeViewWrapper as="span" class="inline">
  <!-- Wrap in clickable span to handle clicks outside tooltip -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <span class="context-mention-wrapper group/pill relative inline-flex items-center" onclick={handleClick}>
    <TooltipRich side="top" align="start" delayDuration={300} interactive={true} maxWidth="20rem">
      {#snippet trigger()}
        <span
          class="context-mention-pill inline-flex items-center gap-1 rounded-md px-1.5 py-1 pr-5 font-medium transition-colors
            {selected
            ? 'bg-primary/20 text-primary ring-1 ring-primary/30'
            : 'bg-muted/60 text-foreground/80 hover:bg-muted hover:text-foreground'}"
        >
          <ProviderIcon {provider} size={12} class="shrink-0 opacity-30" />
          {#if identifier && itemType !== 'browser-url'}
            <span class="text-subtle shrink-0">{identifier}</span>
          {/if}
          <span class="max-w-[180px] truncate">{displayText()}</span>
        </span>
      {/snippet}

      {#snippet content()}
        {@const meta = metadata()}
        {@const priorityInfo = meta ? getPriorityIndicator(meta.priority) : null}
        <div class="space-y-2.5 max-w-80 min-w-56">
          <!-- Header row: provider + identifier -->
          <div class="flex items-center gap-1.5">
            <ProviderIcon {provider} size={10} class="opacity-40" />
            <span class="text-ui font-medium text-muted-foreground uppercase tracking-wide"
              >{providerName()}</span
            >
            {#if identifier && itemType !== 'browser-url'}
              <span class="text-ui font-medium text-subtle">·</span>
              <span class="text-ui font-medium text-subtle">{identifier}</span>
            {/if}
          </div>

          <!-- Title -->
          {#if title}
            <div class="text-sm font-medium text-foreground leading-snug">{title}</div>
          {/if}

          <!-- Metadata badges row -->
          {#if meta && (meta.state || priorityInfo || meta.assignee)}
            <div class="flex flex-wrap items-center gap-1.5">
              <!-- State badge -->
              {#if meta.state}
                <span
                  class="px-1.5 py-0.5 rounded text-ui font-medium {getStateColor(meta.state)}"
                >
                  {meta.state}
                </span>
              {/if}

              <!-- Priority indicator -->
              {#if priorityInfo}
                <span class="text-ui">{priorityInfo.label}</span>
              {/if}

              <!-- Sentry level (for Sentry issues) -->
              {#if meta.level && provider === 'sentry'}
                <span class="text-ui font-medium uppercase {getLevelColor(meta.level)}"
                  >{meta.level}</span
                >
              {/if}

              <!-- Assignee -->
              {#if meta.assignee}
                <span class="text-ui text-subtle">→ {meta.assignee}</span>
              {/if}
            </div>
          {/if}

          <!-- Labels row -->
          {#if meta?.labels}
            <div class="flex flex-wrap gap-1">
              {#each meta.labels
                .split(',')
                .map((l) => l.trim())
                .filter(Boolean)
                .slice(0, 5) as label}
                <span
                  class="px-1.5 py-0.5 rounded-full text-ui font-medium bg-muted/50 text-subtle"
                  >{label}</span
                >
              {/each}
              {#if meta.labels.split(',').length > 5}
                <span class="text-ui text-subtle"
                  >+{meta.labels.split(',').length - 5}</span
                >
              {/if}
            </div>
          {/if}

          <!-- Sentry stats (events/users) -->
          {#if meta && provider === 'sentry' && (meta.count || meta.userCount)}
            <div class="flex items-center gap-3 text-ui text-subtle">
              {#if meta.count}
                <span>{meta.count} events</span>
              {/if}
              {#if meta.userCount}
                <span>{meta.userCount} users</span>
              {/if}
            </div>
          {/if}

          <!-- Description/body text -->
          {#if description}
            <div class="text-xs text-subtle line-clamp-6">{description}</div>
          {/if}

          <!-- Footer: project + timestamps -->
          {#if meta && (meta.project || meta.createdAt || meta.author)}
            <div class="flex items-center gap-2 pt-1 border-t border-border/30">
              {#if meta.project}
                <span class="text-ui text-subtle">{meta.project}</span>
              {/if}
              {#if meta.author}
                <span class="text-ui text-subtle">by {meta.author}</span>
              {/if}
              {#if meta.createdAt}
                <span class="text-ui text-subtle ml-auto"
                  >{formatRelativeTime(meta.createdAt)}</span
                >
              {/if}
            </div>
          {/if}
        </div>
      {/snippet}
    </TooltipRich>

    <!-- Delete button - shows on hover, positioned outside TooltipRich to avoid snippet issues -->
    <button
      type="button"
      onclick={handleDelete}
      class="delete-btn absolute right-0 top-0 bottom-0 flex items-center justify-center w-5 rounded-r-md cursor-pointer
        opacity-0 group-hover/pill:opacity-100 transition-opacity
        {selected ? 'bg-primary/20 hover:bg-primary/30' : 'bg-muted/60 hover:bg-muted'}"
      aria-label="Remove mention"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 20 20"
        fill="currentColor"
        class="w-3 h-3 text-muted-foreground hover:text-foreground"
      >
        <path
          d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z"
        />
      </svg>
    </button>
  </span>

  <!-- Branch switch button - positioned to the right of the pill -->
  {#if branchDiffers}
    <Tooltip content="Switch to PR's branch" side="top" delayDuration={200}>
      <button
        type="button"
        onclick={handleSwitchToPRBranch}
        class="branch-switch-btn inline-flex items-center justify-center w-5 h-5 ml-1 rounded cursor-pointer transition-colors
          hover:bg-primary/20"
        aria-label="Switch to PR's branch"
      >
        <GitBranchIcon size={12} class="text-primary hover:text-primary/80" />
      </button>
    </Tooltip>
  {/if}
</NodeViewWrapper>

<style>
  .context-mention-wrapper {
    cursor: pointer;
  }

  .context-mention-pill {
    cursor: pointer;
    vertical-align: baseline;
    line-height: 1.4;
  }
</style>
