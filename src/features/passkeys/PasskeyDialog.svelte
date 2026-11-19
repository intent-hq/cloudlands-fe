<!--
  Browser-panel passkey dialog. Drawn by the host app over the webview, so the
  page can neither draw over it nor read it. Every step names the relying
  party that main validated against the frame origin.
-->
<script lang="ts">
  import { faKey, faMobileScreenButton } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { ListRow, ListView } from '$lib/components/patterns/collection';
  import { ContentDialog } from '$lib/components/patterns/confirm';
  import { Button } from '$lib/components/ui/button';
  import { IntentMarkLoader } from '$lib/components/ui/indicators';
  import { Input } from '$lib/components/ui/input';
  import { m } from '$shared/paraglide/messages.js';
  import type {
    PasskeyDialogResponse,
    PasskeyDialogShowPayload,
    PasskeyDialogView,
    PasskeyErrorReason,
    PasskeyTransport,
  } from '$shared/ipc/passkeys';

  type Answer = PasskeyDialogResponse extends infer R
    ? R extends PasskeyDialogResponse
      ? Omit<R, 'ceremonyId'>
      : never
    : never;

  interface Props {
    payload: PasskeyDialogShowPayload | null;
    /** Preview only: render in place without the portal. */
    static?: boolean;
    onRespond: (answer: Answer) => void;
  }

  let { payload, static: staticPosition = false, onRespond }: Props = $props();

  let open = $state(false);
  let pin = $state('');
  let qrDataUrl = $state('');
  const view = $derived<PasskeyDialogView | null>(payload?.view ?? null);

  $effect(() => {
    open = payload !== null;
  });

  $effect(() => {
    if (view?.step !== 'pin') pin = '';
  });

  $effect(() => {
    const data = view?.step === 'qr' ? view.data : '';
    if (!data) {
      qrDataUrl = '';
      return;
    }
    let current = true;
    // eslint-disable-next-line intent/no-component-async-data-fetch -- renders the QR the dialog already holds; nothing is fetched
    void import('qrcode')
      .then(({ default: QRCode }) => QRCode.toDataURL(data, { width: 512, margin: 2 }))
      .then((url) => {
        if (current) qrDataUrl = url;
      });
    return () => {
      current = false;
    };
  });

  const title = $derived(
    payload
      ? payload.kind === 'create'
        ? m.passkeys_dialog_createTitle_label({ site: payload.rpId })
        : m.passkeys_dialog_getTitle_label({ site: payload.rpId })
      : '',
  );

  function errorText(reason: PasskeyErrorReason): string {
    switch (reason) {
      case 'bluetooth-off':
        return m.passkeys_dialog_bluetoothOff_error();
      case 'bluetooth-missing':
        return m.passkeys_dialog_bluetoothMissing_error();
      case 'pin-locked':
        return m.passkeys_dialog_pinLocked_error();
      case 'timeout':
        return m.passkeys_dialog_timeout_error();
      case 'already-registered':
        return m.passkeys_dialog_alreadyRegistered_error();
      case 'unavailable':
        return m.passkeys_dialog_unavailable_error();
      default:
        return m.passkeys_dialog_failed_error();
    }
  }

  const description = $derived.by(() => {
    if (!view || !payload) return undefined;
    switch (view.step) {
      case 'choose-transport':
        return payload.kind === 'create'
          ? m.passkeys_dialog_chooseCreate_description()
          : m.passkeys_dialog_chooseGet_description();
      case 'qr':
      case 'progress':
        switch (view.progress) {
          case 'waiting-for-phone':
            return m.passkeys_dialog_waitingForPhone_description();
          case 'connecting':
            return m.passkeys_dialog_connecting_description();
          case 'waiting-for-approval':
            return m.passkeys_dialog_waitingForApproval_description();
          case 'touch-key':
            return m.passkeys_dialog_touchKey_description();
          case 'processing':
            return m.passkeys_dialog_processing_description();
          default:
            return view.step === 'progress' && view.transport === 'usb'
              ? m.passkeys_dialog_insertKey_description()
              : m.passkeys_dialog_starting_description();
        }
      case 'pin':
        return m.passkeys_dialog_pin_description();
      case 'choose-account':
        return m.passkeys_dialog_chooseAccount_description();
      case 'error':
        return errorText(view.reason);
    }
  });

  const pinError = $derived.by(() => {
    if (view?.step !== 'pin') return undefined;
    if (typeof view.retryAfterMs === 'number') return m.passkeys_dialog_pinRetryAfter_error();
    if (!view.wrongPin) return undefined;
    if (typeof view.attemptsLeft === 'number') {
      return view.attemptsLeft === 1
        ? m.passkeys_dialog_wrongPinAttempts_one({ count: view.attemptsLeft })
        : m.passkeys_dialog_wrongPinAttempts_many({ count: view.attemptsLeft });
    }
    return m.passkeys_dialog_wrongPin_error();
  });

  const transports = $derived.by(() => {
    if (view?.step !== 'choose-transport') return [];
    const hybridNote =
      view.hybrid === 'bluetooth-off'
        ? m.passkeys_dialog_bluetoothOff_description()
        : view.hybrid === 'bluetooth-missing'
          ? m.passkeys_dialog_bluetoothMissing_description()
          : undefined;
    return [
      {
        id: 'hybrid' as PasskeyTransport,
        label: m.passkeys_dialog_phone_label(),
        note: hybridNote,
        icon: faMobileScreenButton,
      },
      {
        id: 'usb' as PasskeyTransport,
        label: m.passkeys_dialog_securityKey_label(),
        note: undefined,
        icon: faKey,
      },
    ];
  });

  function cancel() {
    onRespond({ action: 'cancel' });
  }

  function submitPin(event: SubmitEvent) {
    event.preventDefault();
    if (!pin) return;
    const value = pin;
    pin = '';
    onRespond({ action: 'pin', pin: value });
  }
