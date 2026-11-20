<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  export const preview = definePreview({
    id: 'passkey-dialog',
    title: 'Passkey dialog',
    defaultState: 'choose',
    states: {
      choose: { props: { state: 'choose' } },
      'choose-bluetooth-off': { props: { state: 'choose-bluetooth-off' } },
      qr: { props: { state: 'qr' } },
      connecting: { props: { state: 'connecting' } },
      'touch-key': { props: { state: 'touch-key' } },
      pin: { props: { state: 'pin' } },
      'pin-wrong': { props: { state: 'pin-wrong' } },
      accounts: { props: { state: 'accounts' } },
      'error-bluetooth': { props: { state: 'error-bluetooth' } },
      'error-pin-locked': { props: { state: 'error-pin-locked' } },
      'error-timeout': { props: { state: 'error-timeout' } },
      'long-site': { props: { state: 'long-site' } },
      'device-choose': { props: { state: 'device-choose' } },
      'device-pin-first': { props: { state: 'device-pin-first' } },
      'device-pin-wrong': { props: { state: 'device-pin-wrong' } },
      'device-pin-wait': { props: { state: 'device-pin-wait' } },
      'device-old-pin': { props: { state: 'device-old-pin' } },
      'device-error-locked': { props: { state: 'device-error-locked' } },
      'device-error-no-passkey': { props: { state: 'device-error-no-passkey' } },
    },
  });
</script>

<script lang="ts">
  import type { PasskeyDialogShowPayload, PasskeyDialogView } from '$shared/ipc/passkeys';
  import PasskeyDialog from './PasskeyDialog.svelte';

  let { state = 'choose' }: { state?: string } = $props();

  const QR =
    'FIDO:/0254318383060211613109441373020698459146720480516043066215811040356170401283418152230014231302134650211510104221070224010201';

  const views: Record<string, PasskeyDialogView> = {
    choose: { step: 'choose-transport', hybrid: 'available', device: false },
    'choose-bluetooth-off': { step: 'choose-transport', hybrid: 'bluetooth-off', device: false },
    qr: { step: 'qr', data: QR, progress: 'waiting-for-phone' },
    connecting: { step: 'progress', transport: 'hybrid', progress: 'connecting' },
    'touch-key': { step: 'progress', transport: 'usb', progress: 'touch-key' },
    pin: { step: 'pin', kind: 'usb', wrongPin: false },
    'pin-wrong': { step: 'pin', kind: 'usb', wrongPin: true, attemptsLeft: 3 },
    accounts: {
      step: 'choose-account',
      accounts: [
        { index: 0, userName: 'ada@example.com', userDisplayName: 'Ada Lovelace' },
        { index: 1, userName: 'grace@example.com', userDisplayName: 'Grace Hopper' },
      ],
    },
    'error-bluetooth': { step: 'error', reason: 'bluetooth-off' },
    'error-pin-locked': { step: 'error', reason: 'pin-locked' },
    'error-timeout': { step: 'error', reason: 'timeout' },
    'long-site': { step: 'choose-transport', hybrid: 'bluetooth-missing', device: false },
    'device-choose': { step: 'choose-transport', hybrid: 'available', device: true },
    'device-pin-first': {
      step: 'pin',
      kind: 'device',
      wrongPin: false,
      attemptsLeft: 10,
      firstPasskey: true,
    },
    'device-pin-wrong': { step: 'pin', kind: 'device', wrongPin: true, attemptsLeft: 4 },
    'device-pin-wait': {
      step: 'pin',
      kind: 'device',
      wrongPin: true,
      attemptsLeft: 5,
      retryAfterMs: 30_000,
    },
    'device-old-pin': {
      step: 'pin',
      kind: 'device',
      wrongPin: false,
      attemptsLeft: 9,
      oldPin: true,
    },
    'device-error-locked': { step: 'error', reason: 'device-locked' },
    'device-error-no-passkey': { step: 'error', reason: 'device-no-passkey' },
  };

  const CREATE_STATES = new Set(['qr', 'pin', 'device-choose', 'device-pin-first']);

  const payload = $derived<PasskeyDialogShowPayload>({
    ceremonyId: 'preview',
    kind: CREATE_STATES.has(state) ? 'create' : 'get',
    rpId:
      state === 'long-site'
        ? 'accounts.a-very-long-relying-party-name-for-narrow-layouts.example.co.uk'
        : 'webauthn.io',
    view: views[state] ?? views.choose,
  });
</script>

<div class="min-h-[560px] w-full bg-background" data-testid="passkey-dialog-preview">
  <PasskeyDialog {payload} static onRespond={() => {}} />
</div>
