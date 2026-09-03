<script lang="ts">
  import Toggle from './toggle.svelte';

  let {
    pressed = $bindable(false),
    disabled = false,
    size = 'default',
    onChange,
  }: {
    pressed?: boolean;
    disabled?: boolean;
    size?: 'default' | 'sm' | 'lg' | 'xs';
    onChange?: (value: string | boolean) => void;
  } = $props();
</script>

<Toggle bind:pressed {disabled} {size} {onChange}>Product updates</Toggle>
<output data-testid="toggle-value">{String(pressed)}</output>
