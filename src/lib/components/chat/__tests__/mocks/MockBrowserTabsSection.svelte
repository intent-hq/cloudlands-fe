<script lang="ts">
  interface Props {
    agentId?: string;
    visible?: boolean;
    count?: number;
  }

  let { agentId = '', visible = $bindable(false), count = $bindable(0) }: Props = $props();
  $effect(() => {
    visible = agentId.includes('tabs');
    count = visible ? 2 : 0;
  });
</script>

{#if visible}<div data-testid="mock-browser-tabs-section"></div>{/if}
