<script lang="ts" module>
  // Fixed card size for consistent layout - exported for use in parent components
  export const CARD_WIDTH = 180;
  export const CARD_HEIGHT = 180; // Square cards
</script>

<script lang="ts">
  /**
   * AgentHierarchyCard Component
   *
   * A card displaying an agent in the hierarchy graph.
   * Fixed width for consistent layout and connector line alignment.
   */
  import type { AgentNode } from './types';
  import AugieAvatarWithState from '$lib/components/ui/auggie-avatar/AugieAvatarWithState.svelte';
  import type { AvatarState } from '$lib/components/ui/auggie-avatar/avatar-state';
  import { Spinner } from '$lib/components/ui/indicators';
  import { classifyTool } from '$lib/components/chat/tool-classifier';
  import Fa from 'svelte-fa';
  import { faHourglass, faFile, faStickyNote } from '@fortawesome/free-solid-svg-icons';

  interface Props {
    agent: AgentNode;
    activeFile?: string;
    activeNote?: string;
    /** Map of agentId -> agent name for displaying waiting-for names */
    agentNames?: Map<string, string>;
    onclick?: (event: MouseEvent) => void;
    onmouseenter?: (event: MouseEvent) => void;
    onmouseleave?: (event: MouseEvent) => void;
  }

  let { agent, activeFile, activeNote, agentNames, onclick, onmouseenter, onmouseleave }: Props =
    $props();

  const isActive = $derived(agent.status === 'responding');
  const isWaiting = $derived(
    agent.status === 'waiting' || (agent.waitingForAgentIds && agent.waitingForAgentIds.length > 0),
  );

  // Get names of agents we're waiting for
  const waitingForNames = $derived.by(() => {
    if (!agent.waitingForAgentIds || agent.waitingForAgentIds.length === 0) return [];
    return agent.waitingForAgentIds.map((id) => agentNames?.get(id) || 'Agent').slice(0, 2);
  });

  // Map agent status to avatar state
  function getAvatarState(status: AgentNode['status']): AvatarState {
    if (status === 'responding') return 'running';
    if (status === 'waiting') return 'waiting';
    if (status === 'completed') return 'completed';
    if (status === 'failed') return 'failed';
    return 'idle';
  }

  const avatarState = $derived(getAvatarState(agent.status));
</script>

<div class="agent-card-wrapper flex items-center gap-3 shadow">
  <!-- Left activity pill (file) -->
  {#if activeFile && isActive}
    <div
      class="activity-pill shrink-0 text-xs px-3 py-1.5 bg-muted/60 border border-border rounded-lg text-muted-foreground max-w-32 truncate"
    >
      <Fa icon={faFile} size="xs" class="inline" /> {activeFile}
    </div>
  {/if}

  <!-- Main agent card -->
  <button
    type="button"
    class="agent-card flex flex-col items-center px-2.5 py-4 bg-card border border-border
      hover:shadow transition-all cursor-pointer"
    class:border-primary={isWaiting}
    class:border-2={isWaiting}
    style="width: {CARD_WIDTH}px; height: {CARD_HEIGHT}px; anchor-name: --agent-hierarchy-{agent.agentId};"
    {onclick}
    {onmouseenter}
    {onmouseleave}
  >
    <div
      class="avatar-wrapper h-9 w-12 flex items-center justify-center bg-background rounded-full"
    >
      <AugieAvatarWithState
        agentId={agent.agentId}
        size={24}
        state={avatarState}
        specialist={agent.specialist as 'spec-writer' | 'implementor' | 'verifier' | null}
      />
    </div>
    <span class="font-semibold text-center leading-tight line-clamp-2">
      {agent.name}
    </span>
    <!-- {#if agent.specialist}
      <span class="text-sm text-muted-foreground mt-0.5 capitalize">{agent.specialist.replace('-', ' ')}</span>
    {/if} -->

    <!-- Status footer - shows current activity or last response -->
    <div class="status-footer mt-auto pt-2 w-full text-center">
      {#if isWaiting && waitingForNames.length > 0}
        <!-- Waiting for other agents -->
        <div class="text-sm text-primary flex items-center justify-center gap-1">
          <Fa icon={faHourglass} size="xs" class="animate-pulse" />
          <span class="truncate">Waiting for {waitingForNames.join(', ')}</span>
        </div>
      {:else if isActive}
        <!-- Active: always show spinner + descriptive label -->
        {@const toolDisplay = agent.activeToolName ? classifyTool(agent.activeToolName, agent.activeToolInput || {}) : null}
        <div class="flex flex-col items-center gap-1">
          <div class="flex items-center justify-center gap-1.5">
            <Spinner seed={agent.agentId} size={4} />
            {#if toolDisplay && toolDisplay.subject}
              <span class="status-pill text-xs px-1.5 py-0.5 bg-muted/80 rounded-md text-muted-foreground truncate max-w-[130px]">
                {toolDisplay.verb} {toolDisplay.subject}
              </span>
            {:else if toolDisplay}
              <span class="text-xs text-muted-foreground">{toolDisplay.verb}...</span>
            {:else if agent.isThinking}
              <span class="text-xs text-muted-foreground">Thinking...</span>
            {:else}
              <span class="text-xs text-muted-foreground">Responding...</span>
            {/if}
          </div>
          {#if !toolDisplay && (agent.streamingText || agent.lastResponse)}
            <div class="text-[11px] text-muted-foreground/60 truncate w-full px-1 leading-tight">
              {agent.streamingText || agent.lastResponse}
            </div>
          {/if}
        </div>
      {:else if agent.lastResponse}
        <!-- Last response (when idle) -->
        <div class="text-sm text-muted-foreground/70 line-clamp-3 leading-tight">
          {agent.lastResponse}
        </div>
      {/if}
    </div>
  </button>

  <!-- Right activity pill (note) -->
  {#if activeNote && isActive}
    <div
      class="activity-pill shrink-0 text-xs px-3 py-1.5 bg-muted/60 border border-border rounded-lg text-muted-foreground max-w-32 truncate"
    >
      <Fa icon={faStickyNote} size="xs" class="inline" /> Note
    </div>
  {/if}
</div>
