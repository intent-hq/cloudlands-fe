<script lang="ts">
  import FormDialog from '$lib/components/patterns/confirm/FormDialog.svelte';
  import { m } from '$shared/paraglide/messages.js';
  import type { AgentPlacement } from '$shared/types/agent-node';
  import type { NodeCapabilities } from '../services/node-execution';
  import AgentPlacementPicker from './AgentPlacementPicker.svelte';

  let {
    capabilities,
    onanswer,
    static: staticPosition = false,
  }: {
    capabilities: NodeCapabilities;
    onanswer: (placement: AgentPlacement | null) => void;
    static?: boolean;
  } = $props();
  let placement = $state<AgentPlacement>();
</script>

<FormDialog
  open
  static={staticPosition}
  title={m.agent_placement_chooseLocal()}
  description={m.agent_placement_chooseLocalDescription()}
  canSubmit={!!placement &&
    capabilities.agentNodes &&
    (placement.checkout !== 'isolated' || capabilities.localNodeIsolation)}
  onSubmit={() => {
    if (placement) onanswer(placement);
  }}
  onCancel={() => onanswer(null)}
>
  <AgentPlacementPicker
    value={placement}
    {capabilities}
    remoteEnabled={false}
    insideDialog
    onchange={(value) => {
      placement = value;
    }}
  />
</FormDialog>
