<script lang="ts">
  /**
   * The frame page: an app window's own page, under its machine views (see
   * main/frames.ts). It only paints the shell backdrop with the shown
   * machine's tint while the machine rail is on, so the tint cross-fades
   * between machines. Main sends the shown machine's backdrop; with none the
   * page stays transparent and each machine paints its own shell.
   */
  import { onMount } from 'svelte';
  import { Screen } from '$lib/components/patterns/screen';
  import { IPC_CHANNELS } from '$shared/ipc-registry';
  import {
    MACHINE_RAIL_BACKDROP_CHANGED_EVENT,
    type MachineRailBackdrop,
  } from '$shared/types/machine-rail';

  let backdrop = $state<MachineRailBackdrop | null>(null);
  let pushed = false;

  onMount(() => {
    document.getElementById('splash')?.remove();
    document.getElementById('app-drag-region')?.remove();
    const api = window.electronAPI;
    if (!api?.on) return;
    /* eslint-disable intent/no-component-async-data-fetch -- the frame page runs without the app store by design; main owns the backdrop and pushes each change. */
    const listenerId = api.on(
      MACHINE_RAIL_BACKDROP_CHANGED_EVENT,
      (next: MachineRailBackdrop | null) => {
        pushed = true;
        backdrop = next;
      },
    );
    void api
      .invoke(IPC_CHANNELS.MACHINE_RAIL.GET_BACKDROP, {})
      .then((initial) => {
        if (!pushed) backdrop = initial as MachineRailBackdrop | null;
      })
      .catch(() => {});
    return () => api.offById(MACHINE_RAIL_BACKDROP_CHANGED_EVENT, listenerId);
    /* eslint-enable intent/no-component-async-data-fetch */
  });
</script>

<Screen class="h-full bg-transparent">
  <div
    class="frame-backdrop"
    style:background-color={backdrop?.background ?? 'transparent'}
    data-reduced-motion={backdrop?.reducedMotion || undefined}
    data-testid="frame-backdrop"
    aria-hidden="true"
  >
    <span style:background-color={backdrop?.tint ?? 'transparent'}></span>
  </div>
</Screen>
