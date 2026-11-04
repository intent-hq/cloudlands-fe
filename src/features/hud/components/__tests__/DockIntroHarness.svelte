<script lang="ts">
  /**
   * CT harness for the notch intro: opens it as the dock route does
   * (`initDockIntro`) and stands in for main's dock-setting save, which can
   * confirm, reject or report a different state. Every save request is recorded.
   */
  import { WINDOW_CHANNELS } from '$shared/ipc/channels';
  import { initDockIntro } from '$features/hud/intro/dock-intro.svelte';
  import DockRailPreview from '../dock-rail.preview.svelte';
  import type { DockRailPreviewProps } from '../dock-rail.preview-fixtures';

  let {
    save = 'confirm',
    ...preview
  }: DockRailPreviewProps & { save?: 'confirm' | 'reject' | 'mismatch' } = $props();
  let saves = $state<unknown[]>([]);
  (globalThis as { electronAPI?: unknown }).electronAPI = {
    invoke: async (channel: string, payload: { enabled?: boolean }) => {
      if (channel !== WINDOW_CHANNELS.SET_DOCK_LAB) return undefined;
      saves = [...saves, payload];
      if (save === 'reject') throw new Error('save failed');
      return { enabled: save === 'mismatch' ? !payload.enabled : payload.enabled };
    },
    on: () => 'dock-intro-harness',
    offById: () => {},
  };
  initDockIntro();
</script>

<div data-testid="dock-intro-harness" data-saves={JSON.stringify(saves)}>
  <DockRailPreview {...preview} />
</div>
