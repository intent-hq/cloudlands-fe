<script lang="ts">
  /**
   * OnboardingRequirementsStep — the pre-onboarding requirements gate.
   *
   * Renders the terminal git/node/gh probe results from the hostRequirements
   * slice (populated by the host-requirements check service over the
   * system:check-git / system:check-node / system:check-gh bridges → daemon
   * host.*, PROTOCOL §5.14). The gh row is informational only — it never
   * gates. The page-level gate auto-advances when selectAllRequirementsMet;
   * this component owns the blocked posture: per-tool status cards with
   * platform-aware install guidance (daemon host.os via the daemon-health
   * slice's system.status poll — no component-side wire fetch), copyable
   * commands, docs links, and focus/visibility re-checks (AgentGrid idiom) so
   * finishing an install in a terminal converges without a manual refresh.
   * After the first settled check group, re-checks never flip the page back
   * to the full "Checking…" posture (no loading flicker) — only the "Check
   * again" button spins.
   */
  import { onMount } from 'svelte';
  import Fa from 'svelte-fa';
  import {
    faArrowRotateRight,
    faCheck,
    faCircleInfo,
    faCircleNotch,
    faExternalLinkAlt,
    faPaste,
    faTriangleExclamation,
  } from '@fortawesome/free-solid-svg-icons';
  import { toast } from 'svelte-sonner';
  import { m } from '$shared/paraglide/messages.js';
  import { Button } from '$lib/components/ui/button';
  import { store as appStore } from '$store/renderer/store';
  import {
    checkHostRequirementsRequested,
    ensureHostRequirementsChecked,
  } from '$store/renderer/slices/host-requirements/host-requirements-slice';
  import {
    selectGhRequirement,
    selectGitRequirement,
    selectHostRequirementsChecking,
    selectHostRequirementsHasCheckedOnce,
    selectNodeRequirement,
  } from '$store/renderer/slices/host-requirements/host-requirements-selectors';
  import { selectDaemonHealthStats } from '$store/renderer/slices/daemon-health/daemon-health-selectors';
  import { MINIMUM_NODE_VERSION } from '$shared/constants/auggie';
  import { handleLink } from '$features/navigation/link-handler';

  const git$ = selectGitRequirement();
  const node$ = selectNodeRequirement();
  const gh$ = selectGhRequirement();
  const checking$ = selectHostRequirementsChecking();
  const hasCheckedOnce$ = selectHostRequirementsHasCheckedOnce();
  const daemonStats$ = selectDaemonHealthStats();

  // Major-only display form of the node minimum ("22"), derived from
  // MINIMUM_NODE_VERSION (auggie.ipc idiom) — never hardcoded.
  const minimumNodeMajor = MINIMUM_NODE_VERSION.split('.')[0];

  // Daemon-host OS (`system.status` host.os, PROTOCOL §5.7) mirrored into the
  // daemon-health stats by its polling service. `null` (no poll landed yet /
  // older intentd) folds to generic docs-link-only guidance.
  const hostOs = $derived($daemonStats$?.os ?? null);

  onMount(() => {
    appStore.dispatch(ensureHostRequirementsChecked());

    // Re-probe when the user returns to the app (they likely just ran the
    // install command in their own terminal) — AgentGrid idiom.
    const handleFocus = () => {
      appStore.dispatch(checkHostRequirementsRequested());
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        appStore.dispatch(checkHostRequirementsRequested());
      }
    };
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  });

  interface InstallGuidance {
    /** Copyable install command for the detected daemon-host OS, if any. */
    command?: string;
    /** Short note qualifying the command (e.g. package-manager caveats). */
    note?: string;
    docsUrl: string;
  }

  const gitGuidance = $derived.by((): InstallGuidance => {
    switch (hostOs) {
      case 'macos':
        return {
          command: 'xcode-select --install',
          note: m.onboarding_requirementsStep_gitMacos_note(),
          docsUrl: 'https://git-scm.com/downloads/mac',
        };
      case 'windows':
        return {
          command: 'winget install --id Git.Git -e --source winget',
          docsUrl: 'https://git-scm.com/downloads/win',
        };
      case 'linux':
        return {
          command: 'sudo apt-get install git',
          note: m.onboarding_requirementsStep_gitLinux_note(),
          docsUrl: 'https://git-scm.com/downloads/linux',
        };
      default:
        return { docsUrl: 'https://git-scm.com/downloads' };
    }
  });

  const nodeGuidance = $derived.by((): InstallGuidance => {
    switch (hostOs) {
      case 'macos':
        return {
          command: 'brew install node',
          note: m.onboarding_requirementsStep_nodeMacos_note(),
          docsUrl: 'https://nodejs.org/en/download',
        };
      case 'windows':
        return {
          command: 'winget install OpenJS.NodeJS.LTS',
          docsUrl: 'https://nodejs.org/en/download',
        };
      case 'linux':
        return {
          note: m.onboarding_requirementsStep_nodeLinux_note(),
          docsUrl: 'https://nodejs.org/en/download',
        };
      default:
        return { docsUrl: 'https://nodejs.org/en/download' };
    }
  });

  async function copyCommand(command: string) {
    try {
      await navigator.clipboard.writeText(command);
      toast.success(m.onboarding_requirementsStep_copiedToClipboard_label());
    } catch {
      toast.error(m.onboarding_requirementsStep_copyFailed_error());
    }
  }

  function openDocs(url: string) {
    void handleLink(url, {}).catch(() => {
      toast.error(m.onboarding_requirementsStep_openLinkFailed_error());
    });
  }

  function checkAgain() {
    appStore.dispatch(checkHostRequirementsRequested());
  }
