<script lang="ts" module>
  export type { AvatarState } from './avatar-state';
  export type { AgentAvatarVariant } from './avatar-size';
</script>

<script lang="ts">
  import AgentAvatar from './AgentAvatar.svelte';
  import { getAgentAvatarStateLabel } from './avatar-state-label';
  import type { AvatarState } from './avatar-state';
  import {
    agentAvatarGeometry,
    defaultAgentAvatarVariant,
    type AgentAvatarVariant,
  } from './avatar-size';

  interface Props {
    agentId: string;
    specialist?: string | null;
    provider?: string;
    variant?: AgentAvatarVariant;
    /** @deprecated Use a named variant. Numeric sizes remain until consumer migration completes. */
    size?: number;
    state?: AvatarState;
    class?: string;
  }

  let {
    agentId,
    specialist = null,
    provider = undefined,
    variant = defaultAgentAvatarVariant,
    size = undefined,
    state = 'idle',
    class: className = '',
  }: Props = $props();

  const stateLabel = $derived(getAgentAvatarStateLabel(state));
  const renderedSize = $derived(size ?? agentAvatarGeometry[variant].surface);
  const usesNamedVariant = $derived(size === undefined);
</script>

<span
  class="agent-avatar-with-state agent-avatar-with-state--{state} {className}"
  style:width={usesNamedVariant ? undefined : `${renderedSize}px`}
  style:height={usesNamedVariant ? undefined : `${renderedSize}px`}
  role="img"
  aria-label={stateLabel}
  title={stateLabel}
  data-agent-avatar-with-state
  data-agent-avatar-surface
  data-avatar-state={state}
  data-avatar-variant={usesNamedVariant ? variant : undefined}
>
  <AgentAvatar {agentId} {specialist} {provider} {variant} {size} />
</span>

<style>
  .agent-avatar-with-state {
    --agent-avatar-background: hsl(var(--agent-avatar-surface-neutral));

    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    position: relative;
    box-sizing: border-box;
    width: var(--agent-avatar-surface-size, 20px);
    height: var(--agent-avatar-surface-size, 20px);
    overflow: hidden;
    border-radius: var(--agent-avatar-corner-radius, 6px);
    clip-path: inset(0 round var(--agent-avatar-corner-radius, 6px));
    background-color: var(--agent-avatar-background);
    color: #080808;
    opacity: 1;
    transition: background-color var(--motion-fast) var(--ease-standard);
    forced-color-adjust: auto;
  }

  .agent-avatar-with-state--running,
  .agent-avatar-with-state--responding {
    --agent-avatar-background: hsl(var(--agent-avatar-surface-active));
  }

  .agent-avatar-with-state--completed {
    --agent-avatar-background: hsl(var(--agent-avatar-surface-completed));
    color: hsl(var(--agent-avatar-foreground-completed));
    transition: none;
  }

  .agent-avatar-with-state--waiting {
    --agent-avatar-background: hsl(var(--agent-avatar-surface-waiting));
  }

  .agent-avatar-with-state--failed {
    --agent-avatar-background: hsl(var(--agent-avatar-surface-failed));
  }

  .agent-avatar-with-state--question,
  .agent-avatar-with-state--attention-blocker,
  .agent-avatar-with-state--needs-permission,
  .agent-avatar-with-state--attention-discussion {
    --agent-avatar-background: hsl(var(--agent-avatar-surface-attention));
  }

  @media (forced-colors: active) {
    .agent-avatar-with-state {
      --agent-avatar-background-forced: Canvas;
      --agent-avatar-outline-forced: none;

      background-color: Canvas;
      color: CanvasText;
      outline: 1px solid CanvasText;
      outline-offset: -1px;
    }
    .agent-avatar-with-state--running,
    .agent-avatar-with-state--responding {
      --agent-avatar-background-forced: Highlight;
      background-color: Highlight;
    }
    .agent-avatar-with-state--completed {
      --agent-avatar-background-forced: ButtonFace;
      background-color: ButtonFace;
      color: ButtonText;
    }
    .agent-avatar-with-state--waiting {
      --agent-avatar-background-forced: Field;
      background-color: Field;
    }
    .agent-avatar-with-state--failed {
      --agent-avatar-background-forced: Mark;
      background-color: Mark;
    }
    .agent-avatar-with-state--question,
    .agent-avatar-with-state--attention-blocker,
    .agent-avatar-with-state--needs-permission,
    .agent-avatar-with-state--attention-discussion {
      --agent-avatar-background-forced: Mark;
      background-color: Mark;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .agent-avatar-with-state {
      transition: none;
    }
  }
</style>
