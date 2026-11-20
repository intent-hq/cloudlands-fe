<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  type Scenario = 'mixed' | 'single' | 'tabs';

  export const preview = definePreview({
    id: 'recent-agent-switcher',
    title: 'Recent-agent switcher',
    defaultState: 'mixed',
    states: {
      mixed: { props: { scenario: 'mixed' as Scenario } },
      single: { props: { scenario: 'single' as Scenario } },
      tabs: { props: { scenario: 'tabs' as Scenario } },
    },
    captureReadiness: { selector: '[data-recent-agent-card]', count: 1 },
  });
</script>

<script lang="ts">
  import { catalogNow } from '$lib/component-catalog/catalog-clock';
  import type { RecentEntry } from '$shared/recent-agents';
  import RecentAgentSwitcherView from './RecentAgentSwitcherView.svelte';

  let { scenario = 'mixed' }: { scenario?: Scenario } = $props();

  const now = catalogNow();
  const minutes = (count: number) => now - count * 60_000;
  const agents: RecentEntry[] = [
    {
      kind: 'agent',
      connectionId: 'local',
      workspaceId: 'ws-dark-mode',
      workspaceTitle: 'Add dark mode support',
      agentId: 'agent-implementor',
      agentName: 'Implementor',
      visitedAt: minutes(1),
    },
    {
      kind: 'agent',
      connectionId: 'studio',
      workspaceId: 'ws-release',
      workspaceTitle: 'Cut the beta release',
      agentId: 'agent-release',
      agentName: 'Release notes',
      visitedAt: minutes(12),
    },
    {
      kind: 'agent',
      connectionId: 'laptop',
      workspaceId: 'ws-docs',
      workspaceTitle: null,
      agentId: 'agent-docs',
      agentName: 'Docs writer',
      visitedAt: minutes(95),
    },
  ];

  const tabs: RecentEntry[] = [
    {
      kind: 'browser',
      connectionId: 'local',
      workspaceId: 'ws-dark-mode',
      workspaceTitle: 'Add dark mode support',
      tabId: 'tab-browser',
      title: 'Settings · Appearance',
      url: 'http://daemon.localhost:5173/settings',
      visitedAt: minutes(4),
    },
    {
      kind: 'terminal',
      connectionId: 'local',
      workspaceId: 'ws-dark-mode',
      workspaceTitle: 'Add dark mode support',
      tabId: 'tab-terminal',
      title: 'pnpm dev',
      visitedAt: minutes(7),
    },
    {
      kind: 'browser',
      connectionId: 'studio',
      workspaceId: 'ws-release',
      workspaceTitle: 'Cut the beta release',
      tabId: 'tab-untitled',
      title: '',
      url: 'https://github.com/intent-hq/intent/releases',
      visitedAt: minutes(30),
    },
  ];
  const [implementor, release, docs] = agents;
  const entries = $derived(
    scenario === 'single'
      ? agents.slice(0, 1)
      : scenario === 'tabs'
        ? [implementor, ...tabs.slice(0, 2), release, tabs[2], docs]
        : agents,
  );
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
