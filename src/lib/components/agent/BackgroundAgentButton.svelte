<script lang="ts">
  /**
   * BackgroundAgentButton Component
   *
   * A smart button component that uses the background agent executor
   * to provide real-time status updates and result handling.
   *
   * This is a more advanced version of BackgroundAgentTrigger that
   * uses the new executor pattern for better state management.
   */

  import {
    faRobot,
    faSpinner,
    faCheck,
    faExclamationTriangle,
    faTimes,
  } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import Button from '$lib/components/ui/button/button.svelte';
  import {
    BackgroundAgentExecutor,
    type ExecutorOptions,
  } from '$features/agent/background-agent-executor.svelte';
  import { workspaceStore } from '$features/workspace/workspace.store.svelte';
  import { toast } from 'svelte-sonner';
  import { cn } from '$lib/utils';
  import { fly, fade } from 'svelte/transition';

  interface Props {
    type: 'commit' | 'pr' | 'review' | string;
    label?: string;
    variant?: 'default' | 'ghost' | 'outline' | 'secondary';
    size?: 'xs' | 'sm' | 'md' | 'lg';
    className?: string;
    context?: any;
    resultTag?: string;
    showProgress?: boolean;
    showResult?: boolean;
    autoFillTarget?: HTMLTextAreaElement | HTMLInputElement; // Auto-fill this element with result
    onResult?: (result: string) => void;
    onError?: (error: Error) => void;
  }

  let {
    type,
    label,
    variant = 'ghost',
    size = 'sm',
    className = '',
    context,
    resultTag,
    showProgress = true,
    showResult = false,
    autoFillTarget,
    onResult,
    onError,
  }: Props = $props();

  // Create executor with configuration
  const executorConfig: ExecutorOptions = {
    type,
    resultTag: resultTag || getDefaultResultTag(type),
    timeout: getDefaultTimeout(type),
    onResult: (result, context) => {
      // Auto-fill target if provided
      if (autoFillTarget) {
        autoFillTarget.value = result;
        autoFillTarget.dispatchEvent(new Event('input', { bubbles: true }));
      }

      // Call custom handler
      onResult?.(result);

      // Show success toast only for freshly generated results, not restored ones
      if (!context?.isRestored) {
        toast.success(`${getTypeName(type)} generated successfully!`);
      }
    },
    onError: (error) => {
      onError?.(error);
      toast.error(`Failed: ${error.message}`);
    },
  };

  const executor = new BackgroundAgentExecutor(executorConfig);

  // Reactive derived values
  let displayLabel = $derived(label || getDefaultLabel(type));

  let statusLabel = $derived(
    executor.status === 'initializing'
      ? 'Starting...'
      : executor.status === 'running'
        ? 'Generating...'
        : executor.status === 'success'
          ? 'Complete!'
          : executor.status === 'error'
            ? 'Failed'
            : executor.status === 'cancelled'
              ? 'Cancelled'
              : displayLabel,
  );

  let icon = $derived(
    executor.isRunning
      ? faSpinner
      : executor.status === 'success'
        ? faCheck
        : executor.status === 'error'
          ? faExclamationTriangle
          : faRobot,
  );

  let buttonClass = $derived(
    cn(
      'gap-2 transition-all duration-200',
      executor.status === 'success' && 'text-green-500',
      executor.status === 'error' && 'text-red-500',
      className,
    ),
  );

  async function handleClick() {
    const workspace = workspaceStore.current;
    if (!workspace) {
      toast.error('No space selected');
      return;
    }

    await executor.execute(workspace, context);
  }

  function handleCancel() {
    executor.cancel();
    toast.info('Generation cancelled');
  }

  // Helper functions
  function getDefaultLabel(type: string): string {
    switch (type) {
      case 'commit':
        return 'Generate Commit Message';
      case 'pr':
        return 'Generate PR Description';
      case 'review':
        return 'Review Code';
      default:
        return `Generate ${type}`;
    }
  }

  function getDefaultResultTag(type: string): string {
    switch (type) {
      case 'commit':
        return 'COMMIT_MESSAGE';
      case 'pr':
        return 'PR_DESCRIPTION';
      case 'review':
        return 'CODE_REVIEW';
      default:
        return 'RESULT';
    }
  }

  function getDefaultTimeout(type: string): number {
    switch (type) {
      case 'commit':
        return 30000; // 30 seconds
      case 'pr':
        return 45000; // 45 seconds
      case 'review':
        return 60000; // 60 seconds
      default:
        return 30000;
    }
  }

  function getTypeName(type: string): string {
    switch (type) {
      case 'commit':
        return 'Commit message';
      case 'pr':
        return 'PR description';
      case 'review':
        return 'Code review';
      default:
        return type;
    }
  }
</script>

<div class="inline-flex flex-col gap-2">
  <div class="flex items-center gap-2">
    <Button
      {variant}
      {size}
      onclick={handleClick}
      disabled={executor.isRunning}
      class={buttonClass}
      title={displayLabel}
    >
      <Fa {icon} size="sm" class={executor.isRunning ? 'animate-spin' : ''} />
      <span>{statusLabel}</span>
    </Button>

    {#if executor.isRunning}
      <div transition:fly={{ x: -10, duration: 200 }}>
        <Button variant="ghost" size="icon-xs" onclick={handleCancel} title="Cancel generation">
          <Fa icon={faTimes} size="xs" />
        </Button>
      </div>
    {/if}
  </div>

  {#if showProgress && executor.isRunning}
    <div transition:fly={{ y: -10, duration: 200 }} class="w-full">
      <div class="flex items-center gap-2">
        <div class="flex-1 bg-muted rounded-full h-1.5 overflow-hidden">
          <div
            class="h-full bg-primary transition-all duration-300 ease-out"
            style="width: {executor.progress}%"
          ></div>
        </div>
        <span class="text-xs text-subtle min-w-[3ch]">
          {executor.progress}%
        </span>
      </div>

      {#if executor.latestMessage}
        <div class="mt-1 text-xs text-subtle truncate">
          Processing: {executor.messages.length} message{executor.messages.length !== 1 ? 's' : ''}
        </div>
      {/if}
    </div>
  {/if}

  {#if showResult && executor.result}
    <div
      transition:fade={{ duration: 200 }}
      class="p-3 bg-muted/50 rounded-md border border-border"
    >
      <div class="flex items-start justify-between gap-2 mb-2">
        <span class="text-xs font-medium text-subtle">Generated {getTypeName(type)}:</span
        >
        <Button
          variant="ghost"
          size="icon-xs"
          onclick={() => {
            navigator.clipboard.writeText(executor.result || '');
            toast.success('Copied to clipboard!');
          }}
          title="Copy to clipboard"
        >
          <Fa icon={faCheck} size="xs" />
        </Button>
      </div>
      <pre class="text-xs text-foreground whitespace-pre-wrap font-mono">
        {executor.result}
      </pre>
    </div>
  {/if}

  {#if executor.error}
    <div
      transition:fade={{ duration: 200 }}
      class="p-2 bg-destructive/10 text-destructive-foreground rounded-md text-xs"
    >
      <div class="flex items-center gap-1.5">
        <Fa icon={faExclamationTriangle} size="xs" />
        <span>{executor.error.message}</span>
      </div>
    </div>
  {/if}
</div>
