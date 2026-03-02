<script lang="ts">
  /**
   * ErrorConsole - Minimal error console
   */
  import { errorHandler, type AppError } from '$lib/utils/error-handler.svelte';
  import { errorReporter } from '$lib/utils/error-reporter';
  import { fade, fly, slide } from 'svelte/transition';
  import { cubicOut, cubicInOut } from 'svelte/easing';
  import Fa from 'svelte-fa';
  import {
    faXmark,
    faChevronDown,
    faChevronRight,
    faCircleExclamation,
    faTriangleExclamation,
    faCircleInfo,
  } from '@fortawesome/free-solid-svg-icons';
  import { toast } from '$lib/components/ui/toast';
  import { workspaceStore } from '$features/workspace/workspace.store.svelte';
  import { UnifiedAgentFactory } from '$features/agent/services/agent-factory';
  import { WorkspaceId } from '$shared/types/branded-ids';
  import { createAgentTypeId } from '$shared/types/agent.types';
  import { modelStore } from '$lib/stores/model.store.svelte';
  import { onMount } from 'svelte';
  import Button from '$lib/components/ui/button/button.svelte';

  const APP_NAME = 'Intent';

  // Vercel-style status colors
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

  function getStatusTextColor(type: string): string {
    switch (type) {
      case 'error':
        return 'text-red-400';
      case 'warning':
        return 'text-amber-400';
      case 'info':
        return 'text-blue-400';
      default:
        return 'text-neutral-400';
    }
  }

  // Use $state and subscribe pattern since errorHandler doesn't use $state internally
  let errors: AppError[] = $state([]);

  onMount(() => {
    // Initial load
    errors = errorHandler.getErrorLog();

    // Subscribe to changes
    const unsubscribe = errorHandler.subscribe(() => {
      errors = errorHandler.getErrorLog();
    });

    return unsubscribe;
  });
  let filteredErrors = $state<AppError[]>([]);
  let selectedError = $state<AppError | null>(null);
  let filterType = $state<'all' | 'error' | 'warning' | 'info'>('all');
  let searchQuery = $state('');
  let isConsoleOpen = $state(false);
  let expandedErrors = $state(new Set<string>());
  let isCopyingAll = $state(false);
  let copyAllSuccess = $state(false);

  // Filter errors based on type and search
  $effect(() => {
    filteredErrors = errors.filter((error) => {
      const matchesType = filterType === 'all' || error.type === filterType;
      const matchesSearch =
        !searchQuery ||
        error.message.toLowerCase().includes(searchQuery.toLowerCase()) ||
        error.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        error.stack?.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesType && matchesSearch;
    });
  });

  function toggleError(errorId: string) {
    if (expandedErrors.has(errorId)) {
      expandedErrors.delete(errorId);
    } else {
      expandedErrors.add(errorId);
    }
    expandedErrors = new Set(expandedErrors);
  }

  function getIcon(type: string) {
    switch (type) {
      case 'error':
        return faCircleExclamation;
      case 'warning':
        return faTriangleExclamation;
      case 'info':
        return faCircleInfo;
      default:
        return faCircleExclamation;
    }
  }

  function getColorClass(type: string) {
    switch (type) {
      case 'error':
        return 'text-red-500 bg-red-500/10';
      case 'warning':
        return 'text-yellow-500 bg-yellow-500/10';
      case 'info':
        return 'text-blue-500 bg-blue-500/10';
      default:
        return 'text-subtle bg-muted/10';
    }
  }

  function getEmoji(error: AppError): string {
    switch (error.type) {
      case 'error':
        return '🔴';
      case 'warning':
        return '🟡';
      case 'info':
        return '🔵';
      default:
        return '⚪';
    }
  }

  function formatAllErrorsForAgent(): string {
    return filteredErrors
      .map(
        (e) => `[${e.type.toUpperCase()}] ${e.title}: ${e.message}${e.stack ? `\n${e.stack}` : ''}`,
      )
      .join('\n\n');
  }

  /**
   * Format a single error for support sharing
   */
  function formatErrorForSupport(error: AppError): string {
    const lines = [
      `### ${getEmoji(error)} ${error.title}`,
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
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Format all errors for support - ready to paste into GitHub issue or support ticket
   */
  function formatAllForSupport(): string {
    const errorCount = filteredErrors.filter((e) => e.type === 'error').length;
    const warningCount = filteredErrors.filter((e) => e.type === 'warning').length;

    const lines = [
      '# 🐛 Error Report from Intent',
      '',
      `> Automatically generated on ${new Date().toLocaleString()}`,
      '',
      '## Summary',
      '',
      '| Type | Count |',
      '|------|-------|',
      `| 🔴 Errors | ${errorCount} |`,
      `| 🟡 Warnings | ${warningCount} |`,
      `| Total | ${filteredErrors.length} |`,
      '',
      '---',
      '',
      '## Errors',
      '',
    ];

    // Group errors by title for cleaner output
    const groupedErrors = new Map<string, AppError[]>();
    filteredErrors.forEach((error) => {
      const key = error.title;
      if (!groupedErrors.has(key)) {
        groupedErrors.set(key, []);
      }
      groupedErrors.get(key)!.push(error);
    });

    groupedErrors.forEach((errors, title) => {
      if (errors.length > 1) {
        lines.push(`### ${getEmoji(errors[0])} ${title} (×${errors.length})`);
        lines.push('');
        errors.slice(0, 3).forEach((error, idx) => {
          lines.push(`**${idx + 1}.** ${error.message}`);
          lines.push(`   - Time: ${error.timestamp.toLocaleTimeString()}`);
        });
        if (errors.length > 3) {
          lines.push(`   ... and ${errors.length - 3} more`);
        }
        lines.push('');
      } else {
        lines.push(formatErrorForSupport(errors[0]));
      }
    });

    lines.push('---');
    lines.push('');
    lines.push('*Please paste this into a support ticket or GitHub issue.*');

    return lines.join('\n');
  }

  async function copyError(error: AppError) {
    const formatted = formatErrorForSupport(error);
    await navigator.clipboard.writeText(formatted);
    toast.success('Error copied! Paste into a support message.');
  }

  async function copyAllErrors() {
    isCopyingAll = true;
    try {
      const formatted = formatAllForSupport();
      await navigator.clipboard.writeText(formatted);
      copyAllSuccess = true;
      toast.success('All errors copied! Ready to paste into a support ticket or GitHub issue.');

      setTimeout(() => {
        copyAllSuccess = false;
      }, 3000);
    } catch (err) {
      toast.error('Failed to copy to clipboard');
    } finally {
      isCopyingAll = false;
    }
  }

  async function sendErrorToAgent(error: AppError) {
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
      source: 'error-console',
      metadata: {
        source: 'error-console',
        errorId: error.id,
      },
    });

    // Open the agent in a panel
    if (result.agentId) {
      window.dispatchEvent(
        new CustomEvent('workspace:open-agent', {
          detail: { agentId: result.agentId, openInAdjacentPanel: false },
        }),
      );
    }
  }

  async function sendAllErrorsToAgent() {
    const workspace = workspaceStore.current;
    if (!workspace) {
      toast.error('No space selected');
      return;
    }

    const formatted = formatAllErrorsForAgent();
    const prompt = `I'm using ${APP_NAME} and encountered multiple bugs. Help me figure out what went wrong.

${formatted}`;

    // Create agent using the same factory as contextual menu
    const agentFactory = UnifiedAgentFactory.getInstance();
    const result = await agentFactory.createAgent(workspace, {
      name: 'Debug Agent',
      workspaceId: WorkspaceId(workspace.id),
      agentType: createAgentTypeId('debug'),
      initialMessage: prompt,
      model: modelStore.getWorkspaceDefaultModel(workspace.id),
      source: 'error-console',
      metadata: {
        source: 'error-console',
        errorCount: filteredErrors.length,
      },
    });

    // Open the agent in a panel
    if (result.agentId) {
      window.dispatchEvent(
        new CustomEvent('workspace:open-agent', {
          detail: { agentId: result.agentId, openInAdjacentPanel: false },
        }),
      );
    }
  }

  function downloadErrorLog() {
    const formatted = formatAllForSupport();
    const blob = new Blob([formatted], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `error-log-${new Date().toISOString().split('T')[0]}.md`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Error log downloaded');
  }

  function clearErrors() {
    errorHandler.clearErrorLog();
    toast.success('Error log cleared');
  }

  // Keyboard shortcut to toggle console
  $effect(() => {
    function handleKeydown(e: KeyboardEvent) {
      if (e.ctrlKey && e.shiftKey && e.key === 'E') {
        isConsoleOpen = !isConsoleOpen;
      }
    }
    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  });
</script>

<!-- Minimal floating toggle -->
{#if errors.length > 0}
  <Button
    variant="ghost"
    onclick={() => (isConsoleOpen = !isConsoleOpen)}
    class="fixed bottom-4 left-4 z-50 h-8 px-3 bg-neutral-900/90 backdrop-blur-sm border border-neutral-800 rounded-lg flex items-center gap-2 hover:border-neutral-700 transition-colors"
  >
    <div
      class="w-2 h-2 rounded-full {errors.some((e) => e.type === 'error')
        ? 'bg-red-500'
        : 'bg-amber-500'}"
    ></div>
    <span class="text-xs text-neutral-400"
      >{errors.length} {errors.length === 1 ? 'error' : 'errors'}</span
    >
  </Button>
{/if}

<!-- Console Panel -->
{#if isConsoleOpen}
  <div
    transition:fly={{ y: 200, duration: 200, easing: cubicInOut }}
    class="console-panel fixed bottom-0 left-0 right-0 z-40 h-[320px] bg-neutral-900 border-t border-neutral-800 flex flex-col"
  >
    <!-- Minimal header -->
    <div class="flex items-center justify-between h-11 px-4 border-b border-neutral-800">
      <div class="flex items-center gap-4">
        <!-- Filter tabs -->
        <div class="flex items-center">
          {#each [{ key: 'all', label: 'All', count: errors.length }, { key: 'error', label: 'Errors', count: errors.filter((e) => e.type === 'error').length, color: 'red' }, { key: 'warning', label: 'Warn', count: errors.filter((e) => e.type === 'warning').length, color: 'amber' }] as tab}
            <Button
              variant="ghost"
              size="sm"
              class="px-2 py-1 h-auto text-xs {filterType === tab.key
                ? 'text-neutral-100'
                : 'text-neutral-500 hover:text-neutral-300'}"
              onclick={() => (filterType = tab.key as any)}
            >
              {tab.label}
              {tab.count > 0 ? tab.count : ''}
            </Button>
          {/each}
        </div>

        <input
          bind:value={searchQuery}
          type="text"
          placeholder="Search"
          class="h-7 px-2 text-xs bg-transparent border border-neutral-800 rounded text-neutral-300 placeholder-neutral-600 focus:outline-none focus:border-neutral-700 w-36"
        />
      </div>

      <!-- Actions -->
      <div class="flex items-center gap-2 text-xs">
        <Button
          variant="ghost"
          size="sm"
          class="h-auto px-0 py-0 disabled:opacity-30 {copyAllSuccess
            ? 'text-emerald-400'
            : 'text-neutral-400 hover:text-neutral-100'}"
          onclick={copyAllErrors}
          disabled={filteredErrors.length === 0}
        >
          {copyAllSuccess ? 'Copied' : 'Copy'}
        </Button>
        <span class="text-neutral-700">·</span>
        <Button
          variant="ghost"
          size="sm"
          class="h-auto px-0 py-0 text-neutral-400 hover:text-neutral-100 disabled:opacity-30"
          onclick={sendAllErrorsToAgent}
          disabled={filteredErrors.length === 0}
        >
          Debug with AI
        </Button>
        <span class="text-neutral-700">·</span>
        <Button
          variant="ghost"
          size="sm"
          class="h-auto px-0 py-0 text-neutral-400 hover:text-neutral-100 disabled:opacity-30"
          onclick={clearErrors}
          disabled={errors.length === 0}
        >
          Clear
        </Button>
        <Button
          variant="ghost"
          size="icon"
          class="h-6 w-6 ml-1 text-neutral-500 hover:text-neutral-200"
          onclick={() => (isConsoleOpen = false)}
        >
          <Fa icon={faXmark} size="sm" />
        </Button>
      </div>
    </div>

    <!-- Error List -->
    <div class="error-list flex-1 overflow-y-auto">
      {#if filteredErrors.length === 0}
        <div class="flex items-center justify-center h-full">
          <p class="text-sm text-neutral-600">{errors.length === 0 ? 'No errors' : 'No matches'}</p>
        </div>
      {:else}
        {#each filteredErrors as error (error.id)}
          <div class="group border-b border-neutral-800/50 hover:bg-neutral-800/30">
            <button
              onclick={() => toggleError(error.id)}
              class="w-full px-4 py-2.5 flex items-center gap-3 text-left cursor-pointer"
            >
              <div class="w-2 h-2 rounded-full flex-shrink-0 {getStatusColor(error.type)}"></div>
              <p class="flex-1 text-sm text-neutral-300 truncate">{error.message}</p>
              <span class="text-xs text-neutral-600 opacity-0 group-hover:opacity-100"
                >{error.timestamp.toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}</span
              >
              <Fa
                icon={expandedErrors.has(error.id) ? faChevronDown : faChevronRight}
                size="sm"
                class="text-neutral-600"
              />
            </button>

            {#if expandedErrors.has(error.id)}
              <div
                transition:slide={{ duration: 100 }}
                class="px-4 py-3 border-t border-neutral-800/50 bg-neutral-900/50"
              >
                <pre
                  class="text-xs font-mono text-neutral-400 whitespace-pre-wrap break-words mb-3">{error.message}</pre>
                <div class="flex items-center gap-2 text-xs">
                  <Button
                    variant="ghost"
                    size="sm"
                    class="h-auto px-0 py-0 text-xs text-neutral-400 hover:text-neutral-100"
                    onclick={() => copyError(error)}
                  >
                    Copy
                  </Button>
                  <span class="text-neutral-700">·</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    class="h-auto px-0 py-0 text-xs text-neutral-400 hover:text-neutral-100"
                    onclick={() => sendErrorToAgent(error)}
                  >
                    Debug with AI
                  </Button>
                  {#if error.stack}
                    <span class="text-neutral-700">·</span>
                    <details class="inline">
                      <summary
                        class="text-neutral-400 hover:text-neutral-100 cursor-pointer text-xs"
                        >Stack</summary
                      >
                      <pre
                        class="mt-2 p-3 text-xs bg-neutral-800 rounded overflow-x-auto max-h-40">{error.stack}</pre>
                    </details>
                  {/if}
                </div>
              </div>
            {/if}
          </div>
        {/each}
      {/if}
    </div>
  </div>
{/if}

<style>
  .console-panel {
    box-shadow: 0 -2px 10px rgba(0, 0, 0, 0.4);
  }
  .error-list {
    scrollbar-width: thin;
    scrollbar-color: rgba(115, 115, 115, 0.2) transparent;
  }
  .error-list::-webkit-scrollbar {
    width: 4px;
  }
  .error-list::-webkit-scrollbar-track {
    background: transparent;
  }

  .error-list::-webkit-scrollbar-thumb {
    background: rgba(115, 115, 115, 0.3);
    border-radius: 3px;
  }

  .error-list::-webkit-scrollbar-thumb:hover {
    background: rgba(115, 115, 115, 0.5);
  }
</style>
