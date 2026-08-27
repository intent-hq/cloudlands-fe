<script lang="ts">
  import AgentAvatarWithState from '$features/agent/components/agent-avatar/AgentAvatarWithState.svelte';
  import { getAvatarStateForSession } from '$features/agent/components/agent-avatar/avatar-state';
  import { deriveWizardPendingQuestions } from '$lib/components/chat/questions/wizard-gate';
  import {
    selectAgentProvider,
    selectAgentSession,
  } from '$store/renderer/slices/agent-session/agent-session-selectors';
  import { selectHudAgentHasPendingQuestion } from '$store/renderer/slices/hud/hud-selectors';
  import { selectPendingCount } from '$store/renderer/slices/permission/permission-selectors';
  import { store as appStore } from '$store/renderer/store';

  interface Props {
    agentId: string;
  }

  let { agentId }: Props = $props();

  // Selector readables initialize once; PanelTabBar keys this presenter by agent ID.
  // svelte-ignore state_referenced_locally
  const session$ = selectAgentSession(agentId);
  // svelte-ignore state_referenced_locally
  const provider$ = selectAgentProvider(agentId);
  // svelte-ignore state_referenced_locally
  const permissionCount$ = selectPendingCount(agentId);
  // svelte-ignore state_referenced_locally
  const hasCapturedQuestion$ = selectHudAgentHasPendingQuestion(agentId);

  const specialist = $derived(
    $session$?.metadata?.specialist ?? $session$?.agentMetadata?.specialist ?? null,
  );
  const hasQuestion = $derived(
    $hasCapturedQuestion$ ||
      deriveWizardPendingQuestions(appStore.state, agentId, $session$?.messages ?? []) !== null,
  );
  const state = $derived(
    getAvatarStateForSession($session$, {
      isActive: true,
      hasPermissionRequest: $permissionCount$ > 0,
      hasQuestion,
    }),
  );
</script>

<AgentAvatarWithState {agentId} variant="emphasized" {state} {specialist} provider={$provider$} />
