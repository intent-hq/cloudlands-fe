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
  import type { AppSettingChange, SettingDefinitionWithValue } from '$lib/client';
  import { Button } from '$lib/components/patterns/settings/custom-controls';
  import GitWorkspaceSettings from './GitWorkspaceSettings.svelte';
  import RtkSettings from './RtkSettings.svelte';
  import { store as appStore } from '$store/renderer/store';
  import {
    getSystemCapabilitiesRequested,
    listSettingsRequested,
    updateSettingsRequested,
  } from '$store/renderer/slices/settings-events/settings-events-slice';
  import {
    rtkRequirementResolved,
    rtkSettingLoaded,
    rtkSettingLoadFailed,
    rtkUpdateStarted,
    rtkUpdateSucceeded,
    updateRtkEnabledRequested,
  } from '$store/renderer/slices/host-requirements/host-requirements-slice';
  import { m } from '$shared/paraglide/messages.js';

  let { scenario = 'ready' }: { scenario?: Scenario } = $props();
  const initial = untrack(() => scenario);
  let settingsPending = $state(initial === 'loading-settings');
  let probePending = $state(initial === 'loading-probe');
  let writes = $state<AppSettingChange[]>([]);
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

  const originalDispatch = appStore.dispatch;
  Object.defineProperty(appStore, 'dispatch', {
    configurable: true,
    value: (action: Parameters<typeof originalDispatch>[0]) => {
      const result = originalDispatch(action);
      if (action.type === listSettingsRequested.type) {
        originalDispatch((action as ReturnType<typeof listSettingsRequested>).success(definitions));
      } else if (action.type === getSystemCapabilitiesRequested.type) {
        originalDispatch(
          (action as ReturnType<typeof getSystemCapabilitiesRequested>).success({
            cowSupported: true,
          }),
        );
      } else if (action.type === updateSettingsRequested.type) {
        const request = action as ReturnType<typeof updateSettingsRequested>;
        const changes = request.payload[0];
        writes = [...writes, ...changes];
        originalDispatch(request.success(changes));
      } else if (action.type === updateRtkEnabledRequested.type) {
        const enabled = (action as ReturnType<typeof updateRtkEnabledRequested>).payload[0];
        writes = [...writes, { path: 'rtk.enabled', value: enabled }];
        originalDispatch(rtkUpdateStarted());
        originalDispatch(rtkUpdateSucceeded(enabled));
      }
      return result;
    },
  });

  if (initial !== 'loading-settings') {
    appStore.dispatch(
      initial === 'load-error'
        ? rtkSettingLoadFailed(m.settings_rtk_loadError())
        : rtkSettingLoaded(true),
    );
  }
  if (initial !== 'loading-probe') {
    appStore.dispatch(rtkRequirementResolved(initial !== 'unavailable'));
  }

  onDestroy(() => {
    Object.defineProperty(appStore, 'dispatch', { configurable: true, value: originalDispatch });
  });
</script>

<div class="w-full min-w-0 bg-background p-6 text-foreground" data-testid="rtk-shell-settings">
  {#if settingsPending}
    <Button
      onclick={() => {
        settingsPending = false;
        appStore.dispatch(rtkSettingLoaded(true));
      }}>Resolve settings</Button
    >
  {/if}
  {#if probePending}
    <Button
      onclick={() => {
        probePending = false;
        appStore.dispatch(rtkRequirementResolved(true));
      }}>Resolve availability</Button
    >
  {/if}
  <GitWorkspaceSettings>
    {#snippet shellAdditions()}<RtkSettings />{/snippet}
  </GitWorkspaceSettings>
  <output data-testid="settings-writes" class="sr-only">{JSON.stringify(writes)}</output>
</div>
