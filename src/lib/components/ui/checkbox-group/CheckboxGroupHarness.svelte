<script lang="ts">
  import { Item, Root } from './index';
  let value = $state<string[]>(['one']);
</script>

<form data-testid="form">
  <Root bind:value name="features" aria-label="Features">
    <Item value="one" title="One" description="First choice" />
    <Item value="two" title="Two" description="Second choice" />
    <Item value="three" title="Three" />
  </Root>
</form>
<output data-testid="value">{value.join(',')}</output>
