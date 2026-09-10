<script lang="ts">
  import { FormDialog } from '$lib/components/patterns/confirm';
  import { Input } from '$lib/components/ui/input';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    open?: boolean;
    static?: boolean;
    title?: string;
    description?: string;
    placeholder?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    onConfirm?: (value: string) => void;
    onCancel?: () => void;
  }

  let {
    open = $bindable(false),
    static: staticPosition = false,
    title = m.modals_input_title(),
    description = '',
    placeholder = '',
    confirmLabel = m.modals_input_confirm_label(),
    cancelLabel = m.modals_input_cancel_label(),
    onConfirm,
    onCancel,
  }: Props = $props();

  let inputValue = $state('');
  let inputRef: HTMLInputElement | null = $state(null);

  function close() {
    open = false;
    inputValue = '';
    onCancel?.();
  }

  function confirm() {
    if (!inputValue.trim()) return;
    onConfirm?.(inputValue.trim());
    open = false;
    inputValue = '';
  }
</script>

<FormDialog
  bind:open
  static={staticPosition}
  {title}
  {description}
  submitLabel={confirmLabel}
  {cancelLabel}
  canSubmit={Boolean(inputValue.trim())}
  initialFocus={inputRef}
  onSubmit={confirm}
  onCancel={close}
>
  <Input bind:ref={inputRef} bind:value={inputValue} type="text" {placeholder} />
</FormDialog>
