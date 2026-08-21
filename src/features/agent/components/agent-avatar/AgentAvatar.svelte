<script lang="ts">
  import AgentAvatarArt from './AgentAvatarArt.svelte';
  import { getAgentAvatarDesign } from './avatar-design';
  import {
    agentAvatarGeometry,
    defaultAgentAvatarVariant,
    type AgentAvatarVariant,
  } from './avatar-size';

  interface Props {
    agentId?: string;
    specialist?: string | null;
    provider?: string;
    variant?: AgentAvatarVariant;
    /** @deprecated Use a named variant. Numeric sizes remain until consumer migration completes. */
    size?: number;
    class?: string;
    ariaLabel?: string;
  }

  let {
    agentId = '',
    specialist = null,
    provider = undefined,
    variant = defaultAgentAvatarVariant,
    size = undefined,
    class: className = '',
    ariaLabel = undefined,
  }: Props = $props();

  const design = $derived.by(() => {
    void provider;
    return getAgentAvatarDesign(agentId, specialist);
  });
  const renderedSize = $derived(size ?? agentAvatarGeometry[variant].surface);
  const usesNamedVariant = $derived(size === undefined);
</script>

<svg
  width={renderedSize}
  height={renderedSize}
  viewBox="0 0 16 16"
  fill="none"
  overflow="hidden"
  xmlns="http://www.w3.org/2000/svg"
  class="agent-avatar agent-avatar--{usesNamedVariant ? 'named' : 'legacy'} {className}"
  style:width={usesNamedVariant ? undefined : `${renderedSize}px`}
  style:height={usesNamedVariant ? undefined : `${renderedSize}px`}
  role={ariaLabel ? 'img' : undefined}
  aria-label={ariaLabel}
  aria-hidden={ariaLabel ? undefined : 'true'}
  focusable="false"
  data-agent-avatar
  data-avatar-variant={usesNamedVariant ? variant : undefined}
  data-avatar-design={design}
>
  {#if ariaLabel}<title>{ariaLabel}</title>{/if}
  <g
    fill="none"
    stroke="currentColor"
    stroke-width="1.33"
    stroke-linecap="butt"
    stroke-linejoin="miter"
  >
    <AgentAvatarArt {design} />
  </g>
</svg>

<style>
  .agent-avatar {
    display: block;
    box-sizing: border-box;
    width: var(--agent-avatar-surface-size, 20px);
    height: var(--agent-avatar-surface-size, 20px);
    border-radius: var(--agent-avatar-corner-radius, 6px);
    background-color: var(--agent-avatar-background, hsl(var(--agent-avatar-surface-neutral)));
    color: #080808;
    opacity: 1;
    forced-color-adjust: auto;
  }

  .agent-avatar--named {
    padding: var(--agent-avatar-clear-space, 2px);
  }

  .agent-avatar--legacy {
    padding: 1px;
  }

  :global([data-agent-avatar-with-state]) .agent-avatar {
    color: inherit;
  }

  @media (forced-colors: active) {
    .agent-avatar {
      background-color: var(--agent-avatar-background-forced, Canvas);
      color: CanvasText;
      outline: var(--agent-avatar-outline-forced, 1px solid CanvasText);
      outline-offset: -1px;
    }
  }
</style>
