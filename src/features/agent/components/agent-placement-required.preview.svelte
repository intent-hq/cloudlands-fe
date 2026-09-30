<script lang="ts" module>
  import { definePreview } from '$lib/component-catalog/preview-definition';
  export const preview = definePreview<{ isolated: boolean }>({
    id: 'agent-placement-required',
    title: 'Required local agent placement',
    defaultState: 'local',
    states: {
      local: { props: { isolated: true } },
      'without-isolation': { props: { isolated: false } },
    },
  });
</script>

<script lang="ts">
  import AgentPlacementRequiredDialog from './AgentPlacementRequiredDialog.svelte';
  let { isolated }: { isolated: boolean } = $props();
</script>

<div data-required-placement-preview>
  <AgentPlacementRequiredDialog
    static
    capabilities={{ agentNodes: true, localNodeIsolation: isolated }}
    onanswer={() => {}}
  />
</div>
