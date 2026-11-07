<!-- A node row that is not (yet) available to the current backend. -->
<script lang="ts">
  import { Badge } from '$lib/components/ui/badge';

  let { label }: { label: string } = $props();
</script>

<Badge variant="dot" color="gray">{label}</Badge>
