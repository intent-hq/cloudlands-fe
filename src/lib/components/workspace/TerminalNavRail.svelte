<script lang="ts">
  import { Fa } from 'svelte-fa';
  import { faPlus, faTerminal } from '@fortawesome/free-solid-svg-icons';
  import { Button } from '$lib/components/ui/button';
  import { cn } from '$lib/utils';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import HoverCard from '$lib/components/ui/HoverCard.svelte';

  import { terminalHistoryTracker } from '$features/terminal/terminal-history-tracker';

  import { tick } from 'svelte';
  import { formatRelativeTime } from '$lib/utils/timeFormatting';

  // Subscribe to history updates to trigger reactivity
  const historyUpdateCounter = terminalHistoryTracker.updateCounter;

  interface TerminalItem {
    id: string;
    name: string;
    isActive?: boolean;
    lastCommand?: string;
    hasRunningProcess?: boolean;
    isConnected?: boolean;
    viewMode?: 'terminal' | 'chat';
    lastUserMessage?: string;
  }

  let {
    terminals = [],
    activeItemId = null,
    onCreate,
    onSelect,
    class: className = '',
    isLoading = false,
    drawerOpen = false,
    drawerType = null,
  }: {
    terminals?: any[];
    activeItemId?: string | null;
    onCreate?: () => void;
    onSelect?: (terminalId: string) => void;
    class?: string;
    isLoading?: boolean;
    drawerOpen?: boolean;
    drawerType?: string | null;
  } = $props();

  // Convert terminals to terminal items - preserve all original properties
  // Use historyUpdateCounter to trigger reactivity when terminal history changes
  const terminalItems = $derived(
    terminals.map((terminal) => {
      // Access the store value to establish dependency (triggers re-compute when history changes)
      void $historyUpdateCounter;
      // Get history from the tracker
      const history = terminalHistoryTracker.getHistory(terminal.id);

      // Extract last command or message from terminal data or history
      let lastCommand = history?.lastCommand || terminal.lastCommand || '';
      let lastOutput = history?.lastOutput || '';
      let lastUserMessage = terminal.lastUserMessage || '';

      // If terminal has messages (chat mode), extract the last user message
      if (terminal.messages && terminal.messages.length > 0) {
        for (let i = terminal.messages.length - 1; i >= 0; i--) {
          const msg = terminal.messages[i];
          if (msg.role === 'user' || msg.role === 'User') {
            if (typeof msg.content === 'string') {
              lastUserMessage = msg.content;
            } else if (Array.isArray(msg.content)) {
              const textContent = msg.content
                .filter((block: any) => block.type === 'text')
                .map((block: any) => block.text)
                .join(' ');
              lastUserMessage = textContent;
            }
            break;
          }
        }
      }

      // If terminal has command history, get the last command
      if (!lastCommand && terminal.commandHistory && terminal.commandHistory.length > 0) {
        lastCommand = terminal.commandHistory[terminal.commandHistory.length - 1];
      }

      return {
        ...terminal, // Keep all original properties
        id: terminal.id,
        name: terminal.name || terminal.title || `Terminal ${terminal.id.slice(0, 8)}`,
        // Use the activeItemId prop that's passed in from the parent
        isActive: drawerType === 'terminal' && terminal.id === activeItemId && drawerOpen,
        lastCommand: lastCommand,
        lastOutput: lastOutput,
        hasRunningProcess:
          history?.isExecuting ||
          terminal.isExecuting ||
          terminal.isBusy ||
          terminal.hasRunningProcess ||
          false,
        // Terminal is connected if explicitly set to true, or if state indicates it's ready
        isConnected:
          terminal.isConnected === true ||
          !terminal.state ||
          terminal.state === 'connected' ||
          terminal.state === 'ready',
        viewMode: terminal.viewMode || 'terminal',
        lastUserMessage: lastUserMessage,
        messages: terminal.messages || [],
        createdAt: terminal.createdAt || null,
        commandCount: history?.commands?.length || 0,
      };
    }),
  );

  let hoveredItemId: string | null = $state(null);
  let scrollContainer: HTMLElement | undefined = $state();

  async function handleItemClick(item: TerminalItem) {
    // Always call onSelect - the parent component handles toggle logic
    if (onSelect) {
      onSelect(item.id);
    }
  }

  function handleItemHover(itemId: string | null) {
    hoveredItemId = itemId;
  }

  function truncateText(text: string, maxLength: number = 50): string {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  }

  // Scroll active item into view when component mounts or active item changes
  $effect(() => {
    if (activeItemId && drawerType === 'terminal' && scrollContainer) {
      const container = scrollContainer;

      tick().then(() => {
        const activeButton = container?.querySelector(
          `button[data-terminal-id="${activeItemId}"]`,
        ) as HTMLElement;

        activeButton?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    }
  });
</script>

<div class={cn('flex flex-col max-h-full', className)}>
  <!-- Terminal Items - Simple Scrollable Container -->
  <div class="flex-1 overflow-y-auto min-h-0 relative" bind:this={scrollContainer}>
    <!-- Top gradient fade (fixed position) -->
    <div
      class="pointer-events-none sticky top-0 left-0 right-0 h-3 -mb-2 bg-linear-to-b from-sidebar to-transparent z-10"
    ></div>

    <div class="flex flex-col items-center gap-1 w-full px-1 py-2">
      {#if isLoading && terminals.length === 0}
        <!-- Skeleton loaders for terminals during initial loading -->
        {#each Array(1) as _, i}
          <div class="relative w-full animate-pulse" style="animation-delay: {i * 100}ms">
            <div class="w-full h-9 flex items-center justify-center">
              <Skeleton class="w-4 h-4" />
            </div>
          </div>
        {/each}
      {:else if terminalItems.length > 0}
        {#each terminalItems as item (item.id)}
          <div class="relative group w-full" style:anchor-name="--terminal-{item.id}">
            <button
              data-terminal-id={item.id}
              class={cn(
                'relative w-full h-9 flex items-center justify-center transition-all cursor-pointer',
                item.isActive && 'bg-border',
              )}
              onclick={() => handleItemClick(item)}
              onmouseenter={() => handleItemHover(item.id)}
              onmouseleave={() => handleItemHover(null)}
            >
              <!-- Terminal Icon -->
              <Fa icon={faTerminal} size="sm" class="text-ghost" />

              <!-- Status indicator -->
              {#if item.hasRunningProcess}
                <!-- Green pulsing dot for running process -->
                <div
                  class="absolute -bottom-1 -right-1 w-2 h-2 bg-green-500 rounded-full animate-pulse"
                  title="Running command"
                ></div>
              {/if}
            </button>
          </div>
        {/each}
      {/if}
    </div>

    <!-- Bottom gradient fade (fixed position) -->
    <div
      class="pointer-events-none sticky bottom-0 left-0 right-0 h-2 -mt-2 bg-linear-to-t from-sidebar to-transparent z-10"
    ></div>
  </div>

  <!-- Add Terminal Button -->
  <div class="flex-none flex justify-center mb-3.5">
    <Button
      variant="ghost-light"
      size="icon-sm"
      onclick={onCreate}
      tooltip="New terminal"
      tooltipShortcut="mod+`"
      tooltipSide="left"
      tooltipDelayDuration={0}
    >
      <Fa icon={faPlus} size="sm" />
    </Button>
  </div>
</div>

<!-- Hover Card - Outside scroll container, uses CSS Anchor Positioning. IMPORTANT: position-anchor must match for hover card and anchor element. -->
{#if hoveredItemId !== null}
  {@const hoveredItem = terminalItems.find((i) => i.id === hoveredItemId)}
  {#if hoveredItem}
    <HoverCard anchor={'--terminal-' + hoveredItemId} position="bottom">
      <div class="space-y-2 w-full gap-3 pb-3">
        <!-- Terminal Name and Status -->
        <div class="flex items-center gap-2 px-3 pt-3">
          <div
            class={cn(
              'flex items-center justify-center w-5 h-5 rounded',
              hoveredItem.hasRunningProcess ? 'bg-green-500/20' : 'bg-muted',
            )}
          >
            <Fa
              icon={faTerminal}
              size="xs"
              class={cn(
                hoveredItem.hasRunningProcess
                  ? 'text-green-500 animate-pulse'
                  : 'text-subtle',
              )}
            />
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-1.5">
              <div class="font-medium text-sm truncate">{hoveredItem.name}</div>
              {#if hoveredItem.hasRunningProcess}
                <span
                  class="px-1 py-0.5 text-ui font-bold bg-green-500/20 text-green-600 dark:text-green-400 rounded"
                >
                  RUNNING
                </span>
              {/if}
            </div>
          </div>
        </div>

        <!-- Created at time -->
        <div class="px-3 text-xs text-subtle">
          Created {formatRelativeTime(hoveredItem.createdAt)}
        </div>

        <!-- Last Command (if available) -->
        {#if hoveredItem.lastCommand}
          <div class="px-3 whitespace-break-spaces wrap-break-word">
            <div class="text-xs text-subtle font-medium line-clamp-3">
              $ {hoveredItem.lastCommand}
            </div>
          </div>
        {/if}

        <!-- Last Output (if available and not too long) -->
        {#if hoveredItem.lastOutput && hoveredItem.lastOutput.length > 0}
          <div class="px-3 whitespace-break-spaces wrap-break-word">
            <div class="text-xs line-clamp-3 font-mono">
              {truncateText(hoveredItem.lastOutput, 150)}
            </div>
          </div>
        {/if}

        <!-- No activity state -->
        {#if !hoveredItem.lastCommand && !hoveredItem.lastOutput}
          <div class="pb-3 px-3 text-xs text-subtle italic">
            {#if hoveredItem.hasRunningProcess}
              Process running...
            {:else}
              Ready for input
            {/if}
          </div>
        {/if}
      </div>
    </HoverCard>
  {/if}
{/if}
