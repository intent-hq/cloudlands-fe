<!-- The first row of the ordered machine list: where new agents go first. -->
<script lang="ts">
  import { Badge } from '$lib/components/ui/badge';
  import { m } from '$shared/paraglide/messages.js';
</script>

<Badge variant="solid" color="blue" size="compact" data-preferred-machine
  >{m.remoteMachines_order_preferred_label()}</Badge
>
