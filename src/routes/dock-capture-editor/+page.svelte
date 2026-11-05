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
      <!-- Note dictation joins once its seam exists; Save shows only when sending
           honors saved edits (the view checks output.ready). -->
      <DockScreenshotEditorWindow
        {snapshot}
        {discardRequest}
        onClose={() => bridge.close(openId)}
        onDirtyChange={(value) => (dirty = value)}
        onDiscardRequested={() => answer(true)}
        onKeepEditing={() => answer(false)}
        onSave={async ({ edit, replacement }) =>
          (await bridge.save(openId, edit, replacement)) ?? {
            requestId: crypto.randomUUID(),
            result: 'failed',
          }}
        onRetake={async (bundle) => {
          const outcome = await bridge.retake(openId);
          if (!outcome?.ok) return null;
          // Without the capture frames, marks map by size only (same origin).
          return {
            candidateToken: outcome.candidateToken,
            source: outcome.source,
            mediaUrl: outcome.mediaUrl,
            mapping: {
              scaleX: outcome.source.width / bundle.source.width,
              scaleY: outcome.source.height / bundle.source.height,
              offsetX: 0,
              offsetY: 0,
            },
          };
        }}
      />
    {/key}
  {/if}
</Screen>
