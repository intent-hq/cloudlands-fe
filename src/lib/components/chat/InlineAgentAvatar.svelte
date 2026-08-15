<script lang="ts">
  /**
   * InlineAgentAvatar Component
   * A small inline avatar for an agent, used in the collapsed AgentSubscriptions view.
   * Subscribes to agent updates to show real-time state.
   */
  import AugieAvatarWithState from '$features/agent/components/auggie-avatar/AugieAvatarWithState.svelte';

  import {
    selectAgentIsResponding,
    selectAgentIsWaiting,
    selectAgentSession,
  } from '$store/renderer/slices/agent-session/agent-session-selectors';
  import { ensureAgentSessionLoaded } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';

  import { getAgentPeekData } from '$lib/utils/agent-peek-utils';
  import { getAgentAttentionRequest } from '$shared/utils/agent-attention';
  import { getAvatarState } from '$features/agent/components/auggie-avatar/avatar-state';
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
  // svelte-ignore state_referenced_locally -- selector readables are init-time only; instances are keyed by agentId.
  const agentIsResponding$ = selectAgentIsResponding(agentId);
  // svelte-ignore state_referenced_locally -- selector readables are init-time only; instances are keyed by agentId.
  const agentIsWaiting$ = selectAgentIsWaiting(agentId);
  const agentData = $derived(getAgentPeekData($agent$));

  $effect(() => {
    const wsId = workspace?.id;
    if (wsId) {
      console.log('LOAD');
      appStore.dispatch(ensureAgentSessionLoaded(String(wsId), agentId));
    }
  });

  // Pending attention request (discussion/blocker), if any
  const attentionRequest = $derived(getAgentAttentionRequest($agent$));

  // Get avatar state
  const state = $derived(
    getAvatarState(
      {
        isStreaming: $agentIsResponding$ && !$agentIsWaiting$,
        status: $agentIsWaiting$ ? 'waiting' : agentData?.status,
      },
      {
        hasPermissionRequest: $permissionCount > 0,
        isCompleted,
        attentionKind: attentionRequest?.kind ?? null,
      },
    ),
  );

  // Get specialist from agent metadata (typed to match AugieAvatarWithState)
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
      class="rounded-full transition-colors hover:bg-muted/40 focus-visible:bg-muted/60 focus-visible:outline-none"
      {onclick}
      aria-label={onclick
        ? m.chat_msgAttribution_openAgent_title({ name: displayName })
        : undefined}
    >
      <div class="relative rounded-full ring-1 ring-card">
        <AugieAvatarWithState {agentId} size={18} {state} {specialist} />
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
