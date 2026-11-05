<script lang="ts">
  import { onDestroy } from 'svelte';
  import { Screen } from '$lib/components/patterns/screen';
  import DockRecordingEditor from '$features/hud/media-editor/recording/DockRecordingEditor.svelte';
  import { connectDockCaptureEditor } from '$features/hud/media-editor/capture-editor-bridge';
  import type { DockCaptureEditorSnapshot } from '$shared/dock-capture-editor';

  let snapshot = $state.raw<DockCaptureEditorSnapshot | null>(null);
  /** Counts main's "edits would be lost" questions for the open session. */
  let discardRequest = $state(0);
  // eslint-disable-next-line intent/no-component-async-data-fetch -- isolated editor window with no app store; the bridge owns its IPC
  const bridge = connectDockCaptureEditor(
    (next) => {
      if (next?.openId !== snapshot?.openId) discardRequest = 0;
      snapshot = next;
    },
    (openId) => {
      if (snapshot?.openId === openId) discardRequest += 1;
    },
  );
  onDestroy(() => bridge.dispose());
</script>

<Screen class="h-full w-full">
  {#if snapshot?.kind === 'recording'}
    {@const openId = snapshot.openId}
    {#key openId}
      <DockRecordingEditor
        {snapshot}
        {discardRequest}
        onClose={() => bridge.close(openId)}
        onDirtyChange={(dirty) => bridge.setDirty(openId, dirty)}
        onDiscardRequested={() => bridge.discard(openId)}
        onKeepEditing={() => bridge.keep(openId)}
      />
    {/key}
  {/if}
</Screen>
