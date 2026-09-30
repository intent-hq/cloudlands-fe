<script lang="ts" module>
  import { definePreview } from '$lib/component-catalog/preview-definition';
  export const preview = definePreview<{
    remoteEnabled: boolean;
    supported: boolean;
    remoteDefault?: boolean;
  }>({
    id: 'agent-placement',
    title: 'Agent placement',
    defaultState: 'local',
    states: {
      local: { props: { remoteEnabled: false, supported: true } },
      remote: { props: { remoteEnabled: true, supported: true } },
      'remote-disabled': { props: { remoteEnabled: false, supported: true, remoteDefault: true } },
      unavailable: { props: { remoteEnabled: false, supported: false } },
    },
  });
</script>

<script lang="ts">
  import AgentPlacementPicker from './AgentPlacementPicker.svelte';
  import type { AgentPlacement } from '$shared/types/agent-node';
  let {
    remoteEnabled,
    supported,
    remoteDefault = false,
  }: { remoteEnabled: boolean; supported: boolean; remoteDefault?: boolean } = $props();
  let chosen = $state<AgentPlacement>();
</script>

<div data-agent-placement-preview class="w-full max-w-sm p-4 space-y-2">
  <AgentPlacementPicker
    value={chosen ?? (remoteDefault ? { target: 'remote', checkout: 'isolated' } : undefined)}
    capabilities={{ agentNodes: supported, localNodeIsolation: supported }}
    {remoteEnabled}
    onchange={(value) => {
      chosen = value;
    }}
  />
</div>
