<script lang="ts">
  /**
   * CT harness: the real dock conversation and composer (wire fixtures, synthetic
   * native capture) with main's media clipboard replaced at its IPC boundary by an
   * in-memory clipboard that follows main's rules: a write is recorded and becomes
   * readable as Intent media (a screenshot keeps its raw pixels and marks); `foreign`
   * models another app having written the clipboard since; `failWrites` refuses the
   * write; the Copy/Cut menu answers `menu`.
   */
  import { onDestroy } from 'svelte';
  import { overrideMockIpcHandler } from '$shared/ipc-mock-router';
  import {
    DOCK_MEDIA_CHANNELS,
    type DockMediaClipboardContent,
    type DockMediaClipboardWrite,
  } from '$shared/dock-media-clipboard';
  import ConversationWireHarness from '../DockConversationWireHarness.svelte';

  let writes = $state<{ kind: string; name: string; bytes: number; marks: number }[]>([]);
  let reads = $state(0);
  let foreign = $state(false);
  let failWrites = $state(false);
  let menu = $state<'copy' | 'cut' | null>('copy');
  let content: DockMediaClipboardContent | null = null;

  const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
  const restore = [
    // eslint-disable-next-line intent/no-component-async-data-fetch -- test harness standing in for main at the IPC boundary
    overrideMockIpcHandler(DOCK_MEDIA_CHANNELS.CLIPBOARD_WRITE, (payload) => {
      const request = payload as DockMediaClipboardWrite;
      if (failWrites) return { ok: false, error: 'failed' };
      writes = [
        ...writes,
        {
          kind: request.kind,
          name: request.name,
          bytes: request.bytes.byteLength,
          marks: request.kind === 'image' ? (request.intent?.marks.length ?? -1) : -1,
        },
      ];
      foreign = false;
      content =
        request.kind === 'clip'
          ? {
              kind: 'clip',
              name: request.name,
              mimeType: request.mimeType,
              sourcePath: `/clipboard/${request.name}`,
              size: request.bytes.byteLength,
              durationMs: request.durationMs,
              hasMicAudio: request.hasMicAudio,
            }
          : request.intent
            ? {
                kind: 'image',
                pixels: { ...request.intent.pixels, base64: toBase64(request.intent.raw) },
                marks: request.intent.marks,
              }
            : null;
      return { ok: true };
    }),
    // eslint-disable-next-line intent/no-component-async-data-fetch -- test harness standing in for main at the IPC boundary
    overrideMockIpcHandler(DOCK_MEDIA_CHANNELS.CLIPBOARD_READ, () => {
      reads += 1;
      return foreign ? null : content;
    }),
    // eslint-disable-next-line intent/no-component-async-data-fetch -- test harness standing in for main at the IPC boundary
    overrideMockIpcHandler(DOCK_MEDIA_CHANNELS.MENU, () => ({ action: menu })),
  ];
  onDestroy(() => {
    for (const undo of restore) undo();
  });
</script>

<div data-testid="media-clipboard-harness" data-writes={JSON.stringify(writes)} data-reads={reads}>
  <button type="button" onclick={() => (foreign = true)}>Another app copies</button>
  <button type="button" onclick={() => (failWrites = !failWrites)}>Toggle clipboard failure</button>
  <button type="button" onclick={() => (menu = 'cut')}>Menu chooses Cut</button>
  <ConversationWireHarness width={360} height={560} syntheticNative />
</div>
