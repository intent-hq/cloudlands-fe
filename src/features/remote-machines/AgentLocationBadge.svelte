<!--
  Where agent `agentId` runs: the machine badge for a remote agent, nothing for
  a local one. `icon` for agent rows, `pill` for the panel header chip.
-->
<script lang="ts">
  import { writable } from 'svelte/store';
  import { selectAgentSession } from '$store/renderer/slices/agent-session/agent-session-selectors';
  import AgentMachineBadge from './AgentMachineBadge.svelte';
  import { agentMachineLocation } from './agent-location';
  import { selectRemoteMachine } from './remote-machines-selectors';

  interface Props {
    agentId: string;
    variant?: 'icon' | 'pill';
    hidden?: boolean;
  }

  let { agentId, variant = 'icon', hidden = false }: Props = $props();

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
  <AgentMachineBadge {location} {variant} />
{/if}