</script>

{#if payload && view}
  <ContentDialog
    bind:open
    static={staticPosition}
    {title}
    {description}
    size="sm"
    dismissOnInteractOutside={false}
    closeLabel={view.step === 'error'
      ? m.passkeys_dialog_close_label()
      : m.passkeys_dialog_cancel_label()}
    onClose={cancel}
  >
    {#if view.step === 'choose-transport'}
      <ListView
        items={transports}
        getKey={(item) => item.id}
        getText={(item) => item.label}
        ariaLabel={m.passkeys_dialog_transports_ariaLabel()}
        onActivate={(item) => onRespond({ action: 'transport', transport: item.id })}
      >
        {#snippet row({ item })}
          <ListRow>
            {#snippet leading()}<Fa icon={item.icon} fw />{/snippet}
            {#snippet title()}{item.label}{/snippet}
            {#snippet description()}{#if item.note}{item.note}{/if}{/snippet}
          </ListRow>
        {/snippet}
      </ListView>
    {:else if view.step === 'qr'}
      <div class="flex justify-center" data-testid="passkey-qr">
        {#if qrDataUrl}
          <img
            src={qrDataUrl}
            alt={m.passkeys_dialog_qrImage_ariaLabel()}
            class="h-auto w-full max-w-64 rounded-lg"
            width="512"
            height="512"
          />
        {:else}
          <div class="flex aspect-square w-full max-w-64 items-center justify-center">
            <IntentMarkLoader size={20} />
          </div>
        {/if}
      </div>
    {:else if view.step === 'progress'}
      <div class="flex justify-center py-4 text-muted-foreground">
        <IntentMarkLoader size={20} />
      </div>
    {:else if view.step === 'pin'}
      <form id="passkey-pin-form" onsubmit={submitPin}>
        <Input
          bind:value={pin}
          type="password"
          autocomplete="off"
          aria-label={m.passkeys_dialog_pin_label()}
          placeholder={m.passkeys_dialog_pin_label()}
          error={pinError}
          disabled={typeof view.retryAfterMs === 'number'}
          autofocus
        />
      </form>
    {:else if view.step === 'choose-account'}
      <ListView
        items={view.accounts}
        getKey={(account) => account.index}
        getText={(account) => account.userDisplayName || account.userName}
        ariaLabel={m.passkeys_dialog_accounts_ariaLabel()}
        onActivate={(account) => onRespond({ action: 'choose', index: account.index })}
      >
        {#snippet row({ item })}
          <ListRow>
            {#snippet title()}{item.userDisplayName || item.userName}{/snippet}
            {#snippet description()}{#if item.userDisplayName && item.userName}{item.userName}{/if}{/snippet}
          </ListRow>
        {/snippet}
      </ListView>
    {/if}
    {#snippet footer()}
      {#if view.step === 'error'}
        <Button variant="secondary" onclick={cancel}>{m.passkeys_dialog_close_label()}</Button>
      {:else}
        <Button variant="ghost" onclick={cancel}>{m.passkeys_dialog_cancel_label()}</Button>
        {#if view.step === 'pin'}
          <Button
            variant="primary"
            type="submit"
            form="passkey-pin-form"
            disabled={!pin || typeof view.retryAfterMs === 'number'}
          >
            {m.passkeys_dialog_continue_label()}
          </Button>
        {/if}
      {/if}
    {/snippet}
  </ContentDialog>
{/if}
