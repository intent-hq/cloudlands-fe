<script lang="ts">
  import Switch from './switch.svelte';

  let {
    checked = $bindable(false),
    disabled = false,
    required = false,
    onCheckedChange,
  }: {
    checked?: boolean;
    disabled?: boolean;
    required?: boolean;
    onCheckedChange?: (checked: boolean) => void;
  } = $props();
</script>

<form data-testid="switch-form">
  <Switch
    bind:checked
    {disabled}
    {required}
    name="notifications"
    value="enabled"
    ariaLabel="Notifications"
    {onCheckedChange}
  />
</form>
<output data-testid="switch-value">{String(checked)}</output>
