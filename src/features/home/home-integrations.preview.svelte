<script lang="ts" module>
  import { definePreview } from '$lib/component-catalog/preview-definition';
  interface Props {
    scenario?: string;
  }
  export const preview = definePreview<Props>({
    id: 'home-integrations',
    title: 'Home integrations',
    defaultState: 'prs',
    states: Object.fromEntries(
      [
        'prs',
        'linear',
        'empty',
        'disconnected',
        'error',
        'loading',
        'detail-error',
        'comments-error',
        'pagination-error',
      ].map((scenario) => [scenario, { props: { scenario } }]),
    ),
  });
</script>

<script lang="ts">
  import { onDestroy } from 'svelte';
  import { startHomePreview } from './home-preview-lifecycle';
  import HomeIntegrations from './HomeIntegrations.svelte';
  import { homeIntegrationsFixtures } from './home-integrations-fixtures';
  let { scenario = 'prs' }: Props = $props();
  const dispose = startHomePreview(() => []);
  onDestroy(dispose);
  const state = $derived(homeIntegrationsFixtures[scenario] ?? homeIntegrationsFixtures.prs);
</script>

<div class="h-[720px] w-full bg-background text-foreground">
  {#key scenario}<HomeIntegrations
      kind={scenario === 'linear' ? 'linear' : 'prs'}
      repositories={state.scope?.repositories ?? []}
      preview={state}
    />{/key}
</div>
