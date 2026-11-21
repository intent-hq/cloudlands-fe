<script lang="ts">
  import { Tooltip } from '$lib/components/ui/tooltip';
  import { m } from '$shared/paraglide/messages.js';
  import { getActiveLocale } from '$lib/i18n/locale';
  let {
    needsNode,
  }: {
    /** Providers that would run once Node.js is installed (`npx` fetches their adapter). */
    needsNode: string[];
  } = $props();
</script>

{#if needsNode.length > 0}
  <Tooltip
    content={m.remoteMachines_needsNode_tooltip({
      providers: new Intl.ListFormat(getActiveLocale(), {
        style: 'long',
        type: 'conjunction',
      }).format(needsNode),
    })}
  >
    <span>{m.remoteMachines_needsNode_label()}</span>
  </Tooltip>
{:else}
  <span>{m.remoteMachines_noProviders_label()}</span>
{/if}
