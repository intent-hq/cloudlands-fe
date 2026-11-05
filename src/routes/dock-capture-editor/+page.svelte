<script lang="ts">
  import { onDestroy } from 'svelte';
  import { Screen } from '$lib/components/patterns/screen';
  import DockRecordingEditor from '$features/hud/media-editor/recording/DockRecordingEditor.svelte';
  import DockScreenshotEditorWindow from '$features/hud/media-editor/screenshot/DockScreenshotEditorWindow.svelte';
  import { connectDockCaptureEditor } from '$features/hud/media-editor/capture-editor-bridge';
  import type { DockCaptureEditorSnapshot } from '$shared/dock-capture-editor';

  let snapshot = $state.raw<DockCaptureEditorSnapshot | null>(null);
  /** The open session has unsaved edits (the view reports it; main asks us). */
  let dirty = false;
  /** Counts main's questions the person is asked; the answer goes to the latest. */
  let discardRequest = $state(0);
  let latestRequest: string | null = null;
  // eslint-disable-next-line intent/no-component-async-data-fetch -- isolated editor window with no app store; the bridge owns its IPC
  const bridge = connectDockCaptureEditor(
    (next) => {
      if (next?.openId !== snapshot?.openId) {
        discardRequest = 0;
        latestRequest = null;
        dirty = false;
      }
      snapshot = next;
    },
    (openId, requestId) => {
      if (snapshot?.openId !== openId) return;
      // Nothing to lose: go ahead at once.
      if (!dirty) {
        bridge.discard(openId, requestId);
        return;
      }
      latestRequest = requestId;
      discardRequest += 1;
    },
  );
  onDestroy(() => bridge.dispose());
  function answer(discard: boolean): void {
    const openId = snapshot?.openId;
    const requestId = latestRequest;
    latestRequest = null;
    if (!openId || !requestId) return;
    if (discard) bridge.discard(openId, requestId);
    else bridge.keep(openId, requestId);
  }
</script>

<Screen class="h-full w-full">
  {#if snapshot?.kind === 'recording'}
    {@const openId = snapshot.openId}
    {#key openId}
      <DockRecordingEditor
        {snapshot}
        {discardRequest}
        onClose={() => bridge.close(openId)}
        onDirtyChange={(value) => (dirty = value)}
        onDiscardRequested={() => answer(true)}
        onKeepEditing={() => answer(false)}
        onSave={(edit) => bridge.save(openId, edit)}
      />
    {/key}
  {:else if snapshot?.kind === 'screenshot'}
    {@const openId = snapshot.openId}
    {#key openId}
      <!-- Save, Retake and note dictation join once their main seams exist; until then
           the view hides or disables them. -->
      <DockScreenshotEditorWindow
        {snapshot}
        {discardRequest}
        onClose={() => bridge.close(openId)}
        onDirtyChange={(value) => (dirty = value)}
        onDiscardRequested={() => answer(true)}
        onKeepEditing={() => answer(false)}
      />
    {/key}
  {/if}
</Screen>
