<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  type Scenario =
    'missing-home' | 'restored-home' | 'retained-home' | 'missing-secondary' | 'pending-home';

  export const preview = definePreview({
    id: 'machine-rail',
    title: 'Machine rail',
    defaultState: 'missing-home',
    states: {
      'missing-home': { props: { scenario: 'missing-home' as Scenario } },
      'restored-home': { props: { scenario: 'restored-home' as Scenario } },
      'retained-home': { props: { scenario: 'retained-home' as Scenario } },
      'missing-secondary': { props: { scenario: 'missing-secondary' as Scenario } },
      'pending-home': { props: { scenario: 'pending-home' as Scenario } },
    },
    captureReadiness: { selector: '[data-testid="machine-rail-item"]', count: 4 },
  });
</script>

<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { Textarea } from '$lib/components/ui/textarea';
  import { createMachineRailPreview } from './machine-rail.preview-fixtures';
  import MachineRail from './MachineRail.svelte';

  let { scenario = 'missing-home' }: { scenario?: Scenario } = $props();
  let draft = $state('Keep this draft');
  let requests = $state<string[]>([]);
  const fixture = untrack(() =>
    createMachineRailPreview((id) => {
      requests = [...requests, id];
    }),
  );

  $effect(() => {
    const current = scenario;
    untrack(() => fixture.update(current));
  });

  onDestroy(fixture.dispose);
</script>

<div class="flex h-80 w-full min-w-0 bg-sidebar p-2 text-foreground">
  <MachineRail />
  <div class="min-w-0 flex-1 rounded-xl bg-background p-4">
    <Textarea aria-label="Draft" bind:value={draft} />
  </div>
  <output data-testid="machine-rail-requests" hidden>{JSON.stringify(requests)}</output>
</div>
