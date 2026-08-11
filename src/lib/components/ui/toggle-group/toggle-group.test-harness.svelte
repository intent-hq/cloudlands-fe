<script lang="ts">
  import { Item, Root } from './index';

  let {
    multiple = false,
    variant = 'default',
  }: { multiple?: boolean; variant?: 'default' | 'flat' } = $props();
  let singleValue = $state('list');
  let multipleValue = $state<string[]>(['list']);
</script>

{#if multiple}
  <Root type="multiple" bind:value={multipleValue} aria-label="Display options" {variant}>
    <Item value="list" aria-label="List view" />
    <Item value="tree" aria-label="Tree view" />
  </Root>
  <output data-testid="group-value">{multipleValue.join(',')}</output>
{:else}
  <Root type="single" bind:value={singleValue} aria-label="Display mode" {variant}>
    <Item value="list" aria-label="List view" />
    <Item value="tree" aria-label="Tree view" />
  </Root>
  <output data-testid="group-value">{singleValue}</output>
{/if}
