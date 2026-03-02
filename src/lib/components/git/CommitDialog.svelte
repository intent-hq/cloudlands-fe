<script lang="ts">
  import Fa from 'svelte-fa';
  import {
    faCodeCommit,
    faRobot,
    faSpinner,
    faCheck,
    faExclamationTriangle,
  } from '@fortawesome/free-solid-svg-icons';
  import { Button } from '../ui/button';
  import { createCommitMessageExecutor } from '$features/agent/background-agent-executor.svelte';
  import { workspaceStore } from '$features/workspace/workspace.store.svelte';
  import { toast } from 'svelte-sonner';

  let {
    show = $bindable(),
    commitMessage = $bindable(),
    stagedCount,
    onCommit,
  }: {
    show: boolean;
    commitMessage: string;
    stagedCount: number;
    onCommit: () => void;
  } = $props();

  // Track if we should auto-commit after generation
  let autoCommitPending = $state(false);

  // Create executor for commit message generation
  const executor = createCommitMessageExecutor({
    onResult: (result, context) => {
      commitMessage = result;
      if (autoCommitPending) {
        // Auto-commit after successful generation
        autoCommitPending = false;
        onCommit();
      } else if (!context?.isRestored) {
        // Only show toast for freshly generated results, not restored ones
        toast.success('Commit message generated!');
      }
    },
    onError: (error) => {
      autoCommitPending = false;
      // Don't show toast for "all models exhausted" - it's shown in chat
      const isModelsExhausted =
        error.message.includes('No available models') ||
        error.message.includes('all models exhausted') ||
        error.message.includes('All models unavailable');
      if (!isModelsExhausted) {
        toast.error(`Failed to generate: ${error.message}`);
      }
    },
  });

  async function generateCommitMessage() {
    const workspace = workspaceStore.current;
    if (!workspace) {
      toast.error('No space selected');
      return;
    }

    await executor.execute(workspace);
  }

  async function generateAndCommit() {
    autoCommitPending = true;
    await generateCommitMessage();
  }

  // Reactive status icon
  let statusIcon = $derived(
    executor.status === 'running' || executor.status === 'initializing'
      ? faSpinner
      : executor.status === 'success'
        ? faCheck
        : executor.status === 'error'
          ? faExclamationTriangle
          : faRobot,
  );

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      show = false;
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      onCommit();
    }
  }

  function autofocusOnMount(node: HTMLElement) {
    requestAnimationFrame(() => node.focus());
    return {};
  }
</script>

{#if show}
  <div
    class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
    role="button"
    tabindex="0"
    onkeydown={(e) => (e.key === 'Enter' || e.key === 'Escape') && (show = false)}
    onclick={() => (show = false)}
  >
    <div
      class="bg-card border border-border rounded-lg shadow-lg w-full max-w-md p-6"
      onclick={(e) => e.stopPropagation()}
      role="dialog"
      tabindex="-1"
      onkeydown={(e) => e.stopPropagation()}
    >
      <div class="flex items-center gap-2 mb-4">
        <Fa icon={faCodeCommit} size="lg" class="text-primary" />
        <h2 class="text-lg font-semibold text-foreground">Commit Changes</h2>
      </div>

      <div class="mb-4">
        <div class="text-sm text-subtle mb-2">
          {stagedCount} file{stagedCount !== 1 ? 's' : ''} staged
        </div>
        <textarea
          use:autofocusOnMount
          bind:value={commitMessage}
          onkeydown={handleKeydown}
          placeholder={executor.isRunning
            ? 'Generating commit message...'
            : 'Enter commit message...'}
          class="w-full h-32 px-3 py-2 bg-background border border-border rounded text-foreground resize-none focus:outline-none focus:border-primary"
        ></textarea>
        <div class="text-xs text-subtle mt-2">
          Press <kbd class="px-1.5 py-0.5 bg-muted border border-border rounded text-xs"
            >⌘/Ctrl+Enter</kbd
          > to commit
        </div>
      </div>

      <div class="flex gap-2 justify-end">
        <Button variant="ghost" onclick={() => (show = false)}>Cancel</Button>
        <Button
          onclick={generateCommitMessage}
          disabled={executor.isRunning || stagedCount === 0}
          variant="ghost"
          class="gap-1.5"
        >
          <Fa icon={statusIcon} size="xs" class={executor.isRunning ? 'animate-spin' : ''} />
          <span>
            {executor.status === 'running'
              ? `Generating... ${executor.progress}%`
              : executor.status === 'error'
                ? 'Retry'
                : 'Auto-fill'}
          </span>
        </Button>
        <Button
          onclick={generateAndCommit}
          disabled={executor.isRunning || stagedCount === 0}
          variant="outline"
          class="gap-1.5"
        >
          <Fa
            icon={faRobot}
            size="xs"
            class={autoCommitPending && executor.isRunning ? 'animate-spin' : ''}
          />
          {autoCommitPending && executor.isRunning ? 'Generating...' : 'Auto-fill & Commit'}
        </Button>
        <Button
          onclick={onCommit}
          disabled={!commitMessage.trim() || stagedCount === 0 || executor.isRunning}
        >
          <Fa icon={faCodeCommit} size="1x" />
          Commit
        </Button>
      </div>
    </div>
  </div>
{/if}
