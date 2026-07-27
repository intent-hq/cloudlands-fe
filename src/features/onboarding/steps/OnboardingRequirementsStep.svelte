<script lang="ts">
  /**
   * OnboardingRequirementsStep — the pre-onboarding requirements gate.
   *
   * Renders the terminal git/node probe results from the hostRequirements
   * slice (populated by the host-requirements check service over the
   * system:check-git / system:check-node bridges → daemon host.*, PROTOCOL
   * §5.14). The page-level gate auto-advances when selectAllRequirementsMet;
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
    faCircleNotch,
    faExternalLinkAlt,
    faPaste,
    faTriangleExclamation,
  } from '@fortawesome/free-solid-svg-icons';
  import { toast } from 'svelte-sonner';
  import { Button } from '$lib/components/ui/button';
  import { store as appStore } from '$store/renderer/store';
  import {
    checkHostRequirementsRequested,
    ensureHostRequirementsChecked,
  } from '$store/renderer/slices/host-requirements/host-requirements-slice';
  import {
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
          note: "Installs Apple's command-line tools, which include git.",
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
          note: "Use your distribution's package manager if not on apt.",
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
          note: 'Requires Homebrew — or download the installer from nodejs.org.',
          docsUrl: 'https://nodejs.org/en/download',
        };
      case 'windows':
        return {
          command: 'winget install OpenJS.NodeJS.LTS',
          docsUrl: 'https://nodejs.org/en/download',
        };
      case 'linux':
        return {
          note: 'Install via your distribution, nvm, or the downloads page.',
          docsUrl: 'https://nodejs.org/en/download',
        };
      default:
        return { docsUrl: 'https://nodejs.org/en/download' };
    }
  });

  async function copyCommand(command: string) {
    try {
      await navigator.clipboard.writeText(command);
      toast.success('Copied to clipboard');
    } catch {
      toast.error('Could not copy command');
    }
  }

  function openDocs(url: string) {
    void handleLink(url, {}).catch(() => {
      toast.error('Could not open the link');
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
    <span>Checking for git and Node.js on your machine…</span>
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
            Git
            {#if $git$.available && $git$.version}
              <span class="text-muted-foreground font-normal text-sm">{$git$.version}</span>
            {/if}
          </p>
          {#if !$git$.available}
            <p class="text-sm text-muted-foreground">
              Git is required to create and manage workspaces, but it wasn't found.
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
              title="Click to copy"
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
            Install git
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
            Node.js
            {#if $node$.ok && $node$.version}
              <span class="text-muted-foreground font-normal text-sm">v{$node$.version}</span>
            {/if}
          </p>
          {#if !$node$.ok}
            <p class="text-sm text-muted-foreground">
              {#if $node$.version}
                Node.js {minimumNodeMajor}+ is required. You have {$node$.version} installed.
              {:else}
                Node.js {minimumNodeMajor}+ is required, but it wasn't found.
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
              title="Click to copy"
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
            Install Node.js
          </button>
        </div>
      {/if}
    </div>

    <div class="flex flex-col items-start gap-2 mt-2">
      <Button variant="outline" size="lg" disabled={$checking$} onclick={checkAgain}>
        {#if $checking$}
          <Fa icon={faCircleNotch} class="animate-spin mr-1" size="sm" />
        {:else}
          <Fa icon={faArrowRotateRight} class="mr-1" size="sm" />
        {/if}
        Check again
      </Button>
      <p class="text-xs text-muted-foreground">
        We re-check automatically when you come back to the app.
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
