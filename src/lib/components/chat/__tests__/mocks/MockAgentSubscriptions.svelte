<script lang="ts">
  interface Props {
    agentId: string;
    visible?: boolean;
    count?: number;
  }

  let { agentId, visible = $bindable(false), count = $bindable(0) }: Props = $props();

  $effect(() => {
    visible = agentId === 'agent-with-visible-subscription';
    count = visible ? 1 : 0;
  });
</script>
