<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  type Scenario = 'mixed' | 'single';

  export const preview = definePreview({
    id: 'recent-agent-switcher',
    title: 'Recent-agent switcher',
    defaultState: 'mixed',
    states: {
      mixed: { props: { scenario: 'mixed' as Scenario } },
      single: { props: { scenario: 'single' as Scenario } },
    },
    captureReadiness: { selector: '[data-recent-agent-card]', count: 1 },
  });
</script>

<script lang="ts">
  import { catalogNow } from '$lib/component-catalog/catalog-clock';
  import type { RecentAgentEntry } from '$shared/recent-agents';
  import RecentAgentSwitcherView from './RecentAgentSwitcherView.svelte';

  let { scenario = 'mixed' }: { scenario?: Scenario } = $props();

  const now = catalogNow();
  const minutes = (count: number) => now - count * 60_000;
  const all: RecentAgentEntry[] = [
    {
      connectionId: 'local',
      workspaceId: 'ws-dark-mode',
      workspaceTitle: 'Add dark mode support',
      agentId: 'agent-implementor',
      agentName: 'Implementor',
      visitedAt: minutes(1),
    },
    {
      connectionId: 'studio',
      workspaceId: 'ws-release',
      workspaceTitle: 'Cut the beta release',
      agentId: 'agent-release',
      agentName: 'Release notes',
      visitedAt: minutes(12),
    },
    {
      connectionId: 'laptop',
      workspaceId: 'ws-docs',
      workspaceTitle: null,
      agentId: 'agent-docs',
      agentName: 'Docs writer',
      visitedAt: minutes(95),
    },
  ];

  const entries = $derived(scenario === 'single' ? all.slice(0, 1) : all);
  let selectedIndex = $state(1);
</script>

<div class="relative h-72 w-full bg-background">
  <RecentAgentSwitcherView
    {entries}
    selectedIndex={Math.min(selectedIndex, entries.length - 1)}
    currentConnectionId="local"
    isOffline={(entry) => entry.connectionId === 'laptop'}
    onpoint={(index) => (selectedIndex = index)}
    onchoose={(index) => (selectedIndex = index)}
  />
</div>
