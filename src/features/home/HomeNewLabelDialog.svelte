<script lang="ts">
  import { FormDialog } from '$lib/components/patterns/confirm';
  import { FormField } from '$lib/components/patterns/form';
  import { Input } from '$lib/components/ui/input';
  import { formatInteger } from '$lib/i18n/format';
  import { m } from '$shared/paraglide/messages.js';
  import {
    WORKSPACE_LABEL_MAX_LENGTH,
    validateWorkspaceLabelName,
    type WorkspaceLabelNameResult,
  } from '$store/renderer/slices/sidebar-nav/workspace-labels';

  interface Props {
    open?: boolean;
    /** Custom labels already in use; a new name must differ from each ignoring case. */
    existingLabels: readonly string[];
    onCreate: (label: string) => void;
    onCancel?: () => void;
  }

  let { open = $bindable(false), existingLabels, onCreate, onCancel }: Props = $props();

  let name = $state('');
  let attempted = $state(false);
  let inputRef = $state<HTMLInputElement | null>(null);
  const result = $derived(validateWorkspaceLabelName(name, existingLabels));
  // Empty is reported only after a submit attempt; other problems show while typing.
  const error = $derived(
    result.ok || (result.error === 'empty' && !attempted) ? undefined : message(result),
  );

  $effect(() => {
    if (open) {
      name = '';
      attempted = false;
    }
  });

  function message(invalid: Extract<WorkspaceLabelNameResult, { ok: false }>): string {
    switch (invalid.error) {
      case 'empty':
        return m.home_workspaceLabel_error_empty();
      case 'tooLong':
        return m.home_workspaceLabel_error_tooLong({
          max: formatInteger(WORKSPACE_LABEL_MAX_LENGTH),
        });
      case 'duplicate':
        return m.home_workspaceLabel_error_duplicate();
      case 'reserved':
        return m.home_workspaceLabel_error_reserved();
    }
  }

  function create() {
    attempted = true;
    if (!result.ok) {
      inputRef?.focus();
      return;
    }
    const label = result.label;
    open = false;
    onCreate(label);
  }
</script>

<FormDialog
  bind:open
  title={m.home_workspaceLabel_dialog_title()}
  submitLabel={m.home_workspaceLabel_dialog_create_label()}
  cancelLabel={m.home_workspaceLabel_dialog_cancel_label()}
  initialFocus={inputRef}
  onSubmit={create}
  {onCancel}
>
  <FormField label={m.home_workspaceLabel_dialog_name_label()} {error}>
    {#snippet control(props)}<Input
        {...props}
        bind:ref={inputRef}
        bind:value={name}
        type="text"
        autocomplete="off"
      />{/snippet}
  </FormField>
</FormDialog>
