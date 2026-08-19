<script lang="ts">
  interface Props {
    agentId?: string;
    specialist?: string | null;
    variant?: string;
  }

  let { agentId = '', specialist = null, variant = undefined }: Props = $props();
</script>

<span
  data-testid="agent-avatar"
  data-agent-id={agentId}
  data-specialist={specialist}
  data-avatar-variant={variant}
></span>
