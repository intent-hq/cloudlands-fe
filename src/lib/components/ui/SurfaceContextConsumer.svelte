<script lang="ts">
  import { useSurface } from '$lib/components/ui/surface-context';

  let { testId }: { testId: string } = $props();
  const surface = useSurface();
</script>

<output data-testid={testId}>{surface}</output>
