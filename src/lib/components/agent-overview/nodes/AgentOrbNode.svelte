<script lang="ts">
  import AgentAvatarWithState from '$features/agent/components/agent-avatar/AgentAvatarWithState.svelte';
  import { getAvatarState } from '$features/agent/components/agent-avatar/avatar-state';
  import type { AgentNode } from '../types';
  import { activityMotion, activityNodeTransition } from '../activity-motion';

  interface Props {
    node: AgentNode;
    focusState?: 'focused' | 'neighbour' | 'dimmed' | 'none';
    zoomBand?: 'full' | 'mid' | 'far';
    tabindex?: number;
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
    focusState = 'none',
    zoomBand = 'full',
    tabindex = 0,
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

  const specialistLabel = $derived(node.specialist?.replaceAll('-', ' '));
  const agentLabel = $derived(specialistLabel ? `${node.name} · ${specialistLabel}` : node.name);
</script>

<button
  use:activityMotion
  in:activityNodeTransition={{ delay: enterDelay, playbackSpeed }}
  out:activityNodeTransition={{ exit: true, playbackSpeed }}
  type="button"
  class="agent-orb flex h-[88px] w-28 touch-none flex-col items-center gap-1 text-center text-foreground transition-opacity focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-4 focus-visible:outline-ring"
  data-graph-node
  data-node-id={node.id}
  data-active={isActive}
  data-last-activity-at={lastActivityAt}
  data-agent-status={node.status}
  data-focus-state={focusState}
  data-zoom-band={zoomBand}
  {tabindex}
  title={agentLabel}
  aria-label={agentLabel}
  {...events}
>
  <AgentAvatarWithState
    agentId={node.agentId}
    specialist={node.specialist}
    variant="prominent"
    state={avatarState}
  />
  <span
    class="agent-name line-clamp-2 w-full break-words text-[12px] leading-tight"
    class:font-semibold={isActive}>{node.name}</span
  >
</button>

<style>
  .agent-orb {
    position: relative;
    transition:
      opacity 120ms ease,
      filter 120ms ease,
      scale 120ms ease;
  }
  .agent-orb[data-focus-state='dimmed'] {
    filter: opacity(0.28);
  }
  .agent-name {
    transition: opacity 120ms ease;
  }
  .agent-orb[data-zoom-band='mid'] .agent-name,
  .agent-orb[data-zoom-band='far'] .agent-name {
    opacity: 0;
  }
  .agent-orb[data-agent-status='waiting'] {
    animation: waiting-pulse 2.8s ease-in-out infinite;
  }
  .agent-orb[data-active='true'] {
    animation: working-breathe 2.4s ease-in-out infinite;
  }
  .agent-orb[data-motion-enabled='false'] {
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
      transform: scale(1.04);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .agent-orb {
      animation: none !important;
      transition: none;
    }
  }
</style>
