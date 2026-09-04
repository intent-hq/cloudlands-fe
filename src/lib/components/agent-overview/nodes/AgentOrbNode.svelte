<script lang="ts">
  import AgentAvatarWithState from '$features/agent/components/agent-avatar/AgentAvatarWithState.svelte';
  import { getAvatarState } from '$features/agent/components/agent-avatar/avatar-state';
  import { classifyTool } from '$lib/utils/tool-classifier';
  import { m } from '$shared/paraglide/messages.js';
  import type { AgentNode } from '../types';
  import { activityMotion, activityNodeTransition } from '../activity-motion';

  interface Props {
    node: AgentNode;
    isActive?: boolean;
    lastActivityAt?: string;
    onclick?: (event: MouseEvent) => void;
    ondblclick?: (event: MouseEvent) => void;
    onpointerdown?: (event: PointerEvent) => void;
    onpointermove?: (event: PointerEvent) => void;
    onpointerup?: (event: PointerEvent) => void;
    onpointercancel?: (event: PointerEvent) => void;
    onmouseenter?: () => void;
    onmouseleave?: () => void;
    onfocus?: () => void;
    onblur?: () => void;
  }

  let { node, isActive = false, lastActivityAt, ...events }: Props = $props();

  const avatarState = $derived(
    getAvatarState(
      {
        status: node.status,
        isResponding: node.status === 'responding',
        isWaitingForOtherAgents: node.status === 'waiting',
      },
      { isCompleted: node.status === 'completed', isFailed: node.status === 'failed' },
    ),
  );

  const statusLabel = $derived.by(() => {
    if (node.status === 'responding')
      return m.agentOverview_hierarchyGraph_statusResponding_label();
    if (node.status === 'waiting') return m.agentOverview_hierarchyGraph_statusWaiting_label();
    if (node.status === 'completed') return m.agentOverview_hierarchyGraph_statusCompleted_label();
    if (node.status === 'failed') return m.agentOverview_hierarchyGraph_statusFailed_label();
    return m.agentOverview_hierarchyGraph_statusIdle_label();
  });

  const activityLabel = $derived.by(() => {
    if (node.activeToolName) {
      const activity = classifyTool(node.activeToolName, node.activeToolInput ?? {});
      if (!activity.hidden)
        return activity.subject ? `${activity.verb} ${activity.subject}` : activity.verb;
    }
    return node.lastResponse ?? statusLabel;
  });
</script>

<button
  use:activityMotion
  transition:activityNodeTransition
  type="button"
  class="agent-orb flex w-36 touch-none flex-col items-center gap-1.5 rounded-xl border border-border bg-card/95 px-3 py-2.5 text-center shadow-sm backdrop-blur-sm transition-opacity hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 {isActive
    ? 'ring-2 ring-primary/30'
    : ''}"
  data-graph-node
  data-node-id={node.id}
  data-active={isActive}
  data-last-activity-at={lastActivityAt}
  data-agent-status={node.status}
  {...events}
>
  <AgentAvatarWithState
    agentId={node.agentId}
    specialist={node.specialist}
    variant="emphasized"
    state={avatarState}
  />
  <span class="w-full truncate text-sm font-semibold text-foreground">{node.name}</span>
  {#if node.specialist}
    <span class="max-w-full truncate rounded-full bg-muted px-2 py-0.5 text-xs text-subtle">
      {node.specialist.replaceAll('-', ' ')}
    </span>
  {/if}
  <span class="line-clamp-2 w-full text-xs leading-tight text-subtle">{activityLabel}</span>
</button>

<style>
  .agent-orb {
    position: relative;
    transition:
      opacity 180ms ease,
      filter 180ms ease,
      scale 180ms ease;
  }
  .agent-orb::before {
    content: '';
    position: absolute;
    inset: -5px;
    border-radius: 1rem;
    pointer-events: none;
  }
  .agent-orb[data-agent-status='responding']::before {
    box-shadow: 0 0 18px color-mix(in srgb, var(--color-primary) 45%, transparent);
    animation: responding-glow 1.4s ease-in-out infinite;
  }
  .agent-orb[data-agent-status='waiting'] {
    animation: waiting-pulse 2.8s ease-in-out infinite;
  }
  .agent-orb:is([data-agent-status='completed'], [data-agent-status='failed']) {
    filter: saturate(0.35);
    scale: 0.94;
  }
  .agent-orb[data-motion-enabled='false'],
  .agent-orb[data-motion-enabled='false']::before {
    animation: none;
    transition: none;
  }
  @keyframes responding-glow {
    50% {
      opacity: 0.45;
      scale: 1.04;
    }
  }
  @keyframes waiting-pulse {
    50% {
      opacity: 0.72;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .agent-orb,
    .agent-orb::before {
      animation: none !important;
      transition: none;
    }
  }
</style>
