<script lang="ts">
  import { NodeViewWrapper } from 'svelte-tiptap';
  import type { NodeViewProps } from '@tiptap/core';
  import type { CliPrimitive } from '$shared/types/notes-primitives';
  import { Button } from '$lib/components/ui/button';
  import Fa from 'svelte-fa';
  import {
  faTerminal,
  faPlay,
  faArrowUpRightFromSquare,
  faCheck,
  faTimes,
  faSpinner,
} from '@fortawesome/free-solid-svg-icons';
  import {
  invoke,
  listenSync,
} from '$lib/electron-bridge';
  import { toast } from 'svelte-sonner';
  import { onDestroy } from 'svelte';
  import AuggieAvatar from '$lib/components/ui/auggie-avatar/AuggieAvatar.svelte';
  import { createLogger } from '$lib/utils/client-logger';
  import { getReduxStore } from '$lib/store/redux-dispatch-bridge';
  import {
  openAgentTabRequested,
  openTerminalTabRequested,
} from '$lib/store/slices/app-layout/app-layout-slice';

  const logger = createLogger('CliBlock');

  // TipTap NodeViewProps
  let { node, updateAttributes, extension }: NodeViewProps = $props();

  // Get primitive data from node
  let primitive = $derived(node?.attrs?.data as CliPrimitive);

  // Component state
  let running = $state(false);
  let terminalId = $state<string | null>(null);
  let unsubscribeExit: (() => void) | null = null;

  // Get workspaceId from extension options
  let workspaceId = $derived(extension?.options?.workspaceId as string | undefined);

  // Cleanup on destroy
  onDestroy(() => {
    unsubscribeExit?.();
  });

  // Check if we have an existing terminal
  let hasTerminal = $derived(running || terminalId || primitive?.terminalId);

  // Get button state
  let buttonState = $derived.by(() => {
    if (running) {
      return { label: 'Running...', icon: faSpinner, spin: true };
    }
    if (hasTerminal) {
      return { label: 'Open', icon: faArrowUpRightFromSquare, spin: false };
    }
    if (primitive?.lastRun?.status === 'success') {
      return { label: 'Ran', icon: faCheck, spin: false };
    }
    if (primitive?.lastRun?.status === 'error') {
      return { label: `Exit ${primitive.lastRun.exitCode}`, icon: faTimes, spin: false };
    }
    return { label: 'Run', icon: faPlay, spin: false };
  });

  // Run the command - creates a terminal and opens it
  async function runCommand(e: Event) {
    e.stopPropagation();
    if (!primitive || running) return;
    if (!workspaceId) {
      toast.error('No space context available');
      return;
    }

    running = true;
    unsubscribeExit?.();

    try {
      // Create a terminal with the command
      const result = await invoke<{
        ok: boolean;
        terminalId?: string;
        error?: string;
      }>('terminal:createWithCommand', {
        workspaceId,
        command: primitive.command,
        cwd: primitive.cwd,
        title: primitive.description || `Command: ${primitive.command.substring(0, 30)}`,
      });

      if (result.ok && result.terminalId) {
        terminalId = result.terminalId;

        // Listen for exit to update status
        unsubscribeExit = listenSync<number>(
          `terminal:professional:exit:${result.terminalId}`,
          ({ payload: exitCode }) => {
            running = false;
            unsubscribeExit?.();
            unsubscribeExit = null;

            // Update primitive with result
            if (updateAttributes && primitive) {
              updateAttributes({
                data: {
                  ...primitive,
                  terminalId: terminalId,
                  lastRun: {
                    status: exitCode === 0 ? 'success' : 'error',
                    exitCode,
                    startedAt: primitive.lastRun?.startedAt || new Date().toISOString(),
                    finishedAt: new Date().toISOString(),
                  },
                },
              });
            }
          },
        );

        // Update primitive with terminal reference
        if (updateAttributes) {
          updateAttributes({
            data: {
              ...primitive,
              terminalId: result.terminalId,
              lastRun: {
                status: 'running',
                startedAt: new Date().toISOString(),
              },
            },
          });
        }

        // Note: terminal:created event listener in +page.svelte will open the drawer
        toast.success('Terminal opened');
      } else {
        throw new Error(result.error || 'Failed to create terminal');
      }
    } catch (err) {
      logger.error('[runCommand] Error running command', { error: err, command: primitive?.command, workspaceId });
      running = false;
      toast.error(err instanceof Error ? err.message : 'Failed to run command');
    }
  }

  // Open existing terminal
  function openTerminal(e: Event) {
    e.stopPropagation();
    const tid = terminalId || primitive?.terminalId;
    if (!tid) return;
    if (!workspaceId) return;

    getReduxStore().dispatch(openTerminalTabRequested(workspaceId, { terminalId: tid }));
  }
</script>

<NodeViewWrapper>
  {#if primitive}
    {@const linkedAgentId = primitive.createdByAgentId}
    <div class="my-1.5 flex items-center gap-2">
      {#if linkedAgentId}
        <!-- Show agent avatar that opens the agent panel -->
        <button
          type="button"
          class="flex-none hover:opacity-80 transition-opacity cursor-pointer"
          onclick={() => {
            if (workspaceId) {
              getReduxStore().dispatch(
                openAgentTabRequested(workspaceId, { agentId: linkedAgentId }),
              );
            }
          }}
          title="View agent"
        >
          <AuggieAvatar agentId={linkedAgentId} size={16} />
        </button>
      {:else}
        <Fa icon={faTerminal} size="sm" class="text-ghost flex-none" />
      {/if}
      <code class="font-mono text-sm text-subtle flex-1 min-w-0 truncate">
        {primitive.command}
      </code>
      <Button
        variant="ghost-light"
        size="sm"
        class="h-6 px-2 text-xs text-subtle gap-1 flex-none"
        onclick={hasTerminal ? openTerminal : runCommand}
        disabled={running}
      >
        <Fa icon={buttonState.icon} size="xs" class={buttonState.spin ? 'animate-spin' : ''} />
        {buttonState.label}
      </Button>
    </div>
  {:else}
    <div class="my-1.5 text-sm text-subtle">Invalid CLI block</div>
  {/if}
</NodeViewWrapper>
