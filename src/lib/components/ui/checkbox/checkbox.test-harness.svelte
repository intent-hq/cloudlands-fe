<script lang="ts">
  import Checkbox from './checkbox.svelte';

  let {
    checked = $bindable(false),
    indeterminate = false,
    disabled = false,
    required = false,
    name = 'choice',
    value = 'selected',
    onCheckedChange,
  }: {
    checked?: boolean;
    indeterminate?: boolean;
    disabled?: boolean;
    required?: boolean;
    name?: string;
    value?: string;
    onCheckedChange?: (checked: boolean) => void;
  } = $props();
</script>

<form data-testid="checkbox-form">
  <Checkbox
    bind:checked
    {indeterminate}
    {disabled}
    {required}
    {name}
    {value}
    ariaLabel="Accept choice"
    {onCheckedChange}
  />
</form>
<output data-testid="checkbox-value">{String(checked)}</output>
