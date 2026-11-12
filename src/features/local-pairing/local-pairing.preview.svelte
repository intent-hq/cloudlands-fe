<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  export const LOCAL_PAIRING_PREVIEW_STATES = [
    'idle',
    'creating',
    'confirm-listener',
    'enabling-listener',
    'active',
    'active-few-tries',
    'cancel-failed',
    'connected',
    'expired',
    'locked',
    'cancelled',
    'replaced',
    'create-failed',
    'listener-failed',
    'intents-empty',
    'intents-removing',
    'intents-remove-failed',
    'intents-load-failed',
  ] as const;
  export type LocalPairingPreviewState = (typeof LOCAL_PAIRING_PREVIEW_STATES)[number];

  export const preview = definePreview<{ state: LocalPairingPreviewState }>({
    id: 'local-pairing',
    title: 'Let another Intent on this computer connect',
    defaultState: 'active',
    states: Object.fromEntries(
      LOCAL_PAIRING_PREVIEW_STATES.map((state) => [state, { props: { state } }]),
    ),
    captureReadiness: { selector: '[data-testid="local-pairing-panel"]' },
  });
</script>

<script lang="ts">
  import { catalogNow } from '$lib/component-catalog/catalog-clock';
  import LocalPairingCodePanel from './LocalPairingCodePanel.svelte';
  import LocalIntentsList from './LocalIntentsList.svelte';
  import type { CodePanelView } from './local-pairing-model';
  import type { LocalPairingCredential } from './local-pairing-types';

  let { state = 'active' }: { state?: LocalPairingPreviewState } = $props();

  const now = catalogNow();
  const minutesAgo = (minutes: number) => new Date(now - minutes * 60_000).toISOString();
  const active = (attemptsRemaining: number, cancelFailed = false): CodePanelView => ({
    kind: 'active',
    codeId: 'code-1',
    remainingMs: 9 * 60_000 + 42_000,
    attemptsRemaining,
    cancelFailed,
  });
  const views: Record<LocalPairingPreviewState, CodePanelView> = {
    idle: { kind: 'closed' },
    creating: { kind: 'creating' },
    'confirm-listener': { kind: 'confirm-listener' },
    'enabling-listener': { kind: 'enabling-listener' },
    active: active(5),
    'active-few-tries': active(2),
    'cancel-failed': active(5, true),
    connected: { kind: 'connected', appName: 'Intent Alpha' },
    expired: { kind: 'expired' },
    locked: { kind: 'locked' },
    cancelled: { kind: 'cancelled', reason: 'user' },
    replaced: { kind: 'cancelled', reason: 'replaced' },
    'create-failed': { kind: 'failed', failure: 'create-failed' },
    'listener-failed': { kind: 'failed', failure: 'listener-failed' },
    'intents-empty': { kind: 'closed' },
    'intents-removing': { kind: 'closed' },
    'intents-remove-failed': { kind: 'closed' },
    'intents-load-failed': { kind: 'closed' },
  };
  const credentials: LocalPairingCredential[] = [
    {
      credentialId: 'cred-alpha',
      appName: 'Intent Alpha',
      createdAt: minutesAgo(60 * 24),
      lastUsedAt: minutesAgo(2),
      connected: true,
    },
    {
      credentialId: 'cred-dev',
      appName: 'Intent (dev build)',
      createdAt: minutesAgo(60),
      lastUsedAt: null,
      connected: false,
    },
  ];
  const listCredentials = $derived(
    state === 'intents-empty' ? [] : state === 'intents-load-failed' ? null : credentials,
  );
  const removing = $derived<Record<string, true>>(
    state === 'intents-removing' ? { 'cred-dev': true } : {},
  );
  const removeFailed = $derived<Record<string, true>>(
    state === 'intents-remove-failed' ? { 'cred-dev': true } : {},
  );
  const noop = () => {};
</script>

<div class="w-full min-w-0 space-y-5 bg-background p-6 text-foreground">
  <LocalPairingCodePanel
    view={views[state]}
    codeText="KTP-82M"
    onShow={noop}
    onConfirmListener={noop}
    onCancel={noop}
    onClose={noop}
  />
  <LocalIntentsList
    credentials={listCredentials}
    {removing}
    {removeFailed}
    now={new Date(now)}
    onRemove={noop}
    onDismissFailure={noop}
  />
</div>
