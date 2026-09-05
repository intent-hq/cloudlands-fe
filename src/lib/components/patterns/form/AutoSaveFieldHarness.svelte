<script lang="ts">
  import { Input } from '$lib/components/ui/input';
  import AutoSaveField from './AutoSaveField.svelte';

  let {
    value = 'Original',
    onSave,
  }: { value?: string; onSave: (value: string) => void | Promise<void> } = $props();
</script>

<AutoSaveField {value} originalValue="Original" {onSave} debounceMs={20} savedFlashMs={50}>
  {#snippet children(field)}
    <Input
      aria-label="Autosaved value"
      value={field.value}
      oninput={(event) => field.update(event.currentTarget.value)}
      onfocus={field.onfocus}
      onblur={field.onblur}
      onkeydown={field.onkeydown}
    />
  {/snippet}
</AutoSaveField>
