<script lang="ts">
  import { onMount } from 'svelte';
  import { observeAgentMutationIntents } from '../../../../test/observe-agent-mutation-intents';
  import RetireAgentModal from '../RetireAgentModal.svelte';

  let { onRequested }: { onRequested: Parameters<typeof observeAgentMutationIntents>[0] } =
    $props();
  onMount(() => observeAgentMutationIntents((payload) => onRequested(payload)));
</script>

<RetireAgentModal
  open
  agentName="Keyboard fixture"
  workspaceId="retire-keyboard-workspace"
  agentId="retire-keyboard-agent"
/>
