<script lang="ts">
  import AgentAvatarWithState from '$features/agent/components/agent-avatar/AgentAvatarWithState.svelte';
  import { getAvatarState } from '$features/agent/components/agent-avatar/avatar-state';
  import { m } from '$shared/paraglide/messages.js';
  import type { AgentNode } from '../types';
  import { activityMotion, activityNodeTransition } from '../activity-motion';

  interface Props {
    node: AgentNode;
    isActive?: boolean;
    lastActivityAt?: string;
    enterDelay?: number;
    playbackSpeed?: number;
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

  let {
    node,
    isActive = false,
    lastActivityAt,
    enterDelay = 0,
    playbackSpeed = 1,
    ...events
  }: Props = $props();

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
</script>

<button
  use:activityMotion
  in:activityNodeTransition={{ delay: enterDelay, playbackSpeed }}
  out:activityNodeTransition={{ exit: true, playbackSpeed }}
  type="button"
  class="agent-orb relative flex h-[68px] w-44 touch-none items-center gap-3 rounded-xl border bg-card/95 px-3 text-left shadow-xs backdrop-blur-sm transition-opacity hover:border-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 {isActive
    ? 'border-primary'
    : node.status === 'waiting'
      ? 'border-dashed border-muted-foreground'
      : 'border-border'}"
  data-graph-node
  data-node-id={node.id}
  data-active={isActive}
  data-last-activity-at={lastActivityAt}
  data-agent-status={node.status}
  {...events}
>
  {#if isActive}
    <span class="absolute right-2 top-2 size-1.5 rounded-full bg-primary" aria-hidden="true"></span>
  {/if}
  <AgentAvatarWithState
    agentId={node.agentId}
    specialist={node.specialist}
    variant="emphasized"
    state={avatarState}
  />
  <span class="min-w-0 flex-1">
    <span class="block w-full truncate text-sm font-medium text-foreground">{node.name}</span>
    <span
      class="mt-1 block w-full truncate font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground"
    >
      {#if node.specialist}
        <span>{node.specialist.replaceAll('-', ' ')}</span><span aria-hidden="true"> · </span>
      {/if}
      <span>{statusLabel}</span>
    </span>
  </span>
</button>

<style>
  .agent-orb {
    --agent-avatar-surface-neutral: var(--muted);
    --agent-avatar-surface-completed: var(--muted);
    --agent-avatar-foreground-completed: var(--foreground);
    --agent-avatar-surface-waiting: var(--muted);
    --agent-avatar-surface-failed: var(--muted);
    --agent-avatar-surface-active: var(--primary);

    position: relative;
    transition:
      opacity 180ms ease,
      filter 180ms ease,
      scale 180ms ease;
  }
  .agent-orb[data-agent-status='waiting'] {
    animation: waiting-pulse 2.8s ease-in-out infinite;
  }
  .agent-orb[data-active='true']::before {
    position: absolute;
    inset: -1px;
    border: 1px solid var(--color-primary);
    border-radius: inherit;
    content: '';
    pointer-events: none;
    animation: working-breathe 2.4s ease-in-out infinite;
  }
  .agent-orb[data-motion-enabled='false'],
  .agent-orb[data-motion-enabled='false']::before {
    animation: none;
    transition: none;
  }
  @keyframes waiting-pulse {
    50% {
      opacity: 0.72;
    }
  }
  @keyframes working-breathe {
    50% {
      opacity: 0.6;
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
