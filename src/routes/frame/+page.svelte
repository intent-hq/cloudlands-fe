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
  import type { FrameBridge } from '$shared/frame-route';
  import type { MachineRailBackdrop } from '$shared/types/machine-rail';

  let backdrop = $state<MachineRailBackdrop | null>(null);
  let pushed = false;

  onMount(() => {
    document.getElementById('splash')?.remove();
    document.getElementById('app-drag-region')?.remove();
    // The frame page's preload exposes only this bridge (preload/frame.ts).
    const bridge = (window as Window & { frameBridge?: FrameBridge }).frameBridge;
    if (!bridge) return;
    const unsubscribe = bridge.onBackdrop((next) => {
      pushed = true;
      backdrop = next;
    });
    void bridge
      .getBackdrop()
      .then((initial) => {
        if (!pushed) backdrop = initial;
      })
      .catch(() => {});
    return unsubscribe;
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
