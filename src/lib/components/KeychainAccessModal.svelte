<script lang="ts">
  import {
    keychainSettingsStore,
    type KeychainAccessChoice,
  } from '$lib/stores/keychain-settings.store.svelte';
  import { faApple } from '@fortawesome/free-brands-svg-icons';
  import { faCircleInfo, faKey, faShieldHalved } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';

  interface KeychainWarningData {
    workspaceId: string;
    operation: string;
    credentialHelper: string | null;
    remoteUrl: string | null;
    reason: string;
  }

  interface Props {
    open?: boolean;
    onClose?: () => void;
    onAllow?: () => void;
    onDeny?: () => void;
    warningData?: KeychainWarningData | null;
  }

  let {
    open = false,
    onClose = () => {},
    onAllow = () => {},
    onDeny = () => {},
    warningData = null,
  }: Props = $props();

  let rememberChoice = $state(false);

  function handleClose() {
    rememberChoice = false;
    onClose();
  }

  function handleAllow() {
    const choice: KeychainAccessChoice = 'allow';
    keychainSettingsStore.setKeychainAccessChoice(choice, rememberChoice);
    rememberChoice = false;
    onAllow();
  }

  function handleDeny() {
    const choice: KeychainAccessChoice = 'deny';
    keychainSettingsStore.setKeychainAccessChoice(choice, rememberChoice);
    rememberChoice = false;
    onDeny();
  }

  function handleProceedOnce() {
    // Mark as seen but don't remember the choice
    keychainSettingsStore.markExplanationSeen();
    rememberChoice = false;
    onAllow();
  }

  // Extract repo name from URL for display
  const repoName = $derived(() => {
    if (!warningData?.remoteUrl) return 'this repository';
    const match = warningData.remoteUrl.match(/\/([^/]+?)(?:\.git)?$/);
    return match ? match[1] : 'this repository';
  });
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
          <Fa icon={faShieldHalved} class="text-amber-500" />
          Keychain Access Required
        </h2>
        <button
          class="bg-transparent border-none text-2xl cursor-pointer text-muted-foreground hover:text-foreground"
          onclick={handleClose}>×</button
        >
      </div>

      <!-- Content -->
      <div class="p-6 space-y-4">
        <!-- Main explanation -->
        <div
          class="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4"
        >
          <div class="flex items-start gap-3">
            <Fa icon={faApple} class="text-amber-600 dark:text-amber-400 mt-0.5 text-lg" />
            <div>
              <p class="text-sm text-amber-800 dark:text-amber-200 m-0 font-medium">
                macOS will ask for keychain access
              </p>
              <p class="text-sm text-amber-700 dark:text-amber-300 m-0 mt-1">
                Git <strong>{warningData?.operation || 'push'}</strong> to {repoName()} uses HTTPS credentials
                stored in your macOS keychain. You'll see a system dialog asking to allow access.
              </p>
            </div>
          </div>
        </div>

        <!-- Why this happens -->
        <div class="border border-border rounded-lg p-4">
          <h3 class="text-base font-semibold flex items-center gap-2 m-0 mb-3">
            <Fa icon={faCircleInfo} class="text-blue-500" />
            Why does this happen?
          </h3>
          <p class="text-sm text-subtle m-0">
            Your git credentials are stored in the macOS keychain.
          </p>
          {#if warningData?.credentialHelper}
            <p class="text-xs text-subtle mt-2 m-0">
              Credential helper: <code class="bg-muted px-1 rounded"
                >{warningData.credentialHelper}</code
              >
            </p>
          {/if}
        </div>

        <!-- Tip about SSH -->
        <div class="flex items-start gap-3">
          <Fa icon={faKey} class="text-green-500 mt-0.5" />
          <p class="text-sm text-subtle m-0">
            <strong>Tip:</strong> Switch to SSH keys to avoid keychain prompts entirely. SSH keys are
            stored separately and don't trigger these dialogs.
          </p>
        </div>

        <!-- Remember choice checkbox -->
        <label class="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            bind:checked={rememberChoice}
            class="w-4 h-4 rounded border-border"
          />
          <span class="text-sm text-subtle"> Remember my choice </span>
        </label>
      </div>

      <!-- Footer -->
      <div class="flex justify-between items-center p-4 border-t border-border">
        <button
          class="text-sm text-muted-foreground hover:text-foreground bg-transparent border-none cursor-pointer p-0"
          onclick={handleDeny}
        >
          Cancel {warningData?.operation || 'operation'}
        </button>
        <div class="flex gap-2">
          {#if !rememberChoice}
            <button
              class="bg-muted border-none px-4 py-2 rounded cursor-pointer text-foreground hover:bg-muted/80"
              onclick={handleProceedOnce}
            >
              Proceed Once
            </button>
          {/if}
          <button
            class="bg-blue-600 hover:bg-blue-700 border-none px-4 py-2 rounded cursor-pointer text-white font-medium"
            onclick={handleAllow}
          >
            {rememberChoice ? 'Always Allow' : 'Allow'}
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}
