<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  export const preview = definePreview({
    id: 'device-passkeys-settings',
    title: 'Settings → Passkeys',
    defaultState: 'list',
    states: {
      list: { props: { state: 'list' } },
      empty: { props: { state: 'empty' } },
      loading: { props: { state: 'loading' } },
      error: { props: { state: 'error' } },
      deleting: { props: { state: 'deleting' } },
      'delete-failed': { props: { state: 'delete-failed' } },
      confirm: { props: { state: 'confirm' } },
      'long-names': { props: { state: 'long-names' } },
    },
  });
</script>

<script lang="ts">
  import type { PasskeyDeviceCredential } from '$shared/ipc/passkeys';
  import type { DevicePasskeysState } from '$store/renderer/slices/device-passkeys/device-passkeys-slice';
  import DevicePasskeysSettings from './DevicePasskeysSettings.svelte';

  let { state = 'list' }: { state?: string } = $props();

  const CREATED = Date.UTC(2026, 10, 2, 9, 30);
  const USED = Date.UTC(2026, 10, 18, 16, 5);
  const credentials: PasskeyDeviceCredential[] = [
    {
      credentialId: 'Y3JlZC1naXRodWI',
      rpId: 'github.com',
      userName: 'ada',
      userDisplayName: 'Ada Lovelace',
      createdAt: CREATED,
      lastUsedAt: USED,
    },
    {
      credentialId: 'Y3JlZC13ZWJhdXRobg',
      rpId: 'webauthn.io',
      userName: 'ada@example.com',
      userDisplayName: 'Ada Lovelace',
      createdAt: USED,
      lastUsedAt: null,
    },
  ];
  const long: PasskeyDeviceCredential = {
    credentialId: 'Y3JlZC1sb25n',
    rpId: 'accounts.a-very-long-relying-party-name-for-narrow-layouts.example.co.uk',
    userName: 'a.very.long.user.name.that.does.not.fit@subdomain.example.co.uk',
    userDisplayName: 'Ada',
    createdAt: CREATED,
    lastUsedAt: USED,
  };

  const base: DevicePasskeysState = {
    status: 'ready',
    credentials,
    deletingIds: [],
    deleteFailedId: null,
  };
  const states: Record<string, DevicePasskeysState> = {
    list: base,
    empty: { ...base, credentials: [] },
    loading: { ...base, status: 'loading', credentials: [] },
    error: { ...base, status: 'error', credentials: [] },
    deleting: { ...base, deletingIds: [credentials[0].credentialId] },
    'delete-failed': { ...base, deleteFailedId: credentials[0].credentialId },
    confirm: base,
    'long-names': { ...base, credentials: [long, ...credentials] },
  };
</script>

<div class="min-h-[480px] w-full max-w-4xl bg-background p-6">
  <DevicePasskeysSettings
    state={states[state] ?? base}
    staticConfirmId={state === 'confirm' ? credentials[0].credentialId : undefined}
    onRetry={() => {}}
    onDelete={() => {}}
  />
</div>
