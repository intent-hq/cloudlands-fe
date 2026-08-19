<script lang="ts">
  /**
   * ConnectBackendModal — add a remote intentd connection (multi-backend connect).
   *
   * Two-step trust-on-first-use flow:
   *   1. `details` — enter host / port / access token, then capture the cert
   *      fingerprint the daemon presents (`captureFingerprintRequested`).
   *   2. `confirm` — show the captured fingerprint; on confirm, store the
   *      connection (`addConnectionRequested`, which encrypts the token in main)
   *      and switch to it (`switchConnectionRequested`).
   *
   * The list/active refresh arrives via the `connections:changed` push handled
   * by the connections service — this modal only drives the add/switch thunks
   * and surfaces inline errors.
   */

  import { Button } from '$lib/components/ui/button';
  import Fa from 'svelte-fa';
  import { faXmark } from '@fortawesome/free-solid-svg-icons';
  import { m } from '$shared/paraglide/messages.js';
  import { store as appStore } from '$store/renderer/store';
  import {
    captureFingerprintRequested,
    addConnectionRequested,
    switchConnectionRequested,
  } from '$store/renderer/slices/connections/connections-slice';

  interface Props {
    open?: boolean;
    /**
     * Prefill for the re-pair flow (token-rejected recovery): the host/port of
     * the connection being re-paired. Applied when the modal opens with empty
     * fields; the user still enters a fresh token. Re-adding the same
     * host:port replaces the stored connection (and its encrypted token).
     */
    prefillHost?: string | null;
    prefillPort?: number | null;
  }

  let { open = $bindable(false), prefillHost = null, prefillPort = null }: Props = $props();

  type Step = 'details' | 'confirm';

  // The WSS default port (`server.wsApi.port`, PROTOCOL §1.1). Prefilled as a
  // sensible default; the field stays editable for operators who reconfigured it.
  const DEFAULT_WS_PORT = '5181';

  let step = $state<Step>('details');
  let host = $state('');
  let port = $state(DEFAULT_WS_PORT);
  let token = $state('');
  let detectHosts = $state(true);
  let fingerprint = $state('');
  let busy = $state(false);
  let error = $state<string | null>(null);
  let firstInput: HTMLInputElement | null = $state(null);

  const portNumber = $derived(Number(port.trim()));
  const canSubmitDetails = $derived(
    host.trim().length > 0 &&
      Number.isInteger(portNumber) &&
      portNumber > 0 &&
      portNumber <= 65535 &&
      token.trim().length > 0 &&
      !busy,
  );

  function reset() {
    step = 'details';
    host = '';
    port = DEFAULT_WS_PORT;
    token = '';
    detectHosts = true;
    fingerprint = '';
    busy = false;
    error = null;
  }

  function close() {
    open = false;
    reset();
  }

  function toMessage(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
  }

  async function handleCapture() {
    if (!canSubmitDetails) return;
    busy = true;
    error = null;
    try {
      const action = captureFingerprintRequested({
        host: host.trim(),
        port: portNumber,
        token: token.trim(),
      });
      appStore.dispatch(action);
      const result = await action.promise;
      if (!result.tokenValid) {
        // The daemon rejected the token on the capture upgrade (PROTOCOL §2.1:
        // 401 bad token, 403 WS API disabled) — stay on the details step so the
        // user can correct it instead of storing a connection that cannot auth.
        error =
          result.statusCode === 403
            ? m.modals_connect_wsApiDisabled_error()
            : m.modals_connect_tokenRejected_error();
        return;
      }
      fingerprint = result.fingerprint;
      step = 'confirm';
    } catch (e) {
      error = toMessage(e);
    } finally {
      busy = false;
    }
  }

  async function handleConfirm() {
    busy = true;
    error = null;
    const trimmedHost = host.trim();
    try {
      const addAction = addConnectionRequested({
        label: `${trimmedHost}:${portNumber}`,
        host: trimmedHost,
        port: portNumber,
        fingerprint,
        token: token.trim(),
        detectHosts,
      });
      appStore.dispatch(addAction);
      const { connection, switched } = await addAction.promise;
      // An active re-pair already rebuilt the live client inside the add
      // (switched: true) — dispatching another switch would tear it down and
      // reconnect a second time for nothing.
      if (!switched) {
        const switchAction = switchConnectionRequested(connection.id);
        appStore.dispatch(switchAction);
        await switchAction.promise;
      }
      close();
    } catch (e) {
      error = toMessage(e);
      busy = false;
    }
  }

  function back() {
    step = 'details';
    error = null;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    } else {
      e.stopPropagation();
    }
  }

  const inputClass =
    'w-full px-3 py-2 bg-background border border-border rounded text-foreground text-sm focus:outline-none focus:border-primary';

  // Focus the first field when the modal opens.
  $effect(() => {
    if (open && step === 'details' && firstInput) {
      const el = firstInput;
      requestAnimationFrame(() => el.focus());
    }
  });

  // Apply the re-pair prefill only on the closed→open transition (reset()
  // empties the fields on close, so a reopen re-applies the current prefill).
  // Gating on the transition — not on `open && host === ''` — keeps the fields
  // freely editable while the modal is open: re-running on every keystroke
  // would snap a cleared Host back to the prefill.
  let wasOpen = false;
  $effect(() => {
    const justOpened = open && !wasOpen;
    wasOpen = open;
    if (justOpened) {
      if (prefillHost && host === '') host = prefillHost;
      if (prefillPort != null && port === DEFAULT_WS_PORT) port = String(prefillPort);
    }
  });
