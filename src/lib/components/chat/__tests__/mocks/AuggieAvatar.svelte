<script lang="ts">
  interface Props {
    agentId?: string;
    seed?: string;
    size?: number;
    class?: string;
    [key: string]: any;
  }

  let { agentId = '', seed: _seed, size: _size, class: _className }: Props = $props();
</script>

<span data-testid="auggie-avatar" data-agent-id={agentId}></span>
