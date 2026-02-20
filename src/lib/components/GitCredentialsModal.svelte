<script lang="ts">
  import { handleLink } from '$features/navigation/link-handler';
  import { workspaceStore } from '$features/workspace/workspace.store.svelte';
  import { getGitAuthErrorType } from '$shared/git/git-error-handler';
  import { WorkspaceId } from '$shared/types/branded-ids';
  import { faGithub } from '@fortawesome/free-brands-svg-icons';
  import { faExternalLink, faKey, faTerminal } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';

  interface Props {
    open?: boolean;
    onClose?: () => void;
    onRetryInTerminal?: () => void;
    errorMessage?: string;
    /** The raw error output from git (stderr) for debugging */
    rawError?: string;
    operation?: string;
    command?: string;
    cwd?: string;
  }

  let {
    open = false,
    onClose = () => {},
    onRetryInTerminal,
    errorMessage = '',
    rawError,
    operation = 'push',
    command,
    cwd,
  }: Props = $props();

  // Determine error type for conditional display
  const errorType = $derived(getGitAuthErrorType(errorMessage));
  // Use raw error for display if available, otherwise fall back to user-friendly message
  const displayError = $derived(rawError || errorMessage);

  // Show retry button only when we have the command info
  const canRetry = $derived(!!command && !!cwd && !!onRetryInTerminal);

  function handleClose() {
    onClose();
  }

  function openGitHubSSHDocs() {
    const wsId = workspaceStore.current?.id;
    if (wsId) {
      handleLink('https://docs.github.com/en/authentication/connecting-to-github-with-ssh', {
        workspaceId: WorkspaceId(wsId),
      });
    }
  }

  function openGitCredentialManagerDocs() {
    const wsId = workspaceStore.current?.id;
    if (wsId) {
      handleLink('https://github.com/git-ecosystem/git-credential-manager', {
        workspaceId: WorkspaceId(wsId),
      });
    }
  }
</script>

{#if open}
  <div
    class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
    role="button"
    tabindex="0"
    aria-label="Close modal"
    onclick={handleClose}
    onkeydown={(e) => e.key === 'Escape' && handleClose()}
  >
    <div
      class="bg-background rounded-lg w-[520px] max-w-[90vw] max-h-[80vh] overflow-y-auto shadow-lg border border-border text-foreground"
      onclick={(event) => event.stopPropagation()}
    >
      <!-- Header -->
      <div class="flex justify-between items-center p-4 border-b border-border">
        <h2 class="m-0 text-lg font-semibold flex items-center gap-2">
          <Fa icon={faKey} class="text-amber-500" />
          Git Credentials Required
        </h2>
        <button
          class="bg-transparent border-none text-2xl cursor-pointer text-muted-foreground hover:text-foreground"
          onclick={handleClose}>×</button
        >
      </div>

      <!-- Content -->
      <div class="p-6 space-y-4">
        <!-- What failed -->
        {#if command || displayError}
          <div
            class="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 space-y-2"
          >
            <div class="flex justify-between items-center">
              <p class="text-sm font-medium text-red-800 dark:text-red-200 m-0">Failed Operation</p>
              {#if canRetry}
                <button
                  class="text-sm text-blue-600 dark:text-blue-400 underline bg-transparent border-none cursor-pointer p-0 hover:text-blue-800 dark:hover:text-blue-300"
                  onclick={() => onRetryInTerminal?.()}
                >
                  try in terminal
                </button>
              {/if}
            </div>
            {#if command}
              <div
                class="bg-red-100 dark:bg-red-900/40 rounded p-2 font-mono text-xs text-red-900 dark:text-red-100 break-all"
              >
                {command}
              </div>
            {/if}
            {#if displayError}
              <pre
                class="text-xs text-red-700 dark:text-red-300 m-0 whitespace-pre-wrap break-words overflow-auto max-h-32 bg-red-100 dark:bg-red-900/40 rounded p-2 font-mono">{displayError}</pre>
            {/if}
          </div>
        {/if}

        <!-- Option 1: SSH Keys -->
        <div class="border border-border rounded-lg p-4">
          <h3 class="text-base font-semibold flex items-center gap-2 m-0 mb-3">
            <Fa icon={faKey} class="text-green-500" />
            Option 1: SSH Keys (Recommended)
          </h3>
          <p class="text-sm text-muted-foreground mb-3">
            SSH keys are secure and don't require entering passwords.
          </p>
          <div class="bg-muted rounded p-3 font-mono text-xs space-y-1">
            <p class="m-0">
              <span class="text-muted-foreground"># Generate a new SSH key</span>
            </p>
            <p class="m-0">ssh-keygen -t ed25519 -C "your_email@example.com"</p>
            <p class="m-0 mt-2">
              <span class="text-muted-foreground"># Add to SSH agent</span>
            </p>
            <p class="m-0">eval "$(ssh-agent -s)" && ssh-add ~/.ssh/id_ed25519</p>
          </div>
          <button
            class="mt-3 text-sm text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 bg-transparent border-none cursor-pointer p-0"
            onclick={openGitHubSSHDocs}
          >
            <Fa icon={faExternalLink} size="xs" />
            GitHub SSH Setup Guide
          </button>
        </div>

        <!-- Option 2: Git Credential Manager -->
        <div class="border border-border rounded-lg p-4">
          <h3 class="text-base font-semibold flex items-center gap-2 m-0 mb-3">
            <Fa icon={faTerminal} class="text-purple-500" />
            Option 2: Git Credential Manager
          </h3>
          <p class="text-sm text-muted-foreground mb-3">
            Stores HTTPS credentials securely in your system keychain.
          </p>
          <div class="bg-muted rounded p-3 font-mono text-xs space-y-1">
            <p class="m-0">
              <span class="text-muted-foreground"># Install on macOS</span>
            </p>
            <p class="m-0">brew install git-credential-manager</p>
            <p class="m-0 mt-2">
              <span class="text-muted-foreground"># Configure git to use it</span>
            </p>
            <p class="m-0">git credential-manager configure</p>
          </div>
          <button
            class="mt-3 text-sm text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 bg-transparent border-none cursor-pointer p-0"
            onclick={openGitCredentialManagerDocs}
          >
            <Fa icon={faExternalLink} size="xs" />
            Git Credential Manager Docs
          </button>
        </div>

        <!-- Note about GitHub auth -->
        <div class="flex items-start gap-3">
          <Fa icon={faGithub} class="text-muted-foreground mt-0.5" />
          <p class="text-sm text-muted-foreground m-0">
            <strong>Note:</strong> Connecting GitHub through Augment enables API features like creating
            pull requests and listing repositories, but git push/pull still requires local credentials.
          </p>
        </div>
      </div>

      <!-- Footer -->
      <div class="flex justify-end gap-2 p-4 border-t border-border">
        <button
          class="bg-muted border-none px-4 py-2 rounded cursor-pointer text-foreground hover:bg-muted/80"
          onclick={handleClose}
        >
          Close
        </button>
      </div>
    </div>
  </div>
{/if}
