<!--
  After the name of a host that runs as an orchestrator (Settings → Hosts):
  a hub icon. It runs no agents itself and sends them to its runners.
-->
<script lang="ts">
  import GraphIcon from 'phosphor-svelte/lib/GraphIcon';
  import { Tooltip } from '$lib/components/ui/tooltip';
  import { m } from '$shared/paraglide/messages.js';
</script>

<Tooltip
  content={m.settings_devices_hostOnly_tooltip()}
  class="inline-flex shrink-0 rounded-sm text-muted-foreground"
>
  <span
    role="img"
    aria-label={m.settings_devices_hostOnly_tooltip()}
    data-host-only-marker
    class="inline-flex"
  >
    <GraphIcon size={15} aria-hidden="true" />
  </span>
</Tooltip>
