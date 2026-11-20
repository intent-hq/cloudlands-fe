<!--
  In-app stand-in for native file dialogs (INTENT_IN_APP_PICKER, Intent OS).
  Main (src/main/file-dialogs.ts) pushes one request per open/save chooser;
  inAppFileDialogSaga queues it in the store, this host shows the oldest over
  the frontend host's filesystem and dispatches the answer.
-->
<script lang="ts">
  import DirectoryPickerModal from '$features/onboarding/messages/DirectoryPickerModal.svelte';
  import { store as appStore } from '$store/renderer/store';
  import { inAppFileDialogAnswered } from '$store/renderer/slices/in-app-file-dialog/in-app-file-dialog-slice';
  import { selectCurrentInAppFileDialog } from '$store/renderer/slices/in-app-file-dialog/in-app-file-dialog-selectors';

  import { saveDefaults } from './in-app-file-dialog-host';

  const current$ = selectCurrentInAppFileDialog();
  const current = $derived($current$);
  const save = $derived(current?.kind === 'save' ? saveDefaults(current.defaultPath) : null);

  function answer(paths: string[] | null) {
    if (current) appStore.dispatch(inAppFileDialogAnswered(current.id, paths));
  }
</script>

{#if current}
  {#key current.id}
    <DirectoryPickerModal
      open
      source="local"
      title={current.title}
      selectLabel={current.buttonLabel}
      mode={current.kind === 'save' ? 'save' : current.directory ? 'directory' : 'file'}
      multiple={current.multiple}
      extensions={current.extensions}
      initialPath={save ? save.directory : current.defaultPath}
      defaultFileName={save?.fileName}
      onSelect={(path) => answer([path])}
      onSelectMany={(paths) => answer(paths)}
      onClose={() => answer(null)}
    />
  {/key}
{/if}
