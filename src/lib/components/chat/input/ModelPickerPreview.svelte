<script lang="ts">
  import { onMount, type ComponentProps } from 'svelte';
  import ModelPicker from './ModelPicker.svelte';

  let {
    initialOpen = false,
    captureMenu = false,
    ...props
  }: ComponentProps<typeof ModelPicker> & {
    initialOpen?: boolean;
    captureMenu?: boolean;
  } = $props();
  let picker: ModelPicker;

  onMount(() => {
    if (initialOpen) picker.open();
  });
</script>

<div class={captureMenu ? 'min-h-[420px]' : undefined}>
  <ModelPicker bind:this={picker} {...props} />
</div>
