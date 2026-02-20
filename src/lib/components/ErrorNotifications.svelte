<script lang="ts">
  /**
   * ErrorNotifications - Minimal error toasts
   */
  import { fade, fly } from 'svelte/transition';
  import { cubicInOut } from 'svelte/easing';
  import { errorHandler, type AppError } from '$lib/utils/error-handler.svelte';
  import { errorReporter } from '$lib/utils/error-reporter';
  import Fa from 'svelte-fa';
  import { faXmark } from '@fortawesome/free-solid-svg-icons';
  import { toast } from '$lib/components/ui/toast';
  import { workspaceStore } from '$features/workspace/workspace.store.svelte';
  import { UnifiedAgentFactory } from '$features/agent/services/agent-factory';
  import { WorkspaceId } from '$shared/types/branded-ids';
  import { createAgentTypeId } from '$shared/types/agent.types';
  import { modelStore } from '$lib/stores/model.store.svelte';
  import { onMount } from 'svelte';
  import Button from '$lib/components/ui/button/button.svelte';

  const APP_NAME = 'Intent';

  // Track which errors have been copied
  let copiedErrors = $state(new Set<string>());

  // Use $state and subscribe pattern since errorHandler doesn't use $state internally
  let errors: AppError[] = $state([]);

  onMount(() => {
    // Initial load
    errors = errorHandler.errors;

    // Subscribe to changes
    const unsubscribe = errorHandler.subscribe(() => {
      errors = errorHandler.errors;
    });

    return unsubscribe;
  });

  function dismiss(errorId: string) {
    errorHandler.dismiss(errorId);
  }

  function dismissAll() {
    errorHandler.dismissAll();
  }

  async function attemptRecovery(error: AppError) {
    const success = await errorHandler.attemptRecovery(error.id);
    if (success) {
      dismiss(error.id);
      errorHandler.handleInfo('Successfully recovered from error');
    } else {
      errorHandler.handleWarning('Recovery attempt failed. Please try again.');
    }
  }

  async function copyError(error: AppError) {
    try {
      // Generate a clean, support-ready format
      const lines = [
        '## 🐛 Error Report',
        '',
        `**Error:** ${error.title}`,
        `**Message:** ${error.message}`,
        `**Time:** ${error.timestamp.toLocaleString()}`,
        `**ID:** \`${error.id}\``,
        '',
      ];

      if (error.stack) {
        lines.push('<details>');
        lines.push('<summary>Stack Trace</summary>');
        lines.push('');
        lines.push('```');
        lines.push(error.stack.split('\n').slice(0, 15).join('\n'));
        lines.push('```');
        lines.push('</details>');
      }

      lines.push('');
      lines.push('---');
      lines.push('*Paste this into a support message or GitHub issue.*');

      await navigator.clipboard.writeText(lines.join('\n'));

      // Track copied state for this error
      copiedErrors.add(error.id);
      copiedErrors = new Set(copiedErrors);

      toast.success('Copied! Paste into a support message.');

      // Reset after 3 seconds
      setTimeout(() => {
        copiedErrors.delete(error.id);
        copiedErrors = new Set(copiedErrors);
      }, 3000);
    } catch (err) {
      toast.error('Failed to copy to clipboard');
    }
  }

  async function sendToAgent(error: AppError) {
    const workspace = workspaceStore.current;
    if (!workspace) {
      toast.error('No space selected');
      return;
    }

    const report = errorReporter.generateReport(error, {
      workspaceId: workspace.id,
    });

    // Create a contextual prompt that explains the situation
    const prompt = `I'm using ${APP_NAME} and encountered a bug. Help me figure out what went wrong.

${report.agentPrompt}`;

    // Create agent using the same factory as contextual menu
    const agentFactory = UnifiedAgentFactory.getInstance();
    const result = await agentFactory.createAgent(workspace, {
      name: 'Debug Agent',
      workspaceId: WorkspaceId(workspace.id),
      agentType: createAgentTypeId('debug'),
      initialMessage: prompt,
      model: modelStore.getWorkspaceDefaultModel(workspace.id),
      source: 'error-notification',
      metadata: {
        source: 'error-notification',
        errorId: error.id,
      },
    });

    dismiss(error.id);

    // Open the agent in a panel
    if (result.agentId) {
      window.dispatchEvent(
        new CustomEvent('workspace:open-agent', {
          detail: { agentId: result.agentId, openInAdjacentPanel: false },
        }),
      );
    }
  }

  // Vercel-style status dot colors
  function getStatusColor(type: string): string {
    switch (type) {
      case 'error':
        return 'bg-red-500';
      case 'warning':
        return 'bg-amber-500';
      case 'info':
        return 'bg-blue-500';
      default:
        return 'bg-neutral-500';
    }
  }
</script>

{#if errors.length > 0}
  <div class="error-notifications fixed bottom-4 right-4 z-50 space-y-2 w-[380px]">
    {#each Array.isArray(errors) ? errors.slice(-3) : [] as error (error.id)}
      {@const isCopied = copiedErrors.has(error.id)}
      <div
        in:fly={{ y: 4, duration: 150, easing: cubicInOut }}
        out:fade={{ duration: 100 }}
        class="notification group bg-neutral-900/95 backdrop-blur-sm border border-neutral-800/80 rounded-lg"
      >
        <div class="px-4 py-3 flex items-start gap-3">
          <div class="w-2 h-2 rounded-full mt-1.5 flex-shrink-0 {getStatusColor(error.type)}"></div>

          <div class="flex-1 min-w-0">
            <p class="text-sm text-neutral-200 leading-snug line-clamp-2">{error.message}</p>
            <div class="flex items-center gap-2 mt-2">
              <Button
                variant="ghost"
                size="sm"
                class="h-auto px-0 py-0 text-xs {isCopied ? 'text-emerald-400' : 'text-neutral-400 hover:text-neutral-100'}"
                onclick={() => copyError(error)}
              >
                {isCopied ? 'Copied' : 'Copy'}
              </Button>
              <span class="text-neutral-700 text-xs">·</span>
              <Button
                variant="ghost"
                size="sm"
                class="h-auto px-0 py-0 text-xs text-neutral-400 hover:text-neutral-100"
                onclick={() => sendToAgent(error)}
              >
                Debug with AI
              </Button>
              {#if error.recoverable}
                <span class="text-neutral-700 text-xs">·</span>
                <Button
                  variant="ghost"
                  size="sm"
                  class="h-auto px-0 py-0 text-xs text-neutral-400 hover:text-neutral-100"
                  onclick={() => attemptRecovery(error)}
                >
                  Retry
                </Button>
              {/if}
            </div>
          </div>

          <Button
            variant="ghost"
            size="icon"
            class="h-6 w-6 text-neutral-500 hover:text-neutral-200 -mt-1 -mr-1"
            onclick={() => dismiss(error.id)}
          >
            <Fa icon={faXmark} size="sm" />
          </Button>
        </div>
      </div>
    {/each}

    {#if errors.length > 3}
      <Button
        variant="ghost"
        size="sm"
        class="w-full py-2 text-xs text-neutral-500 hover:text-neutral-300"
        onclick={dismissAll}
      >
        +{errors.length - 3} more · Clear all
      </Button>
    {/if}
  </div>
{/if}

<style>
  .error-notifications {
    max-height: 50vh;
    overflow-y: auto;
    scrollbar-width: none;
  }
  .error-notifications::-webkit-scrollbar { display: none; }
  .notification { box-shadow: 0 2px 8px rgba(0,0,0,0.3); }
  .line-clamp-2 {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
</style>
