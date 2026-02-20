<script lang="ts">
  /**
   * ErrorCard - Minimal error display component
   */
  import { fly, slide } from 'svelte/transition';
  import { cubicInOut } from 'svelte/easing';
  import Fa from 'svelte-fa';
  import { faXmark } from '@fortawesome/free-solid-svg-icons';
  import type { AppError } from '$lib/utils/error-handler.svelte';
  import { toast } from '$lib/components/ui/toast';
  import Button from '$lib/components/ui/button/button.svelte';

  interface Props {
    error: AppError;
    compact?: boolean;
    showActions?: boolean;
    onSendToAgent?: (error: AppError) => void;
    onDismiss?: (errorId: string) => void;
    onRetry?: () => void;
  }

  let {
    error,
    compact = false,
    showActions = true,
    onSendToAgent,
    onDismiss,
    onRetry,
  }: Props = $props();

  let isExpanded = $state(false);
  let isCopied = $state(false);
  let copyTimeout: ReturnType<typeof setTimeout> | null = null;

  // Vercel-style status colors
  function getStatusColor(type: string): string {
    switch (type) {
      case 'error': return 'bg-red-500';
      case 'warning': return 'bg-amber-500';
      case 'info': return 'bg-blue-500';
      default: return 'bg-neutral-500';
    }
  }

  // Format for clipboard - includes all diagnostic info in a clean format
  function formatForSupport(): string {
    const lines = [
      '## 🐛 Bug Report',
      '',
      `**What went wrong:** ${error.title}`,
      `**Message:** ${error.message}`,
      '',
      '### Quick Info',
      `- **When:** ${error.timestamp.toLocaleString()}`,
      `- **Error ID:** \`${error.id}\``,
      `- **Recoverable:** ${error.recoverable ? 'Yes' : 'No'}`,
      '',
    ];

    if (error.context) {
      lines.push('### Context');
      lines.push('```json');
      lines.push(JSON.stringify(error.context, null, 2));
      lines.push('```');
      lines.push('');
    }

    if (error.stack) {
      lines.push('### Stack Trace');
      lines.push('```');
      lines.push(error.stack);
      lines.push('```');
    }

    return lines.join('\n');
  }

  async function copyForSupport() {
    try {
      const formatted = formatForSupport();
      await navigator.clipboard.writeText(formatted);
      isCopied = true;
      toast.success('Copied! Paste this in a support message or GitHub issue.');

      if (copyTimeout) clearTimeout(copyTimeout);
      copyTimeout = setTimeout(() => {
        isCopied = false;
      }, 3000);
    } catch (err) {
      toast.error('Failed to copy to clipboard');
    }
  }

  function handleSendToAgent() {
    if (onSendToAgent) {
      onSendToAgent(error);
    }
  }
</script>

<div class="bg-neutral-900/80 border border-neutral-800 rounded-lg" in:fly={{ y: 4, duration: 150, easing: cubicInOut }}>
  <div class="px-4 py-3 flex items-start gap-3">
    <div class="w-2 h-2 rounded-full mt-1.5 flex-shrink-0 {getStatusColor(error.type)}"></div>

    <div class="flex-1 min-w-0">
      <p class="text-sm text-neutral-200 leading-snug">{error.message}</p>

      {#if showActions}
        <div class="flex items-center gap-2 mt-2 text-xs">
          <Button
            variant="ghost"
            size="sm"
            class="h-auto px-0 py-0 text-xs {isCopied ? 'text-emerald-400' : 'text-neutral-400 hover:text-neutral-100'}"
            onclick={copyForSupport}
          >
            {isCopied ? 'Copied' : 'Copy'}
          </Button>
          {#if onSendToAgent}
            <span class="text-neutral-700">·</span>
            <Button
              variant="ghost"
              size="sm"
              class="h-auto px-0 py-0 text-xs text-neutral-400 hover:text-neutral-100"
              onclick={handleSendToAgent}
            >
              Debug with AI
            </Button>
          {/if}
          {#if error.recoverable && onRetry}
            <span class="text-neutral-700">·</span>
            <Button
              variant="ghost"
              size="sm"
              class="h-auto px-0 py-0 text-xs text-neutral-400 hover:text-neutral-100"
              onclick={onRetry}
            >
              Retry
            </Button>
          {/if}
          {#if error.stack}
            <span class="text-neutral-700">·</span>
            <Button
              variant="ghost"
              size="sm"
              class="h-auto px-0 py-0 text-xs text-neutral-400 hover:text-neutral-100"
              onclick={() => (isExpanded = !isExpanded)}
            >
              {isExpanded ? 'Hide' : 'Details'}
            </Button>
          {/if}
        </div>
      {/if}

      {#if isExpanded && error.stack}
        <pre transition:slide={{ duration: 100 }} class="mt-3 p-3 text-xs font-mono bg-neutral-800 rounded overflow-x-auto max-h-32 text-neutral-400">{error.stack}</pre>
      {/if}
    </div>

    {#if onDismiss}
      <Button
        variant="ghost"
        size="icon"
        class="h-6 w-6 text-neutral-500 hover:text-neutral-200 -mt-1 -mr-1"
        onclick={() => onDismiss?.(error.id)}
      >
        <Fa icon={faXmark} size="sm" />
      </Button>
    {/if}
  </div>
</div>

<style>
  /* Minimal shadow */
</style>
