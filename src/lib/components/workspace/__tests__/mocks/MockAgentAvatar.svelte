<script lang="ts">
  import {
    agentAvatarGeometry,
    type AgentAvatarVariant,
  } from '$features/agent/components/agent-avatar/avatar-size';

  interface Props {
    agentId: string;
    size?: number;
    variant?: AgentAvatarVariant;
    state?: string;
    class?: string;
    specialist?: string | null;
    provider?: string;
  }

  let {
    agentId,
    size = undefined,
    variant = 'standard',
    state = 'idle',
    class: className = '',
    specialist = null,
    provider = undefined,
  }: Props = $props();

  const renderedSize = $derived(size ?? agentAvatarGeometry[variant].surface);
</script>

<div
  data-testid="mock-avatar"
  data-agent-id={agentId}
  data-state={state}
  data-agent-avatar-surface
  data-avatar-variant={size === undefined ? variant : undefined}
  data-specialist={specialist}
  data-provider={provider}
  class={className}
  style="width: {renderedSize}px; height: {renderedSize}px;"
></div>
