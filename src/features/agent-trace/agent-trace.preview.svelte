<script lang="ts" module>
  import { definePreview } from '$lib/component-catalog/preview-definition';

  type Scenario =
    | 'live'
    | 'live-now'
    | 'done'
    | 'many-tools'
    | 'many-agents'
    | 'long-names'
    | 'expired-tools'
    | 'minimal'
    | 'day'
    | 'none';

  export interface AgentTracePreviewProps {
    scenario: Scenario;
    status?: 'idle' | 'loading' | 'ready' | 'error';
    expanded?: string[];
    collapsed?: string[];
    /** A span id, or `failed-tool` for the run's first failed tool call. */
    selected?: string | null;
  }

  export const preview = definePreview<AgentTracePreviewProps>({
    id: 'agent-trace',
    title: 'Agent trace waterfall',
    defaultState: 'live',
    states: {
      live: { props: { scenario: 'live' } },
      'live-clock': { props: { scenario: 'live-now' } },
      done: { props: { scenario: 'done' } },
      collapsed: { props: { scenario: 'done', collapsed: ['agent:agent-lead'] } },
      'sub-agent-open': {
        props: { scenario: 'done', expanded: ['agent:agent-coder', 'agent:agent-research'] },
      },
      'failed-tool-details': {
        props: { scenario: 'live', expanded: ['agent:agent-coder'], selected: 'failed-tool' },
      },
      'agent-details': { props: { scenario: 'done', selected: 'agent:agent-writer' } },
      'many-tools': { props: { scenario: 'many-tools' } },
      'many-agents': { props: { scenario: 'many-agents' } },
      'long-names': {
        props: { scenario: 'long-names', expanded: ['agent:agent-b', 'agent:agent-c'] },
      },
      'expired-tools': { props: { scenario: 'expired-tools', expanded: ['agent:agent-writer'] } },
      minimal: { props: { scenario: 'minimal' } },
      'day-with-gaps': { props: { scenario: 'day' } },
      empty: { props: { scenario: 'none', status: 'ready' } },
      loading: { props: { scenario: 'none', status: 'loading' } },
      error: { props: { scenario: 'none', status: 'error' } },
    },
  });
</script>

<script lang="ts">
  import AgentTraceView from './components/AgentTraceView.svelte';
  import {
    dayFixture,
    doneFixture,
    expiredToolsFixture,
    liveFixture,
    liveNowFixture,
    longNamesFixture,
    manyAgentsFixture,
    manyToolsFixture,
    minimalFixture,
    type TraceFixture,
  } from './agent-trace.fixtures';
  import type { TraceSpan } from './trace-types';
  import { buildTrace } from './utils/build-trace';

  let {
    scenario,
    status = 'ready',
    expanded,
    collapsed,
    selected = null,
  }: AgentTracePreviewProps = $props();

  const fixtures: Record<Exclude<Scenario, 'none'>, () => TraceFixture> = {
    live: liveFixture,
    'live-now': liveNowFixture,
    done: doneFixture,
    'many-tools': manyToolsFixture,
    'many-agents': manyAgentsFixture,
    'long-names': longNamesFixture,
    'expired-tools': expiredToolsFixture,
    minimal: minimalFixture,
    day: dayFixture,
  };

  const fixture = $derived(scenario === 'none' ? undefined : fixtures[scenario]());
  const trace = $derived(fixture ? buildTrace(fixture) : null);

  function firstFailedTool(spans: readonly TraceSpan[]): string | null {
    for (const span of spans) {
      if (span.kind === 'tool' && span.status === 'failed') return span.id;
      const nested = firstFailedTool(span.children);
      if (nested) return nested;
    }
    return null;
  }

  const selectedId = $derived(
    selected === 'failed-tool' ? firstFailedTool(trace?.roots ?? []) : selected,
  );

  /** The last chat jump a row asked for, for tests: agent, message and tool call. */
  let chatRequest = $state('');
  function chatTarget(span: TraceSpan): string {
    return [span.agentId, span.messageId ?? '', span.toolCallId ?? ''].join(' ');
  }
</script>

<div
  class="h-[640px] overflow-auto bg-background"
  data-preview-agent-trace={scenario}
  data-preview-chat-request={chatRequest}
>
  {#key `${scenario}:${status}`}
    <AgentTraceView
      {trace}
      {status}
      clock={scenario === 'live-now'
        ? undefined
        : (fixture?.now ?? Date.parse('2026-10-23T14:00:00.000Z'))}
      initialExpanded={expanded}
      initialCollapsed={collapsed}
      initialSelectedId={selectedId}
      onOpenChat={(span) => (chatRequest = chatTarget(span))}
      onRetry={() => {}}
    />
  {/key}
</div>
