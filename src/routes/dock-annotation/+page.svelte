<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { Screen } from '$lib/components/patterns/screen';
  import DockAnnotationOverlay from '$features/hud/components/DockAnnotationOverlay.svelte';
  import {
    connectDockAnnotationOverlay,
    connectDockAnnotationSignal,
    type DockAnnotationOverlayView,
  } from '$features/hud/components/dock-annotation-overlay-bridge';
  import type { DockAnnotationSignal } from '$shared/dock-annotation';

  let view = $state.raw<DockAnnotationOverlayView>({ overlay: null, stillUrl: null });
  let signal = $state.raw<DockAnnotationSignal | null>(null);
  // eslint-disable-next-line intent/no-component-async-data-fetch -- isolated overlay window with no app store; the bridge owns its IPC
  const stopSignal = connectDockAnnotationSignal((value) => (signal = value));

  // eslint-disable-next-line intent/no-component-async-data-fetch -- isolated overlay window with no app store; the bridge owns its IPC
  const bridge = connectDockAnnotationOverlay(
    (next) => (view = next),
    async () => {
      // Ready only after this session's first frame is painted.
      await tick();
      // A hidden window may never run a frame; the bounded fallback keeps the
      // ready handshake (and so the dock's start) from timing out silently.
      await new Promise<void>((resolve) => {
        const fallback = setTimeout(resolve, 120);
        requestAnimationFrame(() => {
          clearTimeout(fallback);
          resolve();
        });
      });
    },
  );
  onDestroy(() => {
    bridge.dispose();
    stopSignal();
  });
</script>

<Screen class="h-full w-full bg-transparent">
  <DockAnnotationOverlay
    overlay={view.overlay}
    stillUrl={view.stillUrl}
    transport={bridge.transport}
    {signal}
  />
</Screen>
