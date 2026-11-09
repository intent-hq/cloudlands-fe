<script lang="ts">
  /**
   * Agent overview panel: the workspace's recent agent activity as a trace waterfall.
   */
  import { onMount } from 'svelte';
  import { openMessage } from '$lib/utils/open-message';
  import { findSourcePanelId } from '$lib/utils/workspace-navigation';
  import { openAgentTabRequested } from '$store/renderer/slices/app-layout/app-layout-slice';
  import {
    agentTraceClosed,
    agentTraceDetailRequested,
    agentTraceOpened,
    agentTraceRetryRequested,
  } from '$store/renderer/slices/agent-trace/agent-trace-slice';
  import {
    selectAgentTrace,
    selectAgentTraceState,
  } from '$store/renderer/slices/agent-trace/agent-trace-selectors';
  import { store as appStore } from '$store/renderer/store';
  import type { TraceSpan } from '../trace-types';
  import AgentTraceView from './AgentTraceView.svelte';

  interface Props {
    workspaceId: string;
    /** The panel's tab is the visible one. */
    active?: boolean;
    onFocus?: () => void;
  }

  let { workspaceId, active = true, onFocus }: Props = $props();

  /** Read a little before the timeline so its first usage baseline is included. */
  const DETAIL_MARGIN_MS = 10 * 60_000;

  // svelte-ignore state_referenced_locally - a panel tab never changes workspace
  const trace$ = selectAgentTrace(workspaceId);
  // svelte-ignore state_referenced_locally - a panel tab never changes workspace
  const traceState$ = selectAgentTraceState(workspaceId);

  let panelEl = $state<HTMLElement | undefined>();
  let chatNavigation: AbortController | undefined;

  onMount(() => {
    appStore.dispatch(agentTraceOpened(workspaceId));
    return () => {
      chatNavigation?.abort();
      appStore.dispatch(agentTraceClosed(workspaceId));
    };
  });

  // Tool calls and usage load back to the timeline's start. Older turn pages
  // arrive after the first one and move that start earlier.
  let detailFrom = Infinity;
  $effect(() => {
    const start = $trace$?.start;
    if (start === undefined || start >= detailFrom) return;
    detailFrom = start;
    appStore.dispatch(agentTraceDetailRequested(workspaceId, start - DETAIL_MARGIN_MS));
  });

  /** Shows the span in its agent's chat, beside the overview. */
  function openChat(span: TraceSpan) {
    appStore.dispatch(
      openAgentTabRequested(workspaceId, {
        agentId: span.agentId,
        sourcePanelId: findSourcePanelId(panelEl ?? null),
        alongsideSource: true,
      }),
    );
    // A newer click wins over a jump still waiting for its history.
    chatNavigation?.abort();
    if (!span.messageId) return;
    chatNavigation = new AbortController();
    void openMessage({
      workspaceId,
      agentId: span.agentId,
      messageId: span.messageId,
      toolCallId: span.toolCallId,
      contentAlreadyOpen: true,
      signal: chatNavigation.signal,
    });
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  bind:this={panelEl}
  class="agent-trace-panel h-full overflow-auto bg-background"
  onmousedown={(event) => {
    if (event.button === 0) onFocus?.();
  }}
>
  <AgentTraceView
    trace={$trace$}
    status={$traceState$.status}
    {active}
    onRetry={() => appStore.dispatch(agentTraceRetryRequested(workspaceId))}
    onOpenChat={openChat}
  />
</div>
