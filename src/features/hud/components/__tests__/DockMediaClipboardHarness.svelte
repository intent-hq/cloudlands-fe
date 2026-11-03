<script lang="ts">
  /**
   * CT harness: the production dock conversation, composer, controller and sagas
   * (`DockComposerE2EHarness`: wire fixtures, synthetic native capture and
   * recording) with two main-owned boundaries replaced:
   *
   * - main's media clipboard, by an in-memory clipboard that follows main's rules:
   *   a write is recorded and becomes readable as Intent media of the same byte
   *   size; `foreign()` models another app writing since; `replace()` another
   *   Intent copy (a different file); `failWrites` refuses writes; reads can be
   *   held (`holdReads`) to model a slow clipboard read; the Copy/Cut menu answers
   *   `menu`;
   * - main's `workspace-file://` protocol, by a fetch stub answering the recording's
   *   playback URL as `ok` (a movie file), `missing` (404 with a body) or `short`
   *   (fewer bytes than declared).
   *
   * Tests drive it through `window.__dockMediaClipboard`.
   */
  import { onDestroy } from 'svelte';
  import { overrideMockIpcHandler } from '$shared/ipc-mock-router';
  import { store } from '$store/renderer/store';
  import { connectionStatusChanged } from '$store/renderer/slices/daemon-health/daemon-health-slice';
  import {
    DOCK_MEDIA_CHANNELS,
    type DockMediaClipboardContent,
    type DockMediaClipboardWrite,
  } from '$shared/dock-media-clipboard';
  import ComposerHarness from '../DockComposerE2EHarness.svelte';

  type Write = { kind: string; name: string; bytes: number; marks: number };
  const writes: Write[] = [];
  let reads = 0;
  let failWrites = false;
  let menu: 'copy' | 'cut' | null = 'copy';
  let content: DockMediaClipboardContent | null = null;
  let lastBytes: Uint8Array | null = null;
  let holdReads = false;
  const heldReads: Array<() => void> = [];
  let movie: 'ok' | 'missing' | 'short' = 'ok';

  const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
  const MOVIE = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109, 1, 2, 3, 4]);

  const realFetch = window.fetch;
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith('workspace-file://')) return realFetch(input, init);
    if (movie === 'missing') return new Response('File not found', { status: 404 });
    if (movie === 'short')
      return new Response(MOVIE.slice(0, 10), { headers: { 'content-length': '4096' } });
    return new Response(MOVIE, { headers: { 'content-length': String(MOVIE.byteLength) } });
  }) as typeof fetch;

  const restore = [
    // eslint-disable-next-line intent/no-component-async-data-fetch -- test harness standing in for main at the IPC boundary
    overrideMockIpcHandler(DOCK_MEDIA_CHANNELS.CLIPBOARD_WRITE, (payload) => {
      const request = payload as DockMediaClipboardWrite;
      if (failWrites) return { ok: false, error: 'failed' };
      writes.push({
        kind: request.kind,
        name: request.name,
        bytes: request.bytes.byteLength,
        marks: request.kind === 'image' ? (request.intent?.marks.length ?? -1) : -1,
      });
      lastBytes = request.bytes;
      const size = request.bytes.byteLength;
      content =
        request.kind === 'clip'
          ? {
              kind: 'clip',
              name: request.name,
              mimeType: request.mimeType,
              sourcePath: `/clipboard/${request.name}`,
              size,
              durationMs: request.durationMs,
              hasMicAudio: request.hasMicAudio,
            }
          : request.intent
            ? {
                kind: 'image',
                name: request.name,
                size,
                pixels: { ...request.intent.pixels, base64: toBase64(request.intent.raw) },
                marks: request.intent.marks,
              }
            : null;
      return { ok: true };
    }),
    // eslint-disable-next-line intent/no-component-async-data-fetch -- test harness standing in for main at the IPC boundary
    overrideMockIpcHandler(DOCK_MEDIA_CHANNELS.CLIPBOARD_READ, async () => {
      reads += 1;
      if (holdReads) await new Promise<void>((resolve) => heldReads.push(resolve));
      return content;
    }),
    // eslint-disable-next-line intent/no-component-async-data-fetch -- test harness standing in for main at the IPC boundary
    overrideMockIpcHandler(DOCK_MEDIA_CHANNELS.MENU, () => ({ action: menu })),
  ];

  (window as unknown as Record<string, unknown>).__dockMediaClipboard = {
    writes: () => writes,
    reads: () => reads,
    /** The bytes other apps were given by the last copy (what a paste carries back). */
    lastBytes: () => (lastBytes ? toBase64(lastBytes) : null),
    foreign: () => {
      content = null;
    },
    replace: () => {
      if (content) content = { ...content, size: content.size + 1 };
    },
    setFailWrites: (value: boolean) => (failWrites = value),
    setMenu: (value: 'copy' | 'cut' | null) => (menu = value),
    setMovie: (value: 'ok' | 'missing' | 'short') => (movie = value),
    holdReads: (value: boolean) => {
      holdReads = value;
      if (!value) for (const resolve of heldReads.splice(0)) resolve();
    },
    /** Another machine or connection: the window's transport changes. */
    reconnect: () =>
      store.dispatch(
        connectionStatusChanged('connected', { mode: 'remote', target: 'other-host' } as never),
      ),
  };

  onDestroy(() => {
    for (const undo of restore) undo();
    window.fetch = realFetch;
    delete (window as unknown as Record<string, unknown>).__dockMediaClipboard;
  });
</script>

<ComposerHarness width={420} height={600} />
