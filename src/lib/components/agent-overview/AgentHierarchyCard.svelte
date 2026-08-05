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
  import {
  selectAgentAttentionRequest,
  selectAgentIsResponding,
  selectAgentIsThinking,
  selectAgentIsWaiting,
  selectAgentIsWaitingForOtherAgents,
} from '$store/renderer/slices/agent-session/agent-session-selectors';
  import type { AgentAttentionKind } from '$shared/utils/agent-attention';
  import RelativeTime from '$lib/components/ui/RelativeTime.svelte';
  import Fa from 'svelte-fa';
  import {
  faHourglass,
  faFile,
  faStickyNote,
  faCommentDots,
  faCircleExclamation,
} from '@fortawesome/free-solid-svg-icons';
  import * as m from '$shared/paraglide/messages.js';

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

  // svelte-ignore state_referenced_locally -- hierarchy cards are mounted per agent; selector subscriptions are initialized once.
  const agentIsResponding$ = selectAgentIsResponding(agent.agentId);
  // Get names of agents we're waiting for
  const waitingForNames = $derived.by(() => {
    if (!agent.waitingForAgentIds || agent.waitingForAgentIds.length === 0) return [];
    return agent.waitingForAgentIds.map((id) => agentNames?.get(id) || m.agentOverview_hierarchyCard_agent_fallback()).slice(0, 2);
  });

  // svelte-ignore state_referenced_locally -- hierarchy cards are mounted per agent; selector subscriptions are initialized once.
  const agentIsThinking$ = selectAgentIsThinking(agent.agentId);
  // svelte-ignore state_referenced_locally -- hierarchy cards are mounted per agent; selector subscriptions are initialized once.
  const agentIsWaiting$ = selectAgentIsWaiting(agent.agentId);
  // svelte-ignore state_referenced_locally -- hierarchy cards are mounted per agent; selector subscriptions are initialized once.
  const agentIsWaitingForOtherAgents$ = selectAgentIsWaitingForOtherAgents(agent.agentId);
  // svelte-ignore state_referenced_locally -- hierarchy cards are mounted per agent; selector subscriptions are initialized once.
  const attentionRequest$ = selectAgentAttentionRequest(agent.agentId);

  // Map agent status to avatar state
  function getAvatarState(
    status: AgentNode['status'],
    waitingForOtherAgents: boolean,
    responding: boolean,
    attentionKind: AgentAttentionKind | null,
  ): AvatarState {
    if (status === 'completed') return 'completed';
    if (status === 'failed') return 'failed';
    if (attentionKind === 'discussion') return 'attention-discussion';
    if (attentionKind === 'blocker') return 'attention-blocker';
    if (waitingForOtherAgents) return 'waiting';
    if (responding) return 'running';
    return 'idle';
  }

  const avatarState = $derived(
    getAvatarState(
      agent.status,
      $agentIsWaitingForOtherAgents$,
      $agentIsResponding$,
      $attentionRequest$?.kind ?? null,
    ),
  );
</script>

<div class="agent-card-wrapper flex items-center gap-3 shadow">
  <!-- Left activity pill (file) -->
  {#if activeFile && $agentIsResponding$}
    <div
      class="activity-pill shrink-0 text-xs px-3 py-1.5 bg-muted/60 border border-border rounded-lg text-subtle max-w-32 truncate"
    >
      <Fa icon={faFile} size="xs" class="inline" /> {activeFile}
    </div>
  {/if}

  <!-- Main agent card -->
  <button
    type="button"
    class="agent-card flex flex-col items-center px-2.5 py-4 bg-card border border-border
      hover:shadow transition-all cursor-pointer"
    class:border-primary={$agentIsWaiting$}
    class:border-2={$agentIsWaiting$}
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
      <span class="text-sm text-subtle mt-0.5 capitalize">{agent.specialist.replace('-', ' ')}</span>
    {/if} -->

    <!-- Status footer - shows current activity or last response -->
    <div class="status-footer mt-auto pt-2 w-full text-center">
      {#if $attentionRequest$}
        <!-- Pending attention request (discussion/blocker) -->
        <div
          class="text-sm flex flex-col items-center gap-0.5 {$attentionRequest$.kind === 'blocker'
            ? 'text-red-500'
            : 'text-amber-500'}"
        >
          <div class="flex items-center justify-center gap-1">
            <Fa
              icon={$attentionRequest$.kind === 'blocker' ? faCircleExclamation : faCommentDots}
              size="xs"
            />
            <span class="truncate">
              {$attentionRequest$.kind === 'blocker'
                ? m.chat_agentCard_attentionBlocker_label()
                : m.chat_agentCard_attentionDiscussion_label()}
            </span>
          </div>
          {#if $attentionRequest$.reason}
            <div class="text-ui text-subtle line-clamp-2 leading-tight px-1">
              {$attentionRequest$.reason}
            </div>
          {/if}
          {#if $attentionRequest$.timestamp}
            <RelativeTime date={$attentionRequest$.timestamp} class="text-ui text-ghost" />
          {/if}
        </div>
      {:else if $agentIsWaitingForOtherAgents$}
        <!-- Waiting for other agents -->
        <div class="text-sm text-primary flex items-center justify-center gap-1">
          <Fa icon={faHourglass} size="xs" class="animate-pulse" />
          <span class="truncate">{m.agentOverview_hierarchyCard_waitingFor_label({ names: waitingForNames.join(', ') })}</span>
        </div>
      {:else if $agentIsResponding$ || $agentIsThinking$}
        <!-- Active: always show spinner + descriptive label -->
        {@const toolDisplay = agent.activeToolName ? classifyTool(agent.activeToolName, agent.activeToolInput || {}) : null}
        <div class="flex flex-col items-center gap-1">
          <div class="flex items-center justify-center gap-1.5">
            <Spinner seed={agent.agentId} size={4} />
            {#if $agentIsThinking$}
              <span class="text-xs text-subtle">{m.agentOverview_hierarchyCard_thinking_label()}</span>
            {:else if toolDisplay && toolDisplay.subject}
              <span class="status-pill text-xs px-1.5 py-0.5 bg-muted/80 rounded-md text-subtle truncate max-w-[130px]">
                {toolDisplay.verb} {toolDisplay.subject}
              </span>
            {:else if toolDisplay}
              <span class="text-xs text-subtle">{toolDisplay.verb}...</span>
            {:else}
              <span class="text-xs text-subtle">{m.agentOverview_hierarchyCard_responding_label()}</span>
            {/if}
          </div>
          {#if !toolDisplay && (agent.streamingText || agent.lastResponse)}
            <div class="text-ui text-subtle truncate w-full px-1 leading-tight">
              {agent.streamingText || agent.lastResponse}
            </div>
          {/if}
        </div>
      {:else if agent.lastResponse}
        <!-- Last response (when idle) -->
        <div class="text-sm text-subtle line-clamp-3 leading-tight">
          {agent.lastResponse}
        </div>
      {/if}
    </div>
  </button>

  <!-- Right activity pill (note) -->
  {#if activeNote && $agentIsResponding$}
    <div
      class="activity-pill shrink-0 text-xs px-3 py-1.5 bg-muted/60 border border-border rounded-lg text-subtle max-w-32 truncate"
    >
      <Fa icon={faStickyNote} size="xs" class="inline" /> {m.agentOverview_hierarchyCard_note_label()}
    </div>
  {/if}
</div>
