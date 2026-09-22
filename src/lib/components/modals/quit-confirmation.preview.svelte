<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  export const preview = definePreview({
    id: 'quit-confirmation',
    title: 'Quit confirmation edge cases',
    defaultState: 'eleven-browsers',
    states: {
      'eleven-browsers': { props: { scenario: 'eleven-browsers' } },
      'one-browser': { props: { scenario: 'one-browser' } },
      'one-agent': { props: { scenario: 'one-agent' } },
      'many-agents': { props: { scenario: 'many-agents' } },
      mixed: { props: { scenario: 'mixed' } },
      unassigned: { props: { scenario: 'unassigned' } },
      'duplicate-names': { props: { scenario: 'duplicate-names' } },
      'long-names': { props: { scenario: 'long-names' } },
      'many-workspaces': { props: { scenario: 'many-workspaces' } },
      empty: { props: { scenario: 'empty' } },
    },
  });
</script>

<script lang="ts">
  import QuitConfirmationModal from './QuitConfirmationModal.svelte';
  import type { QuitConfirmationShowPayload } from '$shared/ipc/quit-confirmation';
  let { scenario = 'eleven-browsers' }: { scenario?: string } = $props();
  let open = $state(true);
  const payload = $derived.by((): QuitConfirmationShowPayload => {
    const browserOnly = scenario === 'eleven-browsers' || scenario === 'one-browser';
    const agentCount =
      browserOnly || scenario === 'empty'
        ? 0
        : scenario === 'one-agent'
          ? 1
          : scenario === 'many-workspaces'
            ? 30
            : scenario === 'many-agents'
              ? 18
              : 4;
    const interrupted = Array.from({ length: agentCount }, (_, index) => ({
      agentId: `quit-agent-${index}`,
      agentName: `Agent ${index + 1}`,
      workspaceId:
        scenario === 'unassigned'
          ? undefined
          : `quit-workspace-${scenario === 'many-workspaces' ? index : scenario === 'many-agents' ? 0 : index % 2}`,
      workspaceName:
        scenario === 'unassigned'
          ? undefined
          : scenario === 'duplicate-names'
            ? 'Design system'
            : scenario === 'long-names'
              ? `Design system accessibility and cross-component migration review workspace ${(index % 2) + 1}`
              : `Workspace ${scenario === 'many-workspaces' ? index + 1 : scenario === 'many-agents' ? 1 : (index % 2) + 1}`,
    }));
    const count =
      scenario === 'eleven-browsers'
        ? 11
        : scenario === 'one-browser'
          ? 1
          : scenario === 'mixed' || scenario === 'unassigned'
            ? 5
            : 0;
    return {
      requestId: 'quit-preview-only',
      interrupted,
      disruptedBrowserTabs: Array.from({ length: count }, (_, index) => ({
        tabId: `quit-tab-${index}`,
        ownerAgentId: `quit-agent-${index % 4}`,
        ownerAgentName: `Agent ${(index % 4) + 1}`,
        workspaceId: browserOnly ? `browser-workspace-${index % 3}` : undefined,
        title: ['Documentation', 'Local preview', 'Pull request review'][index % 3],
      })),
    };
  });
</script>

<QuitConfirmationModal bind:open static {payload} onRespond={() => {}} />
