<script lang="ts">
  /**
   * InlineAgentAvatar Component
   * A small inline avatar for an agent, used in the collapsed AgentSubscriptions view.
   * Subscribes to agent updates to show real-time state.
   */
  import AgentAvatarWithState from '$features/agent/components/agent-avatar/AgentAvatarWithState.svelte';

  import { selectAgentSession } from '$store/renderer/slices/agent-session/agent-session-selectors';
  import { ensureAgentSessionLoaded } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';

  import { getAgentPeekData } from '$lib/utils/agent-peek-utils';
  import { getAgentAttentionRequest } from '$shared/utils/agent-attention';
  import { getAvatarStateForSession } from '$features/agent/components/agent-avatar/avatar-state';
  import { selectPendingCount } from '$store/renderer/slices/permission/permission-selectors';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import type { Workspace } from '$shared/types';
  import { store as appStore } from '$store/renderer/store';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    agentId: string;
    /** Static fallback while the session record is loading. */
    agentName?: string;
    /** Optional workspace for scoping the agent subscription (prevents cross-workspace bleed) */
    workspace?: Workspace | null;
    /** Whether the agent has finished its delegated work (forces completed avatar state) */
    isCompleted?: boolean;
    /** Optional activation used when the avatar represents a navigation target. */
    onclick?: (event: MouseEvent) => void;
  }

  let { agentId, agentName, workspace = null, isCompleted = false, onclick }: Props = $props();

  // svelte-ignore state_referenced_locally -- selector readables are init-time only; instances are keyed by agentId.
  const permissionCount = selectPendingCount(agentId);

  // Reactive agent session from Redux; the ensure saga handles the
  // disk restore.
  // svelte-ignore state_referenced_locally -- selector readables are init-time only; instances are keyed by agentId.
  const agent$ = selectAgentSession(agentId);
  const agentData = $derived(getAgentPeekData($agent$));

  $effect(() => {
    const wsId = workspace?.id;
    if (wsId) {
      appStore.dispatch(ensureAgentSessionLoaded(String(wsId), agentId));
    }
  });

  // Pending attention request (discussion/blocker), if any
  const attentionRequest = $derived(getAgentAttentionRequest($agent$));

  // Use the canonical session state derivation for every agent surface.
  const state = $derived(
    getAvatarStateForSession($agent$, {
      hasPermissionRequest: $permissionCount > 0,
      isCompleted,
      attentionKind: attentionRequest?.kind ?? null,
    }),
  );

  // Get specialist from agent metadata (typed to match AgentAvatarWithState)
  const specialist = $derived.by(() => {
    const specialistId = $agent$?.metadata?.specialist || $agent$?.agentMetadata?.specialist;
    if (
      specialistId === 'spec-writer' ||
      specialistId === 'implementor' ||
      specialistId === 'verifier'
    ) {
      return specialistId;
    }
    return null;
  });

  // Display name for tooltip
  const displayName = $derived(agentData?.name || agentName || m.chat_shared_agentName_fallback());
</script>

<!-- Provider ensures proper context and cleanup during component destruction -->
<Tooltip.Provider delayDuration={0}>
  <Tooltip.Root delayDuration={0}>
    <Tooltip.Trigger
      class="inline-agent-avatar-trigger transition-colors hover:bg-muted/40 focus-visible:bg-muted/60 focus-visible:outline-none"
      {onclick}
      data-testid="inline-agent-avatar-trigger"
      aria-label={onclick
        ? m.chat_msgAttribution_openAgent_title({ name: displayName })
        : undefined}
    >
      <div
        class="inline-agent-avatar-ring relative ring-1 ring-card"
        data-testid="inline-agent-avatar-ring"
      >
        <AgentAvatarWithState
          {agentId}
          variant="standard"
          {state}
          {specialist}
          class="inline-agent-avatar-surface"
        />
      </div>
    </Tooltip.Trigger>
    <Tooltip.Content side="top" class="text-xs">
      <p>{displayName}</p>
      {#if attentionRequest}
        <p class={attentionRequest.kind === 'blocker' ? 'text-red-500' : 'text-amber-500'}>
          {attentionRequest.kind === 'blocker'
            ? m.chat_agentCard_attentionBlocker_label()
            : m.chat_agentCard_attentionDiscussion_label()}{#if attentionRequest.reason}
            · {attentionRequest.reason}{/if}
        </p>
      {/if}
    </Tooltip.Content>
  </Tooltip.Root>
</Tooltip.Provider>

<style>
  :global(.inline-agent-avatar-trigger),
  .inline-agent-avatar-ring {
    display: inline-flex;
    box-sizing: border-box;
    width: var(--agent-avatar-standard-surface-size);
    height: var(--agent-avatar-standard-surface-size);
    flex: none;
    align-items: center;
    justify-content: center;
    border-radius: var(--agent-avatar-standard-corner-radius);
    line-height: 0;
  }

  :global(.inline-agent-avatar-trigger) {
    border: 0;
    padding: 0;
  }

  :global(.inline-agent-avatar-surface) {
    width: var(--agent-avatar-standard-surface-size);
    height: var(--agent-avatar-standard-surface-size);
    line-height: 0;
  }
</style>
