<script lang="ts">
  import { faPlus, faTerminal, faCommentDots } from '@fortawesome/free-solid-svg-icons';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { ListContainer, ListItem, ListEmpty } from '$lib/components/ui/list';
  import { Button } from '$lib/components/ui/button';
  import Fa from 'svelte-fa';
  import { terminalHistoryTracker } from '$features/terminal/terminal-history-tracker';

  interface Terminal {
    id: string;
    name: string;
    type: 'terminal' | 'chat';
    createdAt: number;
    sessionId?: string;
    hasAuggieSession?: boolean;
    viewMode?: 'terminal' | 'chat';
    lastCommand?: string;
    lastOutput?: string;
    lastUserMessage?: string;
    isAgentResponding?: boolean;
    hasRunningProcess?: boolean;
    agentName?: string;
  }

  // Props
  let {
    terminals = [],
    selectedTerminalId = null,
    onOpenTerminal = () => {},
    onCreateTerminal = () => {},
  }: {
    terminals?: Terminal[];
    selectedTerminalId?: string | null;
    onOpenTerminal?: (terminalId: string, terminalData?: Terminal) => void;
    onCreateTerminal?: () => void;
  } = $props();

  // Subscribe to history updates to trigger reactivity
  const historyUpdateCounter = terminalHistoryTracker.updateCounter;

  // Local state
  let isLoading = $state(false);

  // Enrich terminals with history data (like TerminalNavRail does)
  const enrichedTerminals = $derived(
    terminals.map((terminal) => {
      // Access the store value to establish dependency
      void $historyUpdateCounter;
      // Get history from the tracker
      const history = terminalHistoryTracker.getHistory(terminal.id);

      const lastCommand = history?.lastCommand || terminal.lastCommand || '';
      const lastOutput = history?.lastOutput || terminal.lastOutput || '';
      const hasRunningProcess =
        history?.isExecuting || terminal.hasRunningProcess || terminal.isAgentResponding || false;

      return {
        ...terminal,
        lastCommand,
        lastOutput,
        hasRunningProcess,
      };
    }),
  );

  // Get terminal icon
  function getTerminalIcon(terminal: Terminal) {
    if (terminal.type === 'chat') {
      return faCommentDots;
    }
    return faTerminal;
  }

  // Get terminal subtitle - shows last command and part of output
  function getTerminalSubtitle(terminal: Terminal & { lastOutput?: string }): string {
    const parts: string[] = [];

    if (terminal.lastCommand) {
      // Show command with $ prefix
      const cmd = terminal.lastCommand;
      const truncatedCmd = cmd.length > 35 ? cmd.substring(0, 35) + '...' : cmd;
      parts.push(`$ ${truncatedCmd}`);
    }

    if (terminal.lastOutput && terminal.lastOutput.length > 0) {
      const output = terminal.lastOutput.trim();
      // Show first line or truncated output
      const firstLine = output.split('\n')[0].trim();
      if (firstLine.length > 0) {
        const truncatedOutput = firstLine.length > 30 ? firstLine.substring(0, 30) + '...' : firstLine;
        parts.push(`→ ${truncatedOutput}`);
      }
    }

    if (parts.length > 0) {
      return parts.join(' ');
    }

    if (terminal.lastUserMessage) {
      const msg = terminal.lastUserMessage;
      return msg.length > 40 ? msg.substring(0, 40) + '...' : msg;
    }

    return '';
  }
</script>

<!-- Header with new button -->
<div class="flex items-center justify-end px-3 pb-2">
  <!-- New terminal button -->
  <Button
    variant="ghost-light"
    size="icon-xs"
    onclick={onCreateTerminal}
    tooltip="New terminal"
    tooltipShortcut="mod+`"
    class="shrink-0"
  >
    <Fa icon={faPlus} size="xs" />
  </Button>
</div>

<div class="flex flex-col h-full">
  {#if isLoading}
    <div class="p-3 space-y-2">
      {#each Array(3) as _}
        <Skeleton class="h-12 w-full" />
      {/each}
    </div>
  {:else if enrichedTerminals.length === 0}
    <ListEmpty message="No terminals yet" icon={faTerminal} />
  {:else}
    <ListContainer spacing="compact">
      {#each enrichedTerminals as terminal (terminal.id)}
        {@const subtitle = getTerminalSubtitle(terminal)}
        <ListItem
          onclick={() => onOpenTerminal(terminal.id, terminal)}
          icon={getTerminalIcon(terminal)}
          title={terminal.name}
          subtitle={subtitle || undefined}
          badge={terminal.hasRunningProcess ? 'Running' : undefined}
          badgeClass={terminal.hasRunningProcess ? 'bg-green-500/20 text-green-500' : undefined}
          loading={terminal.hasRunningProcess}
          selected={terminal.id === selectedTerminalId}
          size="sm"
        />
      {/each}
    </ListContainer>
  {/if}
</div>
