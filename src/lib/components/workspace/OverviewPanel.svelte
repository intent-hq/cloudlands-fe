<script lang="ts">
  import { cn } from '$lib/utils';
  import { Fa } from 'svelte-fa';
  import { faPlus } from '@fortawesome/free-solid-svg-icons';
  import { Button } from '$lib/components/ui/button';
  import AgentCard from '$lib/components/chat/AgentCard.svelte';
  import { terminalHistoryTracker } from '$features/terminal/terminal-history-tracker';
  import { useAllAgentsSubscription } from '$lib/utils/agent-subscription.svelte';
  import { workspaceStore } from '$features/workspace/workspace.store.svelte';
  import type { FileOperation, AgentStatus } from '$shared/types';
  import type { WorkspaceId } from '$shared/types/branded-ids';

  interface AgentSummary {
    id: string;
    name: string;
    status?: AgentStatus | string;
    lastUserMessage?: string;
    lastResponse?: string;
    fileChanges?: FileOperation[];
    isResponding?: boolean;
    isStreaming?: boolean;
    updatedAt?: Date | string;
    createdAt?: Date | string;
    messages?: any[];
    metadata?: {
      isBackground?: boolean;
      triggerType?: string;
      taskNoteId?: string;
      [key: string]: any;
    };
    isBackground?: boolean;
    digest?: string;
  }

  interface TerminalSummary {
    id: string;
    name?: string;
    lastCommand?: string;
    isRunning?: boolean;
    isExecuting?: boolean;
    cwd?: string;
  }

  let {
    agents = [],
    terminals = [],
    workspaceId = '',
    onSelectAgent,
    onSelectTerminal,
    onCreateAgent,
    onCreateTerminal,
    class: className = '',
  }: {
    agents?: AgentSummary[];
    terminals?: TerminalSummary[];
    workspaceId?: string;
    onSelectAgent?: (agentId: string) => void;
    onSelectTerminal?: (terminalId: string) => void;
    onCreateAgent?: () => void;
    onCreateTerminal?: () => void;
    class?: string;
  } = $props();

  // Resolve the Workspace object from workspaceId so AgentCard can scope its subscription.
  const resolvedWorkspace = $derived(workspaceStore.findById(workspaceId as WorkspaceId) ?? null);

  // Subscribe to session store for real-time message updates. Pass workspaceId to trigger loading from disk if needed.
  const agentSubscription = useAllAgentsSubscription(() => workspaceId);

  // Filter agents by workspaceId using $derived - this is reactive to workspaceId prop changes
  const workspaceAgentSessions = $derived.by(() => {
    const allAgents = agentSubscription.all;
    if (!workspaceId) return allAgents;
    const wsIdStr = String(workspaceId);
    return allAgents.filter((s) => {
      const agentWsId = s.workspaceId ? String(s.workspaceId) : '';
      return agentWsId === wsIdStr;
    });
  });

  // Get terminal history for richer terminal info
  function getTerminalHistory(terminalId: string) {
    return terminalHistoryTracker.getHistory(terminalId);
  }

  // Make the agents list reactive and dedupe by ID to avoid duplicate key errors
  const reactiveAgents = $derived.by(() => {
    const arr = agents || [];
    const seen = new Set<string>();
    const result: AgentSummary[] = [];
    for (const a of arr) {
      if (a && a.id && !seen.has(a.id)) {
        seen.add(a.id);
        result.push(a);
      }
    }
    // Sort: coordinator first, then by most recently updated
    return result.sort((a, b) => {
      const aCoord = isCoordinatorAgent(a);
      const bCoord = isCoordinatorAgent(b);
      if (aCoord && !bCoord) return -1;
      if (!aCoord && bCoord) return 1;
      const aTime = new Date(a.updatedAt || a.createdAt || 0).getTime();
      const bTime = new Date(b.updatedAt || b.createdAt || 0).getTime();
      return bTime - aTime;
    });
  });

  // Count actively working agents using subscription data
  const activeAgentCount = $derived(
    workspaceAgentSessions.filter((s) => s.isStreaming || s.isProcessing).length,
  );

  // Check if an agent is the coordinator (must be a spec-writer specialist)
  function isCoordinatorAgent(agent: AgentSummary): boolean {
    return agent.metadata?.specialist === 'spec-writer';
  }

  // Whether the workspace has a coordinator
  const hasCoordinator = $derived(reactiveAgents.some(isCoordinatorAgent));
</script>

