<script lang="ts">
  import type { PayloadScenario } from '$features/dev-console/traffic-fixture';
  import { onMount, type Component } from 'svelte';
  let Fixture = $state<Component<{ scenario?: PayloadScenario }> | null>(null);
  const preview =
    import.meta.env.DEV &&
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).has('fixture');
  const requestedScenario =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('fixture')
      : null;
  const scenario =
    requestedScenario === 'streams' ||
    requestedScenario === 'nested' ||
    requestedScenario === 'oversized'
      ? requestedScenario
      : 'traffic';
  onMount(async () => {
    if (preview) Fixture = (await import('$features/dev-console/DevConsoleFixture.svelte')).default;
  });
  import { Screen } from '$lib/components/patterns/screen';
  import DevConsoleShell from '$features/dev-console/DevConsoleShell.svelte';
</script>

<Screen>
  {#if preview}{#if Fixture}<Fixture {scenario} />{/if}{:else}<DevConsoleShell />{/if}
</Screen>
