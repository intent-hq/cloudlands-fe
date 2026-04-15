<script lang="ts">
  /**
   * WorkspaceCreationError — actionable error block shown after a failed
   * workspace creation. Classifies the raw error via `diagnoseCloneError`
   * and renders guidance (commands, links) matched to the diagnosis kind.
   */
  import { fly } from 'svelte/transition';
  import Fa from 'svelte-fa';
  import {
    faExclamationTriangle,
    faClipboard,
    faCheck,
    faChevronDown,
    faChevronRight,
  } from '@fortawesome/free-solid-svg-icons';
  import { shell } from '$lib/electron-bridge';
  import { Button } from '$lib/components/ui/button';
  import {
    diagnoseCloneError,
    type CloneErrorKind,
  } from '$features/onboarding/utils/diagnose-clone-error';

  interface Props {
    message: string;
    onRetry?: () => void;
    /**
     * 'error' (default) — post-submit failure. Uses destructive colors and the
     *   "Failed to create workspace" fallback title.
     * 'warning' — pre-submit preflight failure. Uses warning colors and a
     *   title that frames the issue as something to fix before submitting.
     *   `onRetry` is hidden in this variant since there's nothing to retry yet.
     */
    variant?: 'error' | 'warning';
  }

  let { message, onRetry, variant = 'error' }: Props = $props();

  const diagnosis = $derived(diagnoseCloneError(message));

  const titles: Record<CloneErrorKind, string> = $derived({
    'auth-required': 'GitHub authentication required',
    'askpass-missing': 'Intent is missing a required helper script',
    'repo-not-found': 'Repository not found',
    'access-denied': 'Access denied',
    network: 'Network error',
    'destination-exists': 'Destination folder already exists',
    'git-not-installed': 'Git is not installed',
    unknown:
      variant === 'warning' ? 'We found an issue with this repository' : 'Failed to create workspace',
  });

  let showDetails = $state(false);
  let copiedCommand = $state<string | null>(null);

  async function copyCommand(cmd: string) {
    try {
      await navigator.clipboard.writeText(cmd);
      copiedCommand = cmd;
      setTimeout(() => {
        if (copiedCommand === cmd) copiedCommand = null;
      }, 1500);
    } catch {
      // clipboard not available — ignore
    }
  }

  function openLink(url: string) {
    void shell.open(url);
  }
</script>

<div
  class="rounded-lg border px-4 py-3 text-sm {variant === 'warning'
    ? 'border-amber-500/30 bg-amber-500/5'
    : 'border-destructive/30 bg-destructive/5'}"
  in:fly={{ y: 10, duration: 200 }}
  role="alert"
>
  <div class="flex items-start gap-2 mb-2">
    <Fa
      icon={faExclamationTriangle}
      class="mt-0.5 shrink-0 {variant === 'warning' ? 'text-amber-600 dark:text-amber-400' : 'text-destructive-foreground'}"
    />
    <p class="font-medium {variant === 'warning' ? 'text-amber-700 dark:text-amber-300' : 'text-destructive-foreground'}">
      {titles[diagnosis.kind]}
    </p>
  </div>

  {#if diagnosis.kind === 'auth-required'}
    <div class="space-y-2.5 text-foreground">
      <p>
        Your terminal isn't signed in to GitHub, so Intent couldn't clone this repository.
        The fastest way to fix this is to sign in with the GitHub CLI:
      </p>
      <div class="flex items-center gap-2">
        <code class="flex-1 rounded bg-background/70 border border-border/50 px-2 py-1.5 font-mono text-xs">
          gh auth login
        </code>
        <button
          type="button"
          class="shrink-0 rounded p-1.5 text-muted-foreground hover:text-foreground hover:bg-background/70 cursor-pointer"
          aria-label="Copy command"
          onclick={() => copyCommand('gh auth login')}
        >
          <Fa icon={copiedCommand === 'gh auth login' ? faCheck : faClipboard} size="sm" />
        </button>
      </div>
      <p class="text-xs text-muted-foreground">
        Don't have the GitHub CLI?
        <button
          type="button"
          class="underline hover:text-foreground cursor-pointer"
          onclick={() => openLink('https://cli.github.com/')}>Install it</button>
        or
        <button
          type="button"
          class="underline hover:text-foreground cursor-pointer"
          onclick={() =>
            openLink(
              'https://docs.github.com/en/get-started/getting-started-with-git/caching-your-github-credentials-in-git',
            )}>set up a git credential helper</button>. After signing in, click Try again below.
      </p>
    </div>
  {:else if diagnosis.kind === 'askpass-missing'}
    <div class="space-y-2 text-foreground">
      <p>
        This usually means Intent is running from a quarantined location (e.g. Downloads).
        Move <strong>Intent</strong> to <strong>Applications</strong> and relaunch — then try again.
      </p>
      <p class="text-xs text-muted-foreground">
        If you've already moved it and still see this, quit Intent completely and reopen from Applications.
      </p>
    </div>
  {:else if diagnosis.kind === 'repo-not-found'}
    <p class="text-foreground">
      Double-check the repository URL. If this is a private repo, you'll need to sign in to
      GitHub on your terminal (run <code class="font-mono text-xs">gh auth login</code>) before Intent can clone it.
    </p>
  {:else if diagnosis.kind === 'access-denied'}
    <p class="text-foreground">
      Your account doesn't have permission to access this repository. Confirm the URL or
      ask a maintainer for access.
    </p>
  {:else if diagnosis.kind === 'network'}
    <p class="text-foreground">
      Intent couldn't reach GitHub. Check your internet connection and try again.
    </p>
  {:else if diagnosis.kind === 'destination-exists'}
    <p class="text-foreground">
      The folder where Intent was going to clone this repository already exists and isn't empty.
      Choose a different location in the project picker.
    </p>
  {:else if diagnosis.kind === 'git-not-installed'}
    <p class="text-foreground">
      Intent couldn't find <code class="font-mono text-xs">git</code> on your system. Install it from
      <button
        type="button"
        class="underline hover:text-foreground cursor-pointer"
        onclick={() => openLink('https://git-scm.com/downloads')}
      >
        git-scm.com
      </button>
      and try again.
    </p>
  {:else}
    <p class="text-foreground">{diagnosis.rawMessage}</p>
  {/if}

  <div class="flex items-center gap-4 mt-3">
    {#if onRetry}
      <Button variant="default" size="sm" onclick={onRetry}>Try again</Button>
    {/if}
    {#if diagnosis.kind !== 'unknown' && diagnosis.rawMessage.trim()}
      <button
        type="button"
        class="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground cursor-pointer"
        onclick={() => (showDetails = !showDetails)}
        aria-expanded={showDetails}
      >
        <Fa icon={showDetails ? faChevronDown : faChevronRight} size="xs" />
        <span>{showDetails ? 'Hide' : 'Show'} error details</span>
      </button>
    {/if}
  </div>

  {#if showDetails && diagnosis.rawMessage.trim()}
    <pre
      class="mt-2 rounded bg-background/70 border border-border/50 px-2 py-1.5 text-xs font-mono text-muted-foreground whitespace-pre-wrap break-all max-h-40 overflow-auto">
{diagnosis.rawMessage}</pre>
  {/if}
</div>
