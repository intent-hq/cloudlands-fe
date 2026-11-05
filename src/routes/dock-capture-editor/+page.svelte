<script lang="ts">
  import { onDestroy } from 'svelte';
  import { Screen } from '$lib/components/patterns/screen';
  import DockRecordingEditor from '$features/hud/media-editor/recording/DockRecordingEditor.svelte';
  import DockScreenshotEditorWindow from '$features/hud/media-editor/screenshot/DockScreenshotEditorWindow.svelte';
  import { connectDockCaptureEditor } from '$features/hud/media-editor/capture-editor-bridge';
  import { screenshotCaptureBaseline } from '$features/hud/media-editor/capture-baseline';
  import type {
    DockCaptureEditorNoteDictationUpdate,
    DockCaptureEditorSnapshot,
  } from '$shared/dock-capture-editor';
  import { dockMediaRetakeMapping } from '$shared/dock-media-edit';

  let snapshot = $state.raw<DockCaptureEditorSnapshot | null>(null);
  /** The open session has unsaved edits (the view reports it; main asks us). */
  let dirty = false;
  /** Counts main's questions the person is asked; the answer goes to the latest. */
  let discardRequest = $state(0);
  let latestRequest: string | null = null;
  /** The latest note dictation text for the open session (the view fences generations). */
  let noteDictationUpdate = $state.raw<DockCaptureEditorNoteDictationUpdate | null>(null);
  // eslint-disable-next-line intent/no-component-async-data-fetch -- isolated editor window with no app store; the bridge owns its IPC
  const bridge = connectDockCaptureEditor(
    (next) => {
      if (next?.openId !== snapshot?.openId) {
        discardRequest = 0;
        latestRequest = null;
        dirty = false;
        noteDictationUpdate = null;
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
    (update) => {
      if (update.openId === snapshot?.openId) noteDictationUpdate = update;
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
      <!-- Save shows only when sending honors saved edits (the view checks
           output.ready). Retake is offered only with a capture frame, so marks can be
           placed on the new image exactly. -->
      <DockScreenshotEditorWindow
        {snapshot}
        captureBaseline={screenshotCaptureBaseline(snapshot)}
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
        onNoteDictation={(request) => bridge.noteDictation(request)}
        {noteDictationUpdate}
        onRetake={snapshot.source?.capture?.frame
          ? async (bundle) => {
              const outcome = await bridge.retake(openId);
              if (!outcome?.ok) return null;
              const mapping = dockMediaRetakeMapping(bundle.source, outcome.source);
              // Without a frame on the same display, marks cannot be placed: no candidate.
              return mapping
                ? {
                    candidateToken: outcome.candidateToken,
                    source: outcome.source,
                    mediaUrl: outcome.mediaUrl,
                    mapping,
                  }
                : null;
            }
          : undefined}
      />
    {/key}
  {/if}
</Screen>
