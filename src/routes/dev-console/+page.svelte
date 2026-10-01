<script lang="ts">
  import { onMount, type Component } from 'svelte';
  let Fixture = $state<Component | null>(null);
  const preview =
    import.meta.env.DEV &&
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).has('fixture');
  onMount(async () => {
    if (preview) Fixture = (await import('$features/dev-console/DevConsoleFixture.svelte')).default;
  });
  import { Screen } from '$lib/components/patterns/screen';
  import DevConsoleShell from '$features/dev-console/DevConsoleShell.svelte';
</script>

<Screen>
  {#if preview}{#if Fixture}<Fixture />{/if}{:else}<DevConsoleShell />{/if}
</Screen>