</script>

{#if open}
  <div
    class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
    role="presentation"
    onclick={close}
    onkeydown={handleKeydown}
  >
    <div
      class="bg-background border border-border rounded-lg shadow-lg w-full max-w-md overflow-hidden flex flex-col"
      onclick={(e) => e.stopPropagation()}
      onkeydown={handleKeydown}
      role="dialog"
      aria-modal="true"
      aria-labelledby="connect-modal-title"
      tabindex="-1"
    >
      <!-- Header -->
      <div class="px-6 py-4 border-b border-border flex items-center justify-between">
        <h2 id="connect-modal-title" class="text-lg font-semibold">{m.modals_connect_title()}</h2>
        <Button
          variant="ghost"
          size="icon"
          onclick={close}
          aria-label={m.modals_connect_close_ariaLabel()}
        >
          <Fa icon={faXmark} />
        </Button>
      </div>

      <!-- Content -->
      <div class="p-6 space-y-4">
        {#if step === 'details'}
          <p class="text-sm text-subtle">{m.modals_connect_details_description()}</p>

          <div class="space-y-1">
            <label class="text-xs text-subtle" for="connect-host"
              >{m.modals_connect_host_label()}</label
            >
            <input
              id="connect-host"
              bind:this={firstInput}
              bind:value={host}
              type="text"
              placeholder={m.modals_connect_host_placeholder()}
              class={inputClass}
              autocorrect="off"
              autocapitalize="off"
              spellcheck="false"
            />
          </div>

          <div class="space-y-1">
            <label class="text-xs text-subtle" for="connect-port"
              >{m.modals_connect_port_label()}</label
            >
            <input
              id="connect-port"
              bind:value={port}
              type="text"
              inputmode="numeric"
              placeholder={m.modals_connect_port_placeholder()}
              class={inputClass}
              autocorrect="off"
              autocapitalize="off"
              spellcheck="false"
            />
          </div>

          <div class="space-y-1">
            <label class="text-xs text-subtle" for="connect-token"
              >{m.modals_connect_token_label()}</label
            >
            <input
              id="connect-token"
              bind:value={token}
              type="password"
              placeholder={m.modals_connect_token_placeholder()}
              class={inputClass}
              autocorrect="off"
              autocapitalize="off"
              spellcheck="false"
            />
          </div>

          <div class="space-y-1">
            <label class="flex items-center gap-2 text-sm">
              <input type="checkbox" bind:checked={detectHosts} />
              {m.modals_connect_detectHosts_label()}
            </label>
            <p class="text-xs text-subtle">{m.modals_connect_detectHosts_description()}</p>
          </div>

          <p class="text-xs text-subtle">{m.modals_connect_whereToFind_help()}</p>
        {:else}
          <p class="text-sm text-subtle">{m.modals_connect_confirmStep_description()}</p>
          <div class="space-y-1">
            <span class="text-xs text-subtle">{m.modals_connect_fingerprint_label()}</span>
            <!-- i18n-ignore (cert fingerprint hex, not translatable copy) -->
            <p class="font-mono text-xs break-all bg-muted/50 rounded p-2">{fingerprint}</p>
          </div>
        {/if}

        {#if error}
          <p class="text-xs text-error-foreground">{error}</p>
        {/if}
      </div>

      <!-- Footer -->
      <div class="px-6 py-4 border-t border-border flex justify-end gap-2">
        {#if step === 'details'}
          <Button variant="ghost" onclick={close}>{m.modals_connect_cancel_label()}</Button>
          <Button variant="default" onclick={handleCapture} disabled={!canSubmitDetails}>
            {busy ? m.modals_connect_connecting_label() : m.modals_connect_continue_label()}
          </Button>
        {:else}
          <Button variant="ghost" onclick={back} disabled={busy}
            >{m.modals_connect_back_label()}</Button
          >
          <Button variant="default" onclick={handleConfirm} disabled={busy}>
            {busy ? m.modals_connect_connecting_label() : m.modals_connect_confirm_label()}
          </Button>
        {/if}
      </div>
    </div>
  </div>
{/if}
