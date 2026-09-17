<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  type Scenario = 'ready' | 'loading-settings' | 'loading-probe' | 'unavailable' | 'load-error';
  export const preview = definePreview<{ scenario?: Scenario }>({
    id: 'rtk-shell-settings',
    title: 'RTK and Shell settings',
    defaultState: 'ready',
    states: {
      ready: { props: { scenario: 'ready' } },
      'loading-settings': { props: { scenario: 'loading-settings' } },
      'loading-probe': { props: { scenario: 'loading-probe' } },
      unavailable: { props: { scenario: 'unavailable' } },
      'load-error': { props: { scenario: 'load-error' } },
    },
  });
</script>

<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { appClient, type AppSettingChange, type SettingDefinitionWithValue } from '$lib/client';
  import { SYSTEM_CHANNELS } from '$shared/ipc/channels';
  import { overrideMockIpcHandler } from '$shared/ipc-mock-router';
  import { Button } from '$lib/components/patterns/settings/custom-controls';
  import GitWorkspaceSettings from './GitWorkspaceSettings.svelte';
  import RtkSettings from './RtkSettings.svelte';

  let { scenario = 'ready' }: { scenario?: Scenario } = $props();
  const initial = untrack(() => scenario);
  let settingsPending = $state(initial === 'loading-settings');
  let probePending = $state(initial === 'loading-probe');
  let writes = $state<AppSettingChange[]>([]);
  let releaseSettings!: () => void;
  let releaseProbe!: () => void;
  const settingsGate = new Promise<void>((resolve) => (releaseSettings = resolve));
  const probeGate = new Promise<void>((resolve) => (releaseProbe = resolve));
  const definitions: SettingDefinitionWithValue[] = [
    { path: 'workspace.worktreesLocation', value: '', type: 'string' },
    { path: 'workspace.sshKeyPath', value: '', type: 'string' },
    { path: 'workspace.defaultShell', value: 'auto', type: 'string' },
    { path: 'workspace.branchPrefix', value: '', type: 'string' },
    { path: 'git.autoCommit', value: true, type: 'boolean' },
    { path: 'workspace.cowIsolation', value: false, type: 'boolean' },
    { path: 'rtk.enabled', value: true, type: 'boolean' },
  ].map((entry) => ({
    label: entry.path,
    description: '',
    category: 'workspace',
    ...entry,
  })) as SettingDefinitionWithValue[];

  const previous = {
    get: appClient.settings.get,
    list: appClient.settings.list,
    update: appClient.settings.update,
  };
  const previousCapabilities = appClient.system.capabilities;
  appClient.settings.list = async () => definitions;
  appClient.settings.get = async (path) => {
    if (initial === 'loading-settings') await settingsGate;
    return initial === 'load-error'
      ? null
      : (definitions.find((entry) => entry.path === path) ?? null);
  };
  appClient.settings.update = async (changes) => {
    writes = [...writes, ...changes];
    return changes;
  };
  appClient.system.capabilities = async () => ({ cowSupported: true });
  // eslint-disable-next-line intent/no-component-async-data-fetch -- Registers a synthetic in-memory handler; never fetches domain data.
  const restoreProbe = overrideMockIpcHandler(SYSTEM_CHANNELS.CHECK_RTK, async () => {
    if (initial === 'loading-probe') await probeGate;
    return { success: true, data: { available: initial !== 'unavailable' } };
  });
  onDestroy(() => {
    releaseSettings();
    releaseProbe();
    Object.assign(appClient.settings, previous);
    appClient.system.capabilities = previousCapabilities;
    restoreProbe();
  });
</script>

<div class="w-full min-w-0 bg-background p-6 text-foreground" data-testid="rtk-shell-settings">
  {#if settingsPending}
    <Button
      onclick={() => {
        settingsPending = false;
        releaseSettings();
      }}>Resolve settings</Button
    >
  {/if}
  {#if probePending}
    <Button
      onclick={() => {
        probePending = false;
        releaseProbe();
      }}>Resolve availability</Button
    >
  {/if}
  <GitWorkspaceSettings>
    {#snippet shellAdditions()}<RtkSettings />{/snippet}
  </GitWorkspaceSettings>
  <output data-testid="settings-writes" class="sr-only">{JSON.stringify(writes)}</output>
</div>
