<script lang="ts">
  /**
   * InlineAgentAvatar Component
   * A small inline avatar for an agent, used in the collapsed AgentSubscriptions view.
   * Subscribes to agent updates to show real-time state.
   */
  import AugieAvatarWithState from '../ui/auggie-avatar/AugieAvatarWithState.svelte';
  import { useAgentSubscription } from '$lib/utils/agent-subscription.svelte';
  import { getAgentPeekData } from '$lib/utils/agent-peek-utils';
  import { getAvatarState } from '../ui/auggie-avatar/avatar-state';
  import { permissionStore } from '$lib/stores/permission.store.svelte';
  import * as Tooltip from '$lib/components/ui/tooltip';

  interface Props {
    agentId: string;
  }

  let { agentId }: Props = $props();

  // Subscribe to agent updates for real-time state
  const agentSubscription = useAgentSubscription(agentId);
  const agent = $derived(agentSubscription.current);
  const agentData = $derived(getAgentPeekData(agent));

  // Get avatar state
  const state = $derived(
    getAvatarState(
      {
        isStreaming: agentData?.isResponding,
        status: agentData?.status,
      },
      {
        hasPermissionRequest: permissionStore.getPendingCount(agentId) > 0,
      },
    ),
  );

  // Get specialist from agent metadata (typed to match AugieAvatarWithState)
  const specialist = $derived.by(() => {
    const specialistId = agent?.metadata?.specialist || agent?.agentMetadata?.specialist;
    if (specialistId === 'spec-writer' || specialistId === 'implementor' || specialistId === 'verifier') {
      return specialistId;
    }
    return null;
  });

  // Display name for tooltip
  const displayName = $derived(agentData?.name || 'Agent');
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
