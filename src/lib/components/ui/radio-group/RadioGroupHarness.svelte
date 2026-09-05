<script lang="ts">
  import { Item, Root } from './index';
  let value = $state('one');
</script>

<form data-testid="form">
  <Root bind:value name="priority" layout="inline" aria-label="Priority">
    <Item value="one" title="One" description="First choice" class="w-28" />
    <Item value="two" title="Two" description="Second choice" />
  </Root>
</form>
<output data-testid="value">{value}</output>
