<script lang="ts">
  import { onMount } from 'svelte';
  import { runSaga, stdChannel } from 'redux-saga';
  import PasskeyDialogHost from '../../../src/features/passkeys/PasskeyDialogHost.svelte';
  import DevicePasskeysSettings from '../../../src/features/passkeys/DevicePasskeysSettings.svelte';
  import {
    devicePasskeyDeleteRequested,
    devicePasskeysReducer,
    devicePasskeysRequested,
    initialState,
  } from '../../../src/store/renderer/slices/device-passkeys/device-passkeys-slice';
  import { devicePasskeysSaga } from '../../../src/store/renderer/slices/device-passkeys/sagas/device-passkeys-saga';

  const guest = new URL(location.href).searchParams.get('guest') ?? 'about:blank';

  // The real slice and saga on a minimal store, so Settings → Passkeys runs
  // the same IPC path as the app without booting the whole renderer store.
  let passkeys = $state(initialState);
  let settingsOpen = $state(false);
  const channel = stdChannel();
  const dispatch = (action: Parameters<typeof devicePasskeysReducer>[1]) => {
    passkeys = devicePasskeysReducer(passkeys, action);
    channel.put(action as never);
  };

  onMount(() => {
    const task = runSaga({ channel, dispatch, getState: () => passkeys }, devicePasskeysSaga);
    Object.assign(window, {
      passkeyFixture: true,
      passkeySettings: {
        open() {
          settingsOpen = true;
          dispatch(devicePasskeysRequested());
        },
        close() {
          settingsOpen = false;
        },
        status: () => passkeys.status,
      },
    });
    return () => task.cancel();
  });
</script>

<div class="h-screen w-screen bg-background text-foreground">
  <webview src={guest} partition="persist:browser-panel" class="block h-full w-full"></webview>
  {#if settingsOpen}
    <div
      class="absolute inset-0 overflow-auto bg-background p-6"
      data-testid="passkey-settings-panel"
    >
      <div class="mx-auto max-w-3xl">
        <DevicePasskeysSettings
          state={passkeys}
          onRetry={() => dispatch(devicePasskeysRequested())}
          onDelete={(credentialId) => dispatch(devicePasskeyDeleteRequested(credentialId))}
        />
      </div>
    </div>
  {/if}
  <PasskeyDialogHost />
</div>
