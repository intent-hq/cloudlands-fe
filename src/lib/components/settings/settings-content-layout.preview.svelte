<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import { setupSettingsFormPreview } from '../../../test/api-rtk-settings-preview';

  export const preview = definePreview<{ narrowPane?: boolean }>({
    id: 'settings-content-layout',
    title: 'Settings content layout',
    defaultState: 'default',
    states: {
      default: { props: {}, setup: setupSettingsFormPreview },
      'narrow-pane': { props: { narrowPane: true }, setup: setupSettingsFormPreview },
    },
  });
</script>

<script lang="ts">
  import { onDestroy } from 'svelte';
  import { appClient, type AppSettingChange, type SettingDefinitionWithValue } from '$lib/client';
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
    writes = [...writes, ...changes];
    for (const change of changes) {
      const entry = definitions.find((entry) => entry.path === change.path);
      if (entry) entry.value = change.value;
    }
    return changes;
  };
  onDestroy(() => Object.assign(appClient.settings, previous));
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
