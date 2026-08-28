<script lang="ts">
  let {
    triggerClass = '',
    value = '',
    onchange,
    onModelChange,
  }: {
    triggerClass?: string;
    value?: string;
    onchange?: (event: CustomEvent<{ branch: string }>) => void;
    onModelChange?: (model: string) => void;
    [key: string]: unknown;
  } = $props();

  const label = $derived(onchange ? 'Select branch' : 'Select model');

  function activate() {
    if (onchange) {
      onchange({ detail: { branch: 'master' } } as CustomEvent<{ branch: string }>);
    } else {
      onModelChange?.('mock:model');
    }
  }
</script>

<button type="button" aria-label={label} class={triggerClass} onclick={activate}>
  {value || label}
</button>