</script>

{#if !$hasCheckedOnce$}
  <!-- First check group still in flight — quiet loading posture. -->
  <div
    class="flex items-center gap-3 text-muted-foreground"
    data-testid="requirements-step-checking"
    role="status"
  >
    <Fa icon={faCircleNotch} class="animate-spin" />
    <span>{m.onboarding_requirementsStep_checking_label()}</span>
  </div>
{:else}
  <div class="flex flex-col gap-4" data-testid="requirements-step-results">
    <!-- Git -->
    <div class="requirement-card" data-testid="requirement-git">
      <div class="flex items-center gap-3">
        {#if $git$.available}
          <span class="status-icon status-ok"><Fa icon={faCheck} size="sm" /></span>
        {:else}
          <span class="status-icon status-missing">
            <Fa icon={faTriangleExclamation} size="sm" />
          </span>
        {/if}
        <div class="flex-1 min-w-0">
          <p class="font-medium">
            <!-- i18n-ignore (brand/tool name) -->
            Git
            {#if $git$.available && $git$.version}
              <span class="text-muted-foreground font-normal text-sm">{$git$.version}</span>
            {/if}
          </p>
          {#if !$git$.available}
            <p class="text-sm text-muted-foreground">
              {m.onboarding_requirementsStep_gitMissing_description()}
            </p>
          {/if}
        </div>
      </div>
      {#if !$git$.available}
        <div class="guidance">
          {#if gitGuidance.command}
            {@const command = gitGuidance.command}
            <button
              type="button"
              class="install-command-button"
              onclick={() => copyCommand(command)}
              title={m.onboarding_requirementsStep_clickToCopy_tooltip()}
            >
              <code>{command}</code>
              <Fa icon={faPaste} class="copy-icon" size="sm" />
            </button>
          {/if}
          {#if gitGuidance.note}
            <p class="text-xs text-muted-foreground">{gitGuidance.note}</p>
          {/if}
          <button type="button" class="docs-link" onclick={() => openDocs(gitGuidance.docsUrl)}>
            <Fa icon={faExternalLinkAlt} size="sm" class="mr-1" />
            {m.onboarding_requirementsStep_installGit_label()}
          </button>
        </div>
      {/if}
    </div>

    <!-- Node.js -->
    <div class="requirement-card" data-testid="requirement-node">
      <div class="flex items-center gap-3">
        {#if $node$.ok}
          <span class="status-icon status-ok"><Fa icon={faCheck} size="sm" /></span>
        {:else}
          <span class="status-icon status-missing">
            <Fa icon={faTriangleExclamation} size="sm" />
          </span>
        {/if}
        <div class="flex-1 min-w-0">
          <p class="font-medium">
            <!-- i18n-ignore (brand/tool name) -->
            Node.js
            {#if $node$.ok && $node$.version}
              <span class="text-muted-foreground font-normal text-sm">v{$node$.version}</span>
            {/if}
          </p>
          {#if !$node$.ok}
            <p class="text-sm text-muted-foreground">
              {#if $node$.version}
                {m.onboarding_requirementsStep_nodeTooOld_description({
                  minimum: minimumNodeMajor,
                  version: $node$.version,
                })}
              {:else}
                {m.onboarding_requirementsStep_nodeMissing_description({
                  minimum: minimumNodeMajor,
                })}
              {/if}
            </p>
          {/if}
        </div>
      </div>
      {#if !$node$.ok}
        <div class="guidance">
          {#if nodeGuidance.command}
            {@const command = nodeGuidance.command}
            <button
              type="button"
              class="install-command-button"
              onclick={() => copyCommand(command)}
              title={m.onboarding_requirementsStep_clickToCopy_tooltip()}
            >
              <code>{command}</code>
              <Fa icon={faPaste} class="copy-icon" size="sm" />
            </button>
          {/if}
          {#if nodeGuidance.note}
            <p class="text-xs text-muted-foreground">{nodeGuidance.note}</p>
          {/if}
          <button type="button" class="docs-link" onclick={() => openDocs(nodeGuidance.docsUrl)}>
            <Fa icon={faExternalLinkAlt} size="sm" class="mr-1" />
            {m.onboarding_requirementsStep_installNode_label()}
          </button>
        </div>
      {/if}
    </div>

    <!-- GitHub CLI (gh) — informational only, never blocks continuing. -->
    <div class="requirement-card" data-testid="requirement-gh">
      <div class="flex items-center gap-3">
        {#if $gh$.available}
          <span class="status-icon status-ok"><Fa icon={faCheck} size="sm" /></span>
        {:else}
          <span class="status-icon status-info"><Fa icon={faCircleInfo} size="sm" /></span>
        {/if}
        <div class="flex-1 min-w-0">
          <p class="font-medium">
            <!-- i18n-ignore (brand/tool name) -->
            GitHub CLI
            {#if $gh$.available && $gh$.version}
              <span class="text-muted-foreground font-normal text-sm">{$gh$.version}</span>
            {/if}
            <span class="text-muted-foreground font-normal text-sm">
              {m.onboarding_requirementsStep_ghOptional_label()}
            </span>
          </p>
          {#if !$gh$.available}
            <p class="text-sm text-muted-foreground">
              {m.onboarding_requirementsStep_ghMissing_description()}
            </p>
          {/if}
        </div>
      </div>
    </div>

    <div class="flex flex-col items-start gap-2 mt-2">
      <Button variant="outline" size="lg" disabled={$checking$} onclick={checkAgain}>
        {#if $checking$}
          <Fa icon={faCircleNotch} class="animate-spin mr-1" size="sm" />
        {:else}
          <Fa icon={faArrowRotateRight} class="mr-1" size="sm" />
        {/if}
        {m.onboarding_requirementsStep_checkAgain_label()}
      </Button>
      <p class="text-xs text-muted-foreground">
        {m.onboarding_requirementsStep_recheck_description()}
      </p>
    </div>
  </div>
{/if}

<style>
  .requirement-card {
    border: 1px solid hsl(var(--border));
    border-radius: 0.75rem;
    padding: 1rem 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .status-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.75rem;
    height: 1.75rem;
    border-radius: 9999px;
    flex-shrink: 0;
  }

  .status-ok {
    background: hsl(142 71% 45% / 0.15);
    color: hsl(142 71% 40%);
  }

  .status-missing {
    background: hsl(38 92% 50% / 0.15);
    color: hsl(38 92% 45%);
  }

  .status-info {
    background: hsl(var(--muted));
    color: hsl(var(--muted-foreground));
  }

  .guidance {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.5rem;
    padding-left: 2.5rem;
  }

  .install-command-button {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    background: hsl(var(--muted));
    border: 1px solid hsl(var(--border));
    border-radius: 0.375rem;
    font-family: monospace;
    font-size: 0.875rem;
    cursor: pointer;
    transition: all 0.2s;
  }

  .install-command-button:hover {
    background: hsl(var(--muted) / 0.8);
  }

  .install-command-button :global(.copy-icon) {
    opacity: 0;
    transition: opacity 0.2s;
  }

  .install-command-button:hover :global(.copy-icon) {
    opacity: 1;
  }

  .docs-link {
    display: inline-flex;
    align-items: center;
    font-size: 0.8125rem;
    color: hsl(var(--muted-foreground));
    cursor: pointer;
    transition: color 0.2s;
  }

  .docs-link:hover {
    color: hsl(var(--foreground));
  }
</style>
