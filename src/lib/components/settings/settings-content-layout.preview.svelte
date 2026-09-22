<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  export const preview = definePreview<{ narrowPane?: boolean }>({
    id: 'settings-content-layout',
    title: 'Settings content layout',
    defaultState: 'default',
    states: {
      default: { props: {} },
      'narrow-pane': { props: { narrowPane: true } },
    },
  });
</script>

<script lang="ts">
  import { onDestroy } from 'svelte';
  import { appClient, type AppSettingChange, type SettingDefinitionWithValue } from '$lib/client';
  import { store as appStore } from '$store/renderer/store';
  import {
    getSettingRequested,
    listSettingsRequested,
    updateSettingsRequested,
  } from '$store/renderer/slices/settings-events/settings-events-slice';
  import AgentBackendSettings from './AgentBackendSettings.svelte';
  import WorkspaceApiSettings from './WorkspaceApiSettings.svelte';

  let { narrowPane = false }: { narrowPane?: boolean } = $props();
  let writes = $state<AppSettingChange[]>([]);
  const definitions: SettingDefinitionWithValue[] = [
    { path: 'agents.maxConcurrent', value: 12, min: 0, max: 200 },
    { path: 'agents.flushQueuedMessages', value: 'all', type: 'enum' },
    { path: 'agents.memoryBudgetMb', value: 4096, min: 0, max: 16384 },
    { path: 'agents.idleReapMinutes', value: 15, defaultValue: 15, min: 0 },
    { path: 'agents.acpNodeMaxOldSpaceMb', value: 8192, min: 1024, max: 65536 },
    { path: 'agents.historyReplayToolContentChars', value: 4000 },
    { path: 'agents.toolPayloadRetentionDays', value: 30 },
    { path: 'workspaceApi.maxOutputChars', value: 100000 },
    { path: 'workspaceApi.toonOutput', value: true, type: 'boolean' },
  ].map((entry) => ({
    label: entry.path,
    description: '',
    category: 'agents',
    type: 'number',
    ...entry,
  })) as SettingDefinitionWithValue[];

  function recordWrites(changes: AppSettingChange[]) {
    for (const change of changes) {
      const previous = writes.at(-1);
      if (previous?.path === change.path && previous.value === change.value) continue;
      writes = [...writes, change];
    }
  }

  // Override the real consumer seam before either child mounts. The fixture never
  // reaches a daemon, and restores the seam when leaving this isolated preview.
  const previous = {
    get: appClient.settings.get,
    list: appClient.settings.list,
    update: appClient.settings.update,
  };
  appClient.settings.get = async (path) => definitions.find((entry) => entry.path === path) ?? null;
  appClient.settings.list = async () => definitions;
  appClient.settings.update = async (changes) => {
    for (const change of changes) {
      const entry = definitions.find((entry) => entry.path === change.path);
      if (entry) entry.value = change.value;
    }
    return changes;
  };
  const originalDispatch = appStore.dispatch;
  Object.defineProperty(appStore, 'dispatch', {
    configurable: true,
    value: (action: Parameters<typeof originalDispatch>[0]) => {
      const result = originalDispatch(action);
      if (action.type === getSettingRequested.type) {
        const request = action as ReturnType<typeof getSettingRequested>;
        const definition = definitions.find((entry) => entry.path === request.payload[0]) ?? null;
        originalDispatch(request.success(definition));
      } else if (action.type === listSettingsRequested.type) {
        const request = action as ReturnType<typeof listSettingsRequested>;
        originalDispatch(request.success(definitions));
      } else if (action.type === updateSettingsRequested.type) {
        const request = action as ReturnType<typeof updateSettingsRequested>;
        const changes = request.payload[0];
        recordWrites(changes);
        for (const change of changes) {
          const entry = definitions.find((entry) => entry.path === change.path);
          if (entry) entry.value = change.value;
        }
        queueMicrotask(() => originalDispatch(request.success(changes)));
      }
      return result;
    },
  });
  onDestroy(() => {
    Object.assign(appClient.settings, previous);
    Object.defineProperty(appStore, 'dispatch', { configurable: true, value: originalDispatch });
  });
</script>

<div
  class="w-full min-w-0 bg-background p-6 text-foreground"
  style:max-width={narrowPane ? '420px' : undefined}
  data-testid="settings-content-layout"
>
  <AgentBackendSettings />
  <WorkspaceApiSettings />
  <output data-testid="settings-writes" class="sr-only">{JSON.stringify(writes)}</output>
</div>
