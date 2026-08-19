<script lang="ts">
  interface Props {
    agentId?: string;
    specialist?: string | null;
    provider?: string;
    state?: string;
    variant?: string;
  }

  let {
    agentId = '',
    specialist = null,
    provider = undefined,
    state = 'idle',
    variant = 'standard',
  }: Props = $props();
</script>

<span
  data-testid="agent-avatar"
  data-agent-id={agentId}
  data-specialist={specialist}
  data-provider={provider}
  data-avatar-state={state}
  data-avatar-variant={variant}
></span>
