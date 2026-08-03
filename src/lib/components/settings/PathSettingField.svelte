<script lang="ts">
  /**
   * PathSettingField — reusable settings-row path field.
   *
   * Read-only path textbox with a trailing picker icon button and a clear
   * (reset-to-default) button. Browsing goes through the directory-picker
   * service seam: native dialog when the daemon is local, in-app
   * DirectoryPickerModal (daemon-host browsing) otherwise. An optional
   * OK/Cancel confirmation is shown before any picker opens.
   */
  import { faFolderOpen, faRotateLeft } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { m } from '$shared/paraglide/messages.js';
  import { pickDirectory, pickFile } from '$lib/directory-picker-service';
  import DirectoryPickerModal from '$features/onboarding/messages/DirectoryPickerModal.svelte';
  import MessageDialog from '$lib/components/modals/MessageDialog.svelte';

  interface Props {
    /** What the picker selects. */
    mode?: 'directory' | 'file';
    /** Current path; empty string means the daemon default applies. */
    value?: string;
    /** id for the readonly textbox so an external <label for> can target it. */
    id?: string;
    placeholder?: string;
    /** Picker start location used when `value` is empty (e.g. `~/.ssh`). */
    defaultPath?: string;
    /** Accessible name for the readonly textbox (when no external label). */
    ariaLabel?: string;
    /** Title for the native dialog and the remote picker modal. */
    pickerTitle?: string;
    /** Aria-label for the picker button; defaults per mode. */
    browseAriaLabel?: string;
    /** Aria-label for the clear (reset-to-default) button. */
    clearAriaLabel?: string;
    /** OK/Cancel confirmation shown before any picker opens; Cancel aborts. */
    confirm?: { title: string; message: string };
    /** Fired with the picked path, or '' when cleared. */
    onchange?: (path: string) => void;
  }

  let {
    mode = 'directory',
    value = $bindable(''),
    id,
    placeholder,
    defaultPath,
    ariaLabel,
    pickerTitle,
    browseAriaLabel,
    clearAriaLabel,
    confirm,
    onchange,
  }: Props = $props();

  let modalOpen = $state(false);
  let confirmOpen = $state(false);

  const resolvedBrowseAriaLabel = $derived(
    browseAriaLabel ??
      (mode === 'file'
        ? m.settings_pathField_browseFile_ariaLabel()
        : m.settings_pathField_browseDirectory_ariaLabel()),
  );
  const resolvedClearAriaLabel = $derived(
    clearAriaLabel ?? m.settings_pathField_clear_ariaLabel(),
  );

  function commit(path: string) {
    value = path;
    onchange?.(path);
  }

  function openPicker() {
    const options = {
      title: pickerTitle,
      defaultPath: value || defaultPath || undefined,
      openModal: () => (modalOpen = true),
      onSelect: commit,
    };
    // eslint-disable-next-line intent/no-component-async-data-fetch -- fire-and-forget picker-dialog seam (native dialog vs in-app modal routing), not a domain data fetch; rule misfires on the '-service' import source.
    void (mode === 'file' ? pickFile(options) : pickDirectory(options));
  }

  function handleBrowseClick() {
    if (confirm) {
      confirmOpen = true;
    } else {
      openPicker();
    }
  }

  function handleConfirmSelect(buttonIndex: number) {
    if (buttonIndex === 1) openPicker();
  }
</script>

<div class="flex items-center gap-2 flex-1 max-w-md">
  <input
    {id}
    type="text"
    readonly
    {value}
    {placeholder}
    aria-label={ariaLabel}
    class="flex-1 min-w-0 px-3 py-1.5 bg-background border border-border rounded-md text-sm text-foreground transition-all focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
  />
  <button
    type="button"
    onclick={handleBrowseClick}
    aria-label={resolvedBrowseAriaLabel}
    title={resolvedBrowseAriaLabel}
    class="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded transition-colors cursor-pointer shrink-0"
  >
    <Fa icon={faFolderOpen} size="sm" />
  </button>
  <button
    type="button"
    onclick={() => commit('')}
    disabled={!value}
    aria-label={resolvedClearAriaLabel}
    title={resolvedClearAriaLabel}
    class="p-1.5 rounded transition-colors shrink-0 {value
      ? 'text-muted-foreground hover:text-foreground hover:bg-muted/50 cursor-pointer'
      : 'text-muted-foreground/40 cursor-not-allowed'}"
  >
    <Fa icon={faRotateLeft} size="sm" />
  </button>
</div>

{#if confirm}
  <MessageDialog
    bind:open={confirmOpen}
    title={confirm.title}
    message={confirm.message}
    type="warning"
    buttons={[m.settings_pathField_confirm_cancel_label(), m.settings_pathField_confirm_ok_label()]}
    cancelIndex={0}
    onSelect={handleConfirmSelect}
  />
{/if}

<DirectoryPickerModal
  open={modalOpen}
  title={pickerTitle}
  initialPath={value}
  {mode}
  onSelect={(path) => {
    modalOpen = false;
    commit(path);
  }}
  onClose={() => (modalOpen = false)}
/>
