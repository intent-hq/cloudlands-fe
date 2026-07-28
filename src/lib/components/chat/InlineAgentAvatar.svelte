<script lang="ts">
  /**
   * InlineAgentAvatar Component
   * A small inline avatar for an agent, used in the collapsed AgentSubscriptions view.
   * Subscribes to agent updates to show real-time state.
   */
  import AugieAvatarWithState from '../ui/auggie-avatar/AugieAvatarWithState.svelte';

  import {
  selectAgentIsResponding,
  selectAgentIsWaiting,
  selectAgentSession,
} from '$store/renderer/slices/agent-session/agent-session-selectors';
  import { ensureAgentSessionLoaded } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';

  import { getAgentPeekData } from '$lib/utils/agent-peek-utils';
  import { getAvatarState } from '../ui/auggie-avatar/avatar-state';
  import { selectPendingCount } from '$store/renderer/slices/permission/permission-selectors';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import type { Workspace } from '$shared/types';
  import { store as appStore } from '$store/renderer/store';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    agentId: string;
    /** Optional workspace for scoping the agent subscription (prevents cross-workspace bleed) */
    workspace?: Workspace | null;
    /** Whether the agent has finished its delegated work (forces completed avatar state) */
    isCompleted?: boolean;
  }

  let { agentId, workspace = null, isCompleted = false }: Props = $props();

  const permissionCount = selectPendingCount(agentId);

  // Reactive agent session from Redux; the ensure saga handles the
  // disk restore.
  const agent$ = selectAgentSession(agentId);
  const agentIsResponding$ = selectAgentIsResponding(agentId);
  const agentIsWaiting$ = selectAgentIsWaiting(agentId);
  const agentData = $derived(getAgentPeekData($agent$));

  $effect(() => {
    const wsId = workspace?.id;
    if (wsId) {
      appStore.dispatch(ensureAgentSessionLoaded(String(wsId), agentId));
    }
  });

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
  const displayName = $derived(agentData?.name || m.chat_shared_agentName_fallback());
</script>

<!-- Provider ensures proper context and cleanup during component destruction -->
<Tooltip.Provider delayDuration={0}>
  <Tooltip.Root delayDuration={0}>
    <Tooltip.Trigger>
      <div class="ring-2 ring-background rounded-full">
        <AugieAvatarWithState {agentId} size={18} {state} {specialist} />
      </div>
    </Tooltip.Trigger>
    <Tooltip.Content side="top" class="text-xs">
      <p>{displayName}</p>
    </Tooltip.Content>
  </Tooltip.Root>
</Tooltip.Provider>
