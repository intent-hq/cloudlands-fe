<script lang="ts">
  import { faCopy, faExclamationTriangle, faTerminal } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';

  interface GitOperationFailedData {
    workspaceId: string;
    operation: string;
    command: string;
    cwd: string;
    error: string;
    stderr?: string;
  }

  interface Props {
    open?: boolean;
    onClose?: () => void;
    onRetryInTerminal?: () => void;
    failureData?: GitOperationFailedData | null;
  }

  let {
    open = false,
    onClose = () => {},
    onRetryInTerminal = () => {},
    failureData = null,
  }: Props = $props();

  let copied = $state(false);

  function handleClose() {
    onClose();
  }

  function handleRetryInTerminal() {
    onRetryInTerminal();
    onClose();
  }

  async function handleCopyCommand() {
    if (failureData?.command) {
      try {
        await navigator.clipboard.writeText(failureData.command);
        copied = true;
        setTimeout(() => {
          copied = false;
        }, 2000);
      } catch (e) {
        console.error('Failed to copy command:', e);
      }
    }
  }

  function getOperationLabel(operation: string): string {
    switch (operation) {
      case 'push':
        return 'Push';
      case 'pull':
        return 'Pull';
      case 'fetch':
        return 'Fetch';
      default:
        return operation.charAt(0).toUpperCase() + operation.slice(1);
    }
  }
</script>

{#if open}
  <div
    class="fixed inset-0 bg-black/50 flex items-center justify-center z-[5000]"
    role="button"
    tabindex="0"
    aria-label="Close modal"
    onclick={handleClose}
    onkeydown={(e) => e.key === 'Escape' && handleClose()}
  >
    <div
      class="bg-white dark:bg-[var(--ds-color-surface-1,#1e1e1e)] rounded-lg w-[520px] max-w-[90vw] max-h-[80vh] overflow-y-auto shadow-[0_4px_24px_rgba(0,0,0,0.3)] border border-gray-200 dark:border-[var(--ds-color-border-subtle,#333)] text-gray-900 dark:text-[var(--ds-color-text-primary,#f5f5f5)]"
      onclick={(event) => event.stopPropagation()}
      onkeydown={() => {}}
      role="dialog"
    >
      <!-- Header -->
      <div
        class="flex justify-between items-center p-4 border-b border-gray-200 dark:border-[var(--ds-color-border-subtle,#333)]"
      >
        <h2 class="m-0 text-lg font-semibold flex items-center gap-2">
          <Fa icon={faExclamationTriangle} class="text-red-500" />
          Git {getOperationLabel(failureData?.operation || '')} Failed
        </h2>
        <button
          class="bg-transparent border-none text-2xl cursor-pointer text-gray-500 dark:text-[var(--ds-color-text-secondary,#888)] hover:text-gray-700 dark:hover:text-[var(--ds-color-text-primary,#f5f5f5)]"
          onclick={handleClose}>×</button
        >
      </div>

      <!-- Content -->
      <div class="p-6 space-y-4">
        <!-- Error message -->
        <div
          class="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4"
        >
          <p class="text-sm text-red-800 dark:text-red-200 m-0 font-medium">
            {failureData?.error || 'An error occurred during the git operation.'}
          </p>
          {#if failureData?.stderr && failureData.stderr !== failureData.error}
            <pre
              class="text-xs text-red-700 dark:text-red-300 mt-2 m-0 whitespace-pre-wrap overflow-x-auto max-h-32 overflow-y-auto bg-red-100/50 dark:bg-red-900/30 rounded p-2">{failureData.stderr}</pre>
          {/if}
        </div>

        <!-- Command to retry -->
        <div
          class="border border-gray-200 dark:border-[var(--ds-color-border-subtle,#333)] rounded-lg p-4"
        >
          <h3 class="text-base font-semibold flex items-center gap-2 m-0 mb-3">
            <Fa icon={faTerminal} class="text-blue-500" />
            Command
          </h3>
          <div class="bg-gray-100 dark:bg-gray-800 rounded p-3 font-mono text-sm">
            <code class="text-gray-800 dark:text-gray-200 break-all"
              >{failureData?.command || ''}</code
            >
          </div>
          <p class="text-xs text-gray-500 dark:text-gray-400 mt-2 m-0">
            Working directory: <code class="bg-gray-100 dark:bg-gray-800 px-1 rounded"
              >{failureData?.cwd || ''}</code
            >
          </p>
        </div>

        <!-- Tip -->
        <p class="text-sm text-gray-600 dark:text-[var(--ds-color-text-secondary,#888)] m-0">
          Open a terminal to see detailed output and troubleshoot the issue.
        </p>
      </div>

      <!-- Footer -->
      <div
        class="flex justify-end gap-3 p-4 border-t border-gray-200 dark:border-[var(--ds-color-border-subtle,#333)]"
      >
        <button
          class="px-4 py-2 rounded-md text-sm font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors flex items-center gap-2"
          onclick={handleCopyCommand}
        >
          <Fa icon={faCopy} />
          {copied ? 'Copied!' : 'Copy Command'}
        </button>
        <button
          class="px-4 py-2 rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors flex items-center gap-2"
          onclick={handleRetryInTerminal}
        >
          <Fa icon={faTerminal} />
          Retry in Terminal
        </button>
      </div>
    </div>
  </div>
{/if}
