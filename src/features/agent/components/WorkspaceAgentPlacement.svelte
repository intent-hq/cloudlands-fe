<script lang="ts">
  import { selectDaemonConnectionGeneration } from '$store/renderer/slices/daemon-health/daemon-health-selectors';
  import { toStore } from 'svelte/store';
  import { selectLabsRemoteAgentsEnabled } from '$store/renderer/slices/user-preferences/user-preferences-selectors';
  import { selectWorkspaceById } from '$store/renderer/slices/workspace/workspace-selectors';
  import {
    selectNodeCapabilities,
    selectNodeOperationBusy,
  } from '$store/renderer/slices/workspace-agents/workspace-agents-selectors';
  import {
    nodeCapabilitiesRequested,
    agentPlacementSaveRequested,
  } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
  import { store } from '$store/renderer/store';
  import { SettingsFieldRow } from '$lib/components/patterns/settings';
  import { m } from '$shared/paraglide/messages.js';
  import AgentPlacementPicker from './AgentPlacementPicker.svelte';

  let { workspaceId }: { workspaceId: string } = $props();
  const workspace = selectWorkspaceById(toStore(() => workspaceId));
  const remoteEnabled = selectLabsRemoteAgentsEnabled();
  const capabilities = selectNodeCapabilities();
  const busy = selectNodeOperationBusy();
  const generation = selectDaemonConnectionGeneration();
  $effect(() => {
    void $generation;
    store.dispatch(nodeCapabilitiesRequested());
  });
</script>

<div class="px-4 py-2 space-y-1">
  <SettingsFieldRow id="agent-placement" label={m.agent_placement_label()}>
    <AgentPlacementPicker
      value={$workspace?.defaultAgentPlacement}
      capabilities={$capabilities}
      remoteEnabled={$remoteEnabled}
      disabled={$busy}
      onchange={(placement) => store.dispatch(agentPlacementSaveRequested(workspaceId, placement))}
    />
  </SettingsFieldRow>
</div>
