<!--
  The machine a remote agent's run of a saved script runs on. `icon` is the
  agent-row machine badge; `label` reads "On <machine>" and stands where a
  backend service shows its Open link (machine ports are not tunnelled).
  Callers render it only on `remoteScripts: 1` backends.
-->
<script lang="ts">
  import Fa from 'svelte-fa';
  import { untrack } from 'svelte';
  import { writable } from 'svelte/store';
  import { m } from '$shared/paraglide/messages.js';
  import { faDesktop } from '$lib/icons/phosphor-icons';
  import AgentMachineBadge from '$features/remote-machines/AgentMachineBadge.svelte';
  import { agentMachineTooltip } from '$features/remote-machines/agent-location';
  import { selectRemoteMachine } from '$features/remote-machines/remote-machines-selectors';
  import { selectAgentSession } from '$store/renderer/slices/agent-session/agent-session-selectors';
  import type { ScriptMachineRun } from '../types';
  import { machineRunLocation } from '../utils/script-location';

  interface Props {
    run: Pick<ScriptMachineRun, 'remoteAgentId' | 'nodeId'>;
    variant?: 'icon' | 'label';
  }

  let { run, variant = 'icon' }: Props = $props();

  // Seeded with the first ids so the first paint already names the machine.
  const agentIdStore = writable<string | undefined>(untrack(() => run.remoteAgentId));
  const machineIdStore = writable<string | undefined>(untrack(() => run.nodeId));
  $effect(() => {
    agentIdStore.set(run.remoteAgentId);
    machineIdStore.set(run.nodeId);
  });
  const agent$ = selectAgentSession(agentIdStore);
  const machine$ = selectRemoteMachine(machineIdStore);
  const location = $derived(machineRunLocation(run, $agent$, $machine$));
  const tooltip = $derived(agentMachineTooltip(location));
</script>

{#if variant === 'label'}
  <span
    class="flex min-w-0 flex-shrink-0 items-center gap-1 text-xs text-muted-foreground"
    title={tooltip}
    data-script-machine="label"
    data-script-machine-state={location.state}
  >
    <Fa icon={faDesktop} size="xs" />
    <span class="max-w-50 truncate"
      >{m.scripts_remote_runsOn_label({ machine: location.name })}</span
    >
  </span>
{:else}
  <span class="inline-flex shrink-0" data-script-machine="icon">
    <AgentMachineBadge {location} />
  </span>
{/if}
