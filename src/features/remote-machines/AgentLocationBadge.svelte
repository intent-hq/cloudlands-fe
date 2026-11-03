<!--
  Where agent `agentId` runs, for agent rows: the machine badge for a remote
  agent, nothing for a local one.
-->
<script lang="ts">
  import { writable } from 'svelte/store';
  import { selectAgentSession } from '$store/renderer/slices/agent-session/agent-session-selectors';
  import AgentMachineBadge from './AgentMachineBadge.svelte';
  import { agentMachineLocation } from './agent-location';
  import { selectRemoteMachine } from './remote-machines-selectors';

  interface Props {
    agentId: string;
    hidden?: boolean;
  }

  let { agentId, hidden = false }: Props = $props();

  const agentIdStore = writable<string | undefined>(undefined);
  const machineIdStore = writable<string | undefined>(undefined);
  $effect(() => {
    agentIdStore.set(agentId);
  });
  const agent$ = selectAgentSession(agentIdStore);
  $effect(() => {
    machineIdStore.set($agent$?.nodeId);
  });
  const machine$ = selectRemoteMachine(machineIdStore);
  const location = $derived(agentMachineLocation($agent$, $machine$));
</script>

{#if location && !hidden}
  <AgentMachineBadge {location} />
{/if}
