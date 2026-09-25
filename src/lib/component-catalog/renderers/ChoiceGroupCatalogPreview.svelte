<script lang="ts">
  import * as CheckboxGroup from '$lib/components/ui/checkbox-group';
  import * as RadioGroup from '$lib/components/ui/radio-group';
  import type { CatalogRendererProps } from '../catalog-renderers';

  let { componentId, fixture }: CatalogRendererProps = $props();
  let radioValue = $state('standard');
  let checkboxValues = $state<string[]>(['alerts', 'summaries']);
</script>

<div class="min-w-72" data-catalog-rendered-state={fixture.states.join(' ')}>
  {#if componentId === 'radio-group'}
    {#if fixture.id === 'radio-group-one-line-row'}
      <RadioGroup.Root bind:value={radioValue} aria-label="One-line delivery speed">
        <RadioGroup.Item value="standard" title="Standard" />
        <RadioGroup.Item value="fast" title="Fast" />
        <RadioGroup.Item value="later" title="Later" />
      </RadioGroup.Root>
    {:else}
      <RadioGroup.Root bind:value={radioValue} aria-label="Delivery speed">
        <RadioGroup.Item value="standard" title="Standard" description="Balanced delivery" />
        <RadioGroup.Item value="fast" title="Fast" description="Prioritize this delivery" />
        <RadioGroup.Item value="later" title="Later" description="Schedule for later" />
      </RadioGroup.Root>
    {/if}
  {:else if componentId === 'checkbox-group'}
    {#if fixture.id === 'checkbox-group-selected-row'}
      <CheckboxGroup.Root bind:value={checkboxValues} aria-label="One-line notifications">
        <CheckboxGroup.Item value="alerts" title="Alerts" />
        <CheckboxGroup.Item value="summaries" title="Summaries" />
        <CheckboxGroup.Item value="tips" title="Tips" />
      </CheckboxGroup.Root>
    {:else}
      <CheckboxGroup.Root bind:value={checkboxValues} aria-label="Notifications">
        <CheckboxGroup.Item value="alerts" title="Alerts" description="Important changes" />
        <CheckboxGroup.Item value="summaries" title="Summaries" description="Periodic updates" />
        <CheckboxGroup.Item value="tips" title="Tips" description="Product guidance" />
      </CheckboxGroup.Root>
    {/if}
  {/if}
</div>
