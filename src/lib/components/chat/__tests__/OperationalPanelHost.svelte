<script lang="ts">
  import { provideOperationalPanel } from '../operational-panel.svelte';
  let { ready }: { ready: (panel: ReturnType<typeof provideOperationalPanel>) => void } = $props();
  // svelte-ignore state_referenced_locally -- report the owner once at attachment
  ready(provideOperationalPanel(() => undefined));
</script>
