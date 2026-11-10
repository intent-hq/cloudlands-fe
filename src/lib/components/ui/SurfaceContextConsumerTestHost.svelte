<script lang="ts">
  /** @internal Test probe rendered by the surface-context harnesses. */
  import { useSurface } from '$lib/components/ui/surface-context';

  let { testId }: { testId: string } = $props();
  const surface = useSurface();
</script>

<output data-testid={testId}>{surface}</output>
