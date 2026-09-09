<script lang="ts">
  import { Item, Root } from './index';
  let { oneLine = false }: { oneLine?: boolean } = $props();
  let value = $state('one');
</script>

<form data-testid="form">
  <Root bind:value name="priority" layout={oneLine ? 'stacked' : 'inline'} aria-label="Priority">
    <Item
      value="one"
      title="One"
      description={oneLine ? undefined : 'First choice'}
      class={oneLine ? 'w-full' : 'w-28'}
    />
    <Item value="two" title="Two" description={oneLine ? undefined : 'Second choice'} />
  </Root>
</form>
<output data-testid="value">{value}</output>
