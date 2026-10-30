<script lang="ts">
  import type { AgentSession } from '$shared/types';

  let { agent = null }: { agent?: AgentSession | null } = $props();
</script>

<div data-testid="home-chat" data-shown-agent={agent?.id ?? ''}></div>
