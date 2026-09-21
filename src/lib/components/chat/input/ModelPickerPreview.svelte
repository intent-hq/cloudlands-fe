<script lang="ts">
  import { onMount, type ComponentProps } from 'svelte';
  import ModelPicker from './ModelPicker.svelte';

  let {
    initialOpen = false,
    ...props
  }: ComponentProps<typeof ModelPicker> & {
    initialOpen?: boolean;
  } = $props();
  let picker: ModelPicker;

  onMount(() => {
    if (initialOpen) picker.open();
  });
</script>

<ModelPicker bind:this={picker} {...props} />
