<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import { WINDOW_CHANNELS } from '$shared/ipc/channels';

  function setup(enabled: boolean, failSave = false) {
    let saved = enabled;
    let sequence = 0;
    const listeners = new Map<string, (...args: unknown[]) => void>();
    const previousApi = window.electronAPI;
    window.electronAPI = {
      ...previousApi,
      versions: { electron: '39.0.0' },
      async invoke(channel: string, request: { enabled: boolean }) {
        if (channel === WINDOW_CHANNELS.GET_DOCK_LAB) return { enabled: saved };
        if (channel === WINDOW_CHANNELS.SET_DOCK_LAB) {
          if (failSave) throw new Error('Preview save failed');
          saved = request.enabled;
          for (const listener of listeners.values()) listener({ enabled: saved });
          return { enabled: saved };
        }
        return previousApi?.invoke(channel, request);
      },
      on(channel: string, handler: (...args: unknown[]) => void) {
        if (channel !== WINDOW_CHANNELS.DOCK_LAB_CHANGED)
          return previousApi?.on(channel, handler) ?? '';
        const id = `dock-lab-preview-${++sequence}`;
        listeners.set(id, handler);
        return id;
      },
      offById(channel: string, id: string) {
        if (channel === WINDOW_CHANNELS.DOCK_LAB_CHANGED) listeners.delete(id);
        else previousApi?.offById(channel, id);
      },
    } as unknown as typeof window.electronAPI;
    return () => {
      window.electronAPI = previousApi;
    };
  }

  export const preview = definePreview({
    id: 'dock-lab-settings',
    title: 'Notch dock settings',
    defaultState: 'enabled',
    states: {
      enabled: { props: {}, setup: () => setup(true) },
      disabled: { props: {}, setup: () => setup(false) },
      'save-error': { props: {}, setup: () => setup(false, true) },
    },
  });
</script>

<script lang="ts">
  import DockLabSettings from './DockLabSettings.svelte';
  import PauseAnimationsWhenUnfocusedSettings from './PauseAnimationsWhenUnfocusedSettings.svelte';
</script>

<div class="w-full min-w-0 bg-background p-6 text-foreground">
  <div class="overflow-hidden rounded-xl bg-card divide-y divide-border">
    <section data-slot="settings-section-body" class="px-6 py-4">
      <PauseAnimationsWhenUnfocusedSettings />
    </section>
    <DockLabSettings />
  </div>
</div>
