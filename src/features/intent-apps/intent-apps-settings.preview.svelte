<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  export const preview = definePreview({
    id: 'intent-apps-settings',
    title: 'Intent apps library',
    defaultState: 'library',
    states: {
      library: { props: { scene: 'library' } },
      empty: { props: { scene: 'empty' } },
      unsupported: { props: { scene: 'unsupported' } },
      approve: { props: { scene: 'approve' } },
      install: { props: { scene: 'install' } },
    },
  });
</script>

<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { store as appStore } from '$store/renderer/store';
  import type { IntentApp } from '$shared/intent-apps/intent-apps-types';
  import {
    intentAppIconReceived,
    intentAppPackageChecked,
    intentAppPackageDismissed,
    intentAppsStateReceived,
  } from '$store/renderer/slices/intent-apps/intent-apps-slice';
  import IntentAppsSettings from './IntentAppsSettings.svelte';
  import IntentAppApproveDialog from './IntentAppApproveDialog.svelte';

  let { scene }: { scene: 'library' | 'empty' | 'unsupported' | 'approve' | 'install' } = $props();

  // A 1×1 PNG tile, so the icon slot shows a real image next to a letter tile.
  const ICON =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  const base: IntentApp = {
    id: 'pomodoro-timer',
    name: 'Pomodoro Timer',
    version: '1.2.0',
    description: 'A focus timer that asks a model for a short break idea.',
    icon: 'icon.png',
    entry: 'index.html',
    bundleHash: 'sha256:9f2c4b1e8d7a6c5b4a3928170f6e5d4c3b2a1908f7e6d5c4b3a2918070f6e5d4',
    fileCount: 4,
    sizeBytes: 18234,
    permissions: { level: 2, features: ['models', 'notifications'] },
    window: {
      width: 960,
      height: 640,
      minWidth: null,
      minHeight: null,
      resizable: true,
      alwaysOnTop: false,
    },
    approval: {
      status: 'approved',
      level: 2,
      features: ['models', 'notifications'],
      bundleHash: 'sha256:9f2c4b1e8d7a6c5b4a3928170f6e5d4c3b2a1908f7e6d5c4b3a2918070f6e5d4',
      approvedAt: '2026-11-26T12:00:00.000Z',
    },
    source: { workspaceId: 'ws-1', path: 'apps/pomodoro' },
    publisher: { name: 'Focus Tools', url: 'https://focus.example', keyId: null, verified: false },
    updateUrl: null,
    signature: {
      sigVersion: 1,
      algorithm: 'ed25519',
      keyId: 'focus-tools-1',
      bundleHash: 'sha256:9f2c4b1e8d7a6c5b4a3928170f6e5d4c3b2a1908f7e6d5c4b3a2918070f6e5d4',
      signature: 'c2lnbmF0dXJl',
      status: 'unverified',
      verified: false,
    },
    installedAt: '2026-11-26T11:59:00.000Z',
    updatedAt: '2026-11-26T12:00:00.000Z',
    open: true,
  };
  const pending: IntentApp = {
    ...base,
    id: 'reading-list',
    publisher: null,
    signature: null,
    name: 'Reading List',
    version: '0.1.0',
    icon: null,
    description: null,
    permissions: { level: 1, features: [] },
    bundleHash: 'sha256:1a2b',
    approval: { status: 'pending', level: null, features: [], bundleHash: null, approvedAt: null },
    open: false,
  };
  const revoked: IntentApp = {
    ...base,
    id: 'standup-notes',
    name: 'Standup Notes',
    version: '2.0.1',
    icon: null,
    bundleHash: 'sha256:3c4d',
    approval: { ...base.approval, status: 'revoked', bundleHash: 'sha256:3c4d' },
    open: false,
  };

  const apps = scene === 'empty' || scene === 'unsupported' ? [] : [base, pending, revoked];
  appStore.dispatch(
    intentAppsStateReceived({
      labEnabled: true,
      supported: scene !== 'unsupported',
      packages: true,
      apps,
      openAppIds: scene === 'library' ? [base.id] : [],
      error: null,
    }),
  );
  appStore.dispatch(intentAppIconReceived(`${base.id}@${base.bundleHash}`, ICON));
  // A checked package: the install review over the library. It replaces the installed copy.
  onMount(() => {
    if (scene !== 'install') return;
    appStore.dispatch(
      intentAppPackageChecked({
        uploadId: 'upload-preview',
        replace: true,
        preview: {
          app: { ...base, version: '1.3.0', open: false },
          replaced: true,
          approvalReset: true,
          dryRun: true,
        },
      }),
    );
  });

  onDestroy(() => {
    appStore.dispatch(intentAppPackageDismissed(null));
    appStore.dispatch(
      intentAppsStateReceived({
        labEnabled: false,
        supported: false,
        packages: false,
        apps: [],
        openAppIds: [],
        error: null,
      }),
    );
  });
</script>

<div class="mx-auto flex w-full max-w-4xl flex-col gap-6 bg-background px-6 py-6">
  {#if scene === 'approve'}
    <IntentAppApproveDialog app={base} open={true} onClose={() => {}} />
  {:else}
    <IntentAppsSettings />
  {/if}
</div>
