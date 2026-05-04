<script lang="ts">
  let {
    isDirty = false,
    isSaving = false,
    isAutoSaving = false,
    onSave,
  }: {
    isDirty?: boolean;
    isSaving?: boolean;
    isAutoSaving?: boolean;
    onSave?: () => void;
  } = $props();

  const label = $derived(
    isSaving ? 'Saving...' : isDirty ? 'Click to save (⌘S)' : 'All changes saved',
  );
</script>

<button
  type="button"
  data-testid="save-indicator"
  data-dirty={isDirty}
  data-saving={isSaving}
  data-auto-saving={isAutoSaving}
  aria-label={label}
  disabled={!isDirty || isSaving || !onSave}
  onclick={() => onSave?.()}
>
  {label}
</button>