<div class={cn('overview-panel h-full overflow-y-auto', className)}>
  <div class="space-y-6 p-3">
    <!-- Agents Section -->
    <section>
      <div class="flex items-center justify-between mb-1.5 px-0.5">
        <div class="flex items-center gap-2">
          <h2 class="text-ui font-medium text-muted-foreground uppercase tracking-wide">
            Agents
          </h2>
          {#if activeAgentCount > 0}
            <span class="text-ui text-blue-500">
              {activeAgentCount} working
            </span>
          {/if}
        </div>
        {#if onCreateAgent}
          <Button
            size="icon-xs"
            variant="ghost"
            onclick={onCreateAgent}
            class="h-5 w-5 opacity-50 hover:opacity-100"
          >
            <Fa icon={faPlus} size="xs" />
          </Button>
        {/if}
      </div>

      {#if reactiveAgents.length === 0}
        <button
          type="button"
          class="w-full py-6 rounded-md border border-dashed border-border/40 hover:border-border/60 transition-colors cursor-pointer group"
          onclick={onCreateAgent}
        >
          <div
            class="flex flex-col items-center gap-1.5 text-muted-foreground group-hover:text-muted-foreground"
          >
            <Fa icon={faPlus} size="xs" />
            <span class="text-ui">New agent</span>
          </div>
        </button>
      {:else}
        <div class="space-y-1">
          {#each reactiveAgents as agent, i (agent.id)}
            {#if hasCoordinator && isCoordinatorAgent(agent) && i === 0}
              <div class="pt-0.5 pb-0.5">
                <span class="text-ui font-medium text-muted-foreground uppercase tracking-wider"
                  >Coordinator</span
                >
              </div>
            {/if}
            {#if hasCoordinator && !isCoordinatorAgent(agent)}
              {@const isFirstNonCoordinator = reactiveAgents.slice(0, i).every(isCoordinatorAgent)}
              {#if isFirstNonCoordinator}
                <div class="pt-2 pb-0.5">
                  <span class="text-ui font-medium text-muted-foreground uppercase tracking-wider"
                    >Your Agents</span
                  >
                  <p class="text-xs text-subtle mt-0.5">
                    The Coordinator can delegate and verify tasks for these agents
                  </p>
                </div>
              {/if}
            {/if}
            <AgentCard
              agentId={agent.id}
              agentName={agent.name}
              isBackground={agent.metadata?.isBackground || agent.isBackground}
              onclick={() => onSelectAgent?.(agent.id)}
              workspace={resolvedWorkspace}
            />
          {/each}
        </div>
      {/if}
    </section>

    <!-- Terminals Section -->
    <section>
      <div class="flex items-center justify-between mb-1.5 px-0.5">
        <h2 class="text-ui font-medium text-muted-foreground uppercase tracking-wide">
          Terminals
        </h2>
        {#if onCreateTerminal}
          <Button
            size="icon-xs"
            variant="ghost"
            onclick={onCreateTerminal}
            class="h-5 w-5 opacity-50 hover:opacity-100"
          >
            <Fa icon={faPlus} size="xs" />
          </Button>
        {/if}
      </div>

      {#if terminals.length === 0}
        <button
          type="button"
          class="w-full py-6 rounded-md border border-dashed border-border/40 hover:border-border/60 transition-colors cursor-pointer group"
          onclick={onCreateTerminal}
        >
          <div
            class="flex flex-col items-center gap-1.5 text-muted-foreground group-hover:text-muted-foreground"
          >
            <span class="font-mono text-xs">$</span>
            <span class="text-ui">New terminal</span>
          </div>
        </button>
      {:else}
        <div class="space-y-px">
          {#each terminals as terminal, index (terminal.id)}
            {@const history = getTerminalHistory(terminal.id)}
            {@const isExecuting =
              history?.isExecuting || terminal.isExecuting || terminal.isRunning}
            {@const lastCommand = history?.lastCommand || terminal.lastCommand}

            <button
              type="button"
              class="w-full text-left px-2 py-2 -mx-0.5 rounded-md transition-colors cursor-pointer group hover:bg-muted/40"
              onclick={() => onSelectTerminal?.(terminal.id)}
            >
              <div class="flex items-center gap-2.5">
                <!-- Terminal icon -->
                <div
                  class="shrink-0 w-6 h-6 rounded flex items-center justify-center font-mono text-xs text-subtle"
                >
                  {#if isExecuting}
                    <span class="relative flex h-2 w-2">
                      <span
                        class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"
                      ></span>
                      <span class="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                    </span>
                  {:else}
                    $
                  {/if}
                </div>

                <div class="flex-1 min-w-0">
                  <h3 class="text-[13px] text-foreground/90 group-hover:text-foreground">
                    {terminal.name || `Terminal ${index + 1}`}
                  </h3>
                  {#if lastCommand}
                    <p class="text-ui font-mono text-subtle truncate">
                      {lastCommand}
                    </p>
                  {/if}
                </div>

                {#if isExecuting}
                  <span class="text-ui text-emerald-500 shrink-0">Running</span>
                {/if}
              </div>
            </button>
          {/each}
        </div>
      {/if}
    </section>
  </div>
</div>
