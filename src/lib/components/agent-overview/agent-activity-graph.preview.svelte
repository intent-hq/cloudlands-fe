<script lang="ts" module>
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import {
    buildBusyGraph,
    buildConstellationGraph,
    buildEmptyGraph,
    buildSingleAgentGraph,
  } from './__fixtures__/agent-activity-graph.fixtures';
  import type { GraphState } from './types';

  export const preview = definePreview<{ graph: GraphState }>({
    id: 'agent-activity-graph',
    title: 'Agent activity graph',
    defaultState: 'constellation',
    states: {
      constellation: { props: { graph: buildConstellationGraph() } },
      busy: { props: { graph: buildBusyGraph() } },
      empty: { props: { graph: buildEmptyGraph() } },
      'single-agent': { props: { graph: buildSingleAgentGraph() } },
    },
  });
</script>

<script lang="ts">
  import AgentActivityGraph from './AgentActivityGraph.svelte';

  let { graph }: { graph: GraphState } = $props();

  function logClick(kind: 'agent' | 'task' | 'note' | 'file', id: string, event: MouseEvent) {
    // i18n-ignore (developer-only sandbox diagnostic)
    console.info('[agent-activity-graph preview] click', { kind, id, eventType: event.type });
  }
</script>

<div class="h-[720px] min-h-[600px] w-full overflow-hidden rounded-md" data-graph-preview>
  <AgentActivityGraph
    {graph}
    layers={{ files: true, notes: true, messages: true }}
    onAgentClick={(id, event) => logClick('agent', id, event)}
    onTaskClick={(id, event) => logClick('task', id, event)}
    onNoteClick={(id, event) => logClick('note', id, event)}
    onFileClick={(id, event) => logClick('file', id, event)}
    showFitControl
  />
</div>
