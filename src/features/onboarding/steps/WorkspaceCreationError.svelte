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
  import { m } from '$shared/paraglide/messages.js';
  import { Button } from '$lib/components/ui/button';
  import {
  diagnoseCloneError,
  type CloneErrorKind,
} from '$features/onboarding/utils/diagnose-clone-error';

  interface Props {
    message: string;
    onRetry?: () => void;
    /**
     * Machine-readable `error.data.code` from the daemon's clone failure
     * taxonomy (PROTOCOL §9.1, monorepo#826). When present, classification
     * uses it instead of prose matching on `message`.
     */
    errorCode?: string | null;
    /**
     * 'error' (default) — post-submit failure. Uses destructive colors and the
     *   "Failed to create workspace" fallback title.
     * 'warning' — pre-submit preflight failure. Uses warning colors and a
     *   title that frames the issue as something to fix before submitting.
     *   `onRetry` is hidden in this variant since there's nothing to retry yet.
     */
    variant?: 'error' | 'warning';
  }

  let { message, onRetry, errorCode = null, variant = 'error' }: Props = $props();

  const diagnosis = $derived(diagnoseCloneError(message, errorCode));

  const titles: Record<CloneErrorKind, string> = $derived({
    'auth-required': m.onboarding_creationError_authRequired_title(),
    'askpass-missing': m.onboarding_creationError_askpassMissing_title(),
    'repo-not-found': m.onboarding_creationError_repoNotFound_title(),
    'access-denied': m.onboarding_creationError_accessDenied_title(),
    network: m.onboarding_creationError_network_title(),
    'destination-exists': m.onboarding_creationError_destinationExists_title(),
    'path-invalid': m.onboarding_creationError_pathInvalid_title(),
    'git-not-installed': m.onboarding_creationError_gitNotInstalled_title(),
    unknown:
      variant === 'warning'
        ? m.onboarding_creationError_unknownWarning_title()
        : m.onboarding_creationError_unknownError_title(),
  });

  // Daemon-provided detail renders inline (expanded) so users see the real
  // cause without an extra click (monorepo#826); the toggle can still hide it.
  let showDetails = $state(true);
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
        {m.onboarding_creationError_authRequired_description()}
      </p>
      <div class="flex items-center gap-2">
        <code class="flex-1 rounded bg-background/70 border border-border/50 px-2 py-1.5 font-mono text-xs">
          <!-- i18n-ignore (shell command) -->
          gh auth login
        </code>
        <button
          type="button"
          class="shrink-0 rounded p-1.5 text-muted-foreground hover:text-foreground hover:bg-background/70 cursor-pointer"
          aria-label={m.onboarding_creationError_copyCommand_ariaLabel()}
          onclick={() => copyCommand('gh auth login')}
        >
          <Fa icon={copiedCommand === 'gh auth login' ? faCheck : faClipboard} size="sm" />
        </button>
      </div>
      <p class="text-xs text-muted-foreground">
        {m.onboarding_creationError_noCli_before()}
        <button
          type="button"
          class="underline hover:text-foreground cursor-pointer"
          onclick={() => openLink('https://cli.github.com/')}>{m.onboarding_creationError_installIt_label()}</button>
        {m.onboarding_creationError_or_label()}
        <button
          type="button"
          class="underline hover:text-foreground cursor-pointer"
          onclick={() =>
            openLink(
              'https://docs.github.com/en/get-started/getting-started-with-git/caching-your-github-credentials-in-git',
            )}>{m.onboarding_creationError_credentialHelper_label()}</button>{m.onboarding_creationError_noCli_after()}
      </p>
    </div>
  {:else if diagnosis.kind === 'askpass-missing'}
    <div class="space-y-2 text-foreground">
      <p>
        {m.onboarding_creationError_askpassMissing_description()}
        <!-- i18n-ignore (brand name / OS folder name inside <strong>) -->
        {m.onboarding_creationError_askpassMove_before()} <strong>Intent</strong>
        <!-- i18n-ignore (OS folder name) -->
        {m.onboarding_creationError_askpassMove_middle()} <strong>Applications</strong>
        {m.onboarding_creationError_askpassMove_after()}
      </p>
      <p class="text-xs text-muted-foreground">
        {m.onboarding_creationError_askpassMoved_note()}
      </p>
    </div>
  {:else if diagnosis.kind === 'repo-not-found'}
    <p class="text-foreground">
      {m.onboarding_creationError_repoNotFound_before()}
      <!-- i18n-ignore (shell command) -->
      <code class="font-mono text-xs">gh auth login</code>{m.onboarding_creationError_repoNotFound_after()}
    </p>
  {:else if diagnosis.kind === 'access-denied'}
    <p class="text-foreground">
      {m.onboarding_creationError_accessDenied_description()}
    </p>
  {:else if diagnosis.kind === 'network'}
    <p class="text-foreground">
      {m.onboarding_creationError_network_description()}
    </p>
  {:else if diagnosis.kind === 'destination-exists'}
    <p class="text-foreground">
      {m.onboarding_creationError_destinationExists_description()}
    </p>
  {:else if diagnosis.kind === 'path-invalid'}
    <p class="text-foreground">
      {m.onboarding_creationError_pathInvalid_description()}
    </p>
  {:else if diagnosis.kind === 'git-not-installed'}
    <p class="text-foreground">
      {m.onboarding_creationError_gitNotInstalled_before()}
      <!-- i18n-ignore (command and domain names) -->
      <code class="font-mono text-xs">git</code>
      {m.onboarding_creationError_gitNotInstalled_middle()}
      <button
        type="button"
        class="underline hover:text-foreground cursor-pointer"
        onclick={() => openLink('https://git-scm.com/downloads')}
      >
        <!-- i18n-ignore (domain name) -->
        git-scm.com
      </button>
      {m.onboarding_creationError_gitNotInstalled_after()}
    </p>
  {:else}
    <p class="text-foreground">{diagnosis.rawMessage}</p>
  {/if}

  <div class="flex items-center gap-4 mt-3">
    {#if onRetry}
      <Button variant="default" size="sm" onclick={onRetry}>{m.onboarding_creationError_tryAgain_label()}</Button>
    {/if}
    {#if diagnosis.kind !== 'unknown' && diagnosis.rawMessage.trim()}
      <button
        type="button"
        class="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground cursor-pointer"
        onclick={() => (showDetails = !showDetails)}
        aria-expanded={showDetails}
      >
        <Fa icon={showDetails ? faChevronDown : faChevronRight} size="xs" />
        <span
          >{showDetails
            ? m.onboarding_creationError_hideErrorDetails_label()
            : m.onboarding_creationError_showErrorDetails_label()}</span
        >
      </button>
    {/if}
  </div>

  <!-- The unknown branch already renders rawMessage as the body, so the
       details block only applies to classified kinds. -->
  {#if showDetails && diagnosis.kind !== 'unknown' && diagnosis.rawMessage.trim()}
    <pre
      class="mt-2 rounded bg-background/70 border border-border/50 px-2 py-1.5 text-xs font-mono text-muted-foreground whitespace-pre-wrap break-all max-h-40 overflow-auto">
{diagnosis.rawMessage}</pre>
  {/if}
</div>
