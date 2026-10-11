<script lang="ts" module>
  import { definePreview } from '$lib/component-catalog/preview-definition';
  interface Props {
    scenario?: 'list' | 'board' | 'disconnected';
  }
  export const preview = definePreview<Props>({
    id: 'home-micro',
    title: 'Home Micro assignments',
    defaultState: 'list',
    states: {
      list: { props: { scenario: 'list' } },
      board: { props: { scenario: 'board' } },
      disconnected: { props: { scenario: 'disconnected' } },
    },
  });
</script>

<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import HomePreview from './home.preview.svelte';
  import { startHomePreview } from './home-preview-lifecycle';
  import { setupHomeMicroPreview } from './home-micro-preview-fixture';
  let { scenario = 'list' }: Props = $props();
  const stop = startHomePreview(() => []);
  const fixture = setupHomeMicroPreview(untrack(() => scenario !== 'disconnected'));
  $effect(() => fixture.setConnected(scenario !== 'disconnected'));
  onDestroy(() => {
    fixture.dispose();
    stop();
  });
</script>

<HomePreview scenario={scenario === 'list' ? 'populated' : 'board'} />
