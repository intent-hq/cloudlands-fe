<!-- Why a runner has no providers ready. The row's name tooltip names the
  providers Node.js would unlock. -->
<script lang="ts">
  import { m } from '$shared/paraglide/messages.js';
  let {
    needsNode,
  }: {
    /** Providers that would run once Node.js is installed (`npx` fetches their adapter). */
    needsNode: string[];
  } = $props();
</script>

<span>
  {needsNode.length > 0 ? m.remoteMachines_needsNode_label() : m.remoteMachines_noProviders_label()}
</span>
