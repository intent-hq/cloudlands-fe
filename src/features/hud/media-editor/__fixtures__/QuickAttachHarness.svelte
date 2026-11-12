<script lang="ts">
  import { onDestroy } from 'svelte';
  import DockScreenshotEditorWindow from '../screenshot/DockScreenshotEditorWindow.svelte';
  import DockRecordingEditor from '../recording/DockRecordingEditor.svelte';
  import { connectDockCaptureEditor } from '../capture-editor-bridge';
  import { overrideMockIpcHandler } from '$shared/ipc-mock-router';
  import {
    DOCK_CAPTURE_EDITOR_CHANNELS as channels,
    DockCaptureEditorCloseSchema,
    type DockCaptureEditorSnapshot,
  } from '$shared/dock-capture-editor';
  import { DockMediaEditSchema, type DockMediaEdit } from '$shared/dock-media-edit';

  let {
    kind = 'screenshot',
    epoch = 0,
    release = 0,
    mode = 'success',
    principal = 'A',
    legacy = false,
    admitted = true,
    closeMode = 'normal',
    nativeRequest = 0,
  }: {
    kind?: 'screenshot' | 'recording';
    epoch?: number;
    release?: number;
    mode?: 'success' | 'fail' | 'defer';
    principal?: string;
    legacy?: boolean;
    admitted?: boolean;
    closeMode?: 'normal' | 'fail' | 'throw' | 'hang';
    nativeRequest?: number;
  } = $props();
  let requests = $state<unknown[]>([]);
  let closes = $state(0);
  let acknowledgements = $state(0);
  let dirty = $state(false);
  let discarded = $state(0);
  let kept = $state(0);
  let waiters: (() => void)[] = [];
  $effect(() => {
    if (release) {
      for (const resolve of waiters.splice(0)) resolve();
    }
  });
  const image = document.createElement('canvas');
  image.width = 800;
  image.height = 500;
  const ctx = image.getContext('2d')!;
  ctx.fillStyle = '#dfe5eb';
  ctx.fillRect(0, 0, 800, 500);
  const imageUrl = image.toDataURL();
  const movie =
    'data:video/webm;base64,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';
  const snapshot = $derived.by((): DockCaptureEditorSnapshot => {
    const id = `${kind}-${epoch}`;
    return {
      openId: `00000000-0000-4000-8000-${String(epoch).padStart(12, '0')}`,
      kind,
      workspaceId: 'workspace-A',
      agentId: 'agent-A',
      attachmentId: id,
      sourceRevision: '0',
      title: 'Synthetic capture',
      mediaUrl: kind === 'screenshot' ? imageUrl : movie,
      marks: [],
      provenance: { visuals: 'clean' },
      output: { ready: admitted, version: 2 },
      source: {
        id,
        revision: 0,
        kind,
        attachmentId: id,
        path: `.intent/attachments/${id}.${kind === 'screenshot' ? 'png' : 'webm'}`,
        durationMs: kind === 'screenshot' ? 0 : 2000,
        width: kind === 'screenshot' ? 800 : 640,
        height: kind === 'screenshot' ? 500 : 360,
        audio: 'none',
        visuals: 'clean',
        batches: [],
        capturedMarks: [],
      },
    };
  });
  const disposers = [
    // eslint-disable-next-line intent/no-component-async-data-fetch -- This test-only fixture installs a synthetic capture-editor IPC handler.
    overrideMockIpcHandler(channels.GET, () => null),
    // eslint-disable-next-line intent/no-component-async-data-fetch -- This test-only fixture installs a synthetic capture-editor IPC handler.
    overrideMockIpcHandler(channels.SAVE, async (raw) => {
      const request = raw as { openId: string; edit: DockMediaEdit };
      requests = [...requests, { channel: channels.SAVE, request }];
      const opening = snapshot.openId;
      if (!DockMediaEditSchema.safeParse(request.edit).success || request.openId !== opening)
        return { requestId: '10000000-0000-4000-8000-000000000000', result: 'failed' };
      if (mode === 'defer') await new Promise<void>((resolve) => waiters.push(resolve));
      acknowledgements++;
      if (principal !== 'A' || opening !== snapshot.openId)
        return { requestId: '10000000-0000-4000-8000-000000000000', result: 'stale-source' };
      if (mode === 'fail')
        return { requestId: '10000000-0000-4000-8000-000000000000', result: 'failed' };
      return {
        requestId: '10000000-0000-4000-8000-000000000000',
        result: 'saved',
        saved: { ...request.edit, revision: request.edit.revision + 1 },
      };
    }),
    // eslint-disable-next-line intent/no-component-async-data-fetch -- This test-only fixture installs a synthetic capture-editor IPC handler.
    overrideMockIpcHandler(channels.CLOSE, async (raw) => {
      const request = raw as { openId: string; intent?: 'attach' };
      requests = [...requests, { channel: channels.CLOSE, request }];
      if (closeMode === 'throw') throw new Error('Synthetic close failure');
      if (closeMode === 'hang') return await new Promise<boolean>(() => {});
      if (closeMode === 'fail') return false;
      if (
        // eslint-disable-next-line intent/no-component-async-data-fetch -- Validate a synthetic fixture payload; this pure schema check makes no domain request.
        !DockCaptureEditorCloseSchema.safeParse(request).success ||
        request.openId !== snapshot.openId ||
        principal !== 'A' ||
        (legacy && request.intent === 'attach')
      )
        return false;
      closes++;
      return true;
    }),
  ];
  // eslint-disable-next-line intent/no-component-async-data-fetch -- Exercise the production bridge against this fixture's synthetic IPC handlers.
  const bridge = connectDockCaptureEditor(() => {});
  onDestroy(() => {
    bridge.dispose();
    disposers.reverse().forEach((dispose) => dispose());
  });
</script>

<div
  class="fixture"
  data-requests={JSON.stringify(requests)}
  data-closes={closes}
  data-acknowledgements={acknowledgements}
  data-dirty={dirty}
  data-discarded={discarded}
  data-kept={kept}
>
  {#key snapshot.openId}
    {@const openId = snapshot.openId}
    {#if kind === 'screenshot'}
      <DockScreenshotEditorWindow
        {snapshot}
        discardRequest={nativeRequest}
        onDiscardRequested={() => discarded++}
        onKeepEditing={() => kept++}
        onClose={() => bridge.close(openId)}
        onAttach={() => bridge.attach(openId)}
        onDirtyChange={(value) => (dirty = value)}
        onSave={({ edit, replacement }) =>
          bridge
            .save(openId, edit, replacement)
            .then(
              (result) =>
                result ?? { requestId: '10000000-0000-4000-8000-000000000000', result: 'failed' },
            )}
      />
    {:else}
      <DockRecordingEditor
        {snapshot}
        discardRequest={nativeRequest}
        onDiscardRequested={() => discarded++}
        onKeepEditing={() => kept++}
        onClose={() => bridge.close(openId)}
        onAttach={() => bridge.attach(openId)}
        onDirtyChange={(value) => (dirty = value)}
        onSave={(edit) => bridge.save(openId, edit)}
      />
    {/if}
  {/key}
</div>

<style>
  .fixture {
    height: 100dvh;
    width: 100%;
  }
</style>
