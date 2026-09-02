<script lang="ts">
  /**
   * ConnectBackendModal — add a remote intentd connection (multi-backend connect).
   *
   * Two-step trust-on-first-use flow:
   *   1. `details` — enter host / port / access token, then capture the cert
   *      fingerprint the daemon presents (`captureFingerprintRequested`).
   *   2. `confirm` — show the captured fingerprint; on confirm, store the
   *      connection (`addConnectionRequested`, which encrypts the token in main)
   *      and open a window for it (`openConnectionRequested`).
   *
   * On macOS a "Save to iCloud" checkbox (default checked) controls whether the
   * stored record syncs via iCloud Keychain. Unchecking adds the connection with
   * `syncExcluded: true` (local-only). Keeping it checked while keychain sync is
   * explicitly disabled inserts a `syncConfirm` step before the add: confirming
   * adds the backend first, then enables machine-global sync
   * (`setKeychainSyncEnabledRequested`) — so a failed add leaves no
   * machine-global side effect; declining still adds, just excluded from sync.
   * The step keeps a Back button so a failing add can be corrected on the
   * details step without losing entered values.
   *
   * The list/active refresh arrives via the `connections:changed` push handled
   * by the connections service — this modal only drives the add/open actions
   * and surfaces inline errors.
   */

  import { Button } from '$lib/components/ui/button';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import Fa from 'svelte-fa';
  import { faXmark } from '@fortawesome/free-solid-svg-icons';
  import { m } from '$shared/paraglide/messages.js';
  import { openExternalUrl } from '$lib/utils/open-external';
  import { store as appStore } from '$store/renderer/store';
  import {
    captureFingerprintRequested,
    addConnectionRequested,
    openConnectionRequested,
    loadKeychainSyncStateRequested,
    setKeychainSyncEnabledRequested,
  } from '$store/renderer/slices/connections/connections-slice';
  import { selectKeychainSyncState } from '$store/renderer/slices/connections/connections-selectors';
  import { DEFAULT_CONNECTION_ACCENT, type ConnectionAccent } from '$shared/types/connections';
  import {
    CONNECTION_ACCENT_CLASSES,
    connectionAccentOptions,
  } from '$lib/utils/connection-accents';
  import { isPairingUri, parsePairingUri } from '$shared/utils/pairing-uri';
  import { cn } from '$lib/utils';

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
    prefillLabel?: string | null;
    prefillAccent?: ConnectionAccent;
    defaultAccent?: ConnectionAccent;
  }

  let {
    open = $bindable(false),
    prefillHost = null,
    prefillPort = null,
    prefillLabel = null,
    prefillAccent = undefined,
    defaultAccent = DEFAULT_CONNECTION_ACCENT,
  }: Props = $props();

  type Step = 'details' | 'confirm' | 'syncConfirm';

  // The WSS default port (`server.wsApi.port`, PROTOCOL §1.1). Prefilled as a
  // sensible default; the field stays editable for operators who reconfigured it.
  const DEFAULT_WS_PORT = '5181';

  // i18n-ignore (URL)
  const INTENTD_REPO_URL = 'https://github.com/intent-hq/intentd';

  function openIntentdRepo(e: Event) {
    e.preventDefault();
    // eslint-disable-next-line intent/no-component-async-data-fetch -- opens an external URL in the system browser, not a domain data fetch
    void openExternalUrl(INTENTD_REPO_URL);
  }

  let step = $state<Step>('details');
  let name = $state('');
  let accent = $state<ConnectionAccent>(DEFAULT_CONNECTION_ACCENT);
  let host = $state('');
  let port = $state(DEFAULT_WS_PORT);
  let token = $state('');
  // tailcat tunnel address learned from a pasted pairing URI's `tc=` param
  // (PROTOCOL §12.3) — the only pre-connect source; stored with the add so
  // the very first connect can already race a tunnel candidate. Cleared when
  // the host is edited by hand (the address belongs to the pasted backend).
  let tcAddress = $state<string | null>(null);
  let detectHosts = $state(true);
  let saveToICloud = $state(true);
  let fingerprint = $state('');
  let busy = $state(false);
  let error = $state<string | null>(null);
  let firstInput: HTMLInputElement | null = $state(null);
  const accentOptions = $derived(
    connectionAccentOptions(prefillAccent === undefined ? defaultAccent : prefillAccent),
  );

  // Keychain sync state gates the iCloud checkbox: `supported` is the platform
  // gate (macOS only), `enabled` decides whether the syncConfirm step is needed.
  // While the async state load is pending (or failed), fall back to a
  // synchronous platform check so the consent checkbox renders on macOS even
  // when the user outraces the load — otherwise the add would proceed with the
  // synced default behind a checkbox the user never saw. The loaded state wins
  // once present.
  const platformIsMac =
    typeof window !== 'undefined' &&
    (window as { electronAPI?: { platform?: string } }).electronAPI?.platform === 'darwin';
  const syncState$ = selectKeychainSyncState();
  const syncSupported = $derived($syncState$?.supported ?? platformIsMac);
  const syncEnabled = $derived($syncState$?.enabled ?? false);

  const portNumber = $derived(Number(port.trim()));
  const canSubmitDetails = $derived(
    name.trim().length > 0 &&
      host.trim().length > 0 &&
      Number.isInteger(portNumber) &&
      portNumber > 0 &&
      portNumber <= 65535 &&
      token.trim().length > 0 &&
      !busy,
  );

  function reset() {
    step = 'details';
    name = '';
    accent = defaultAccent;
    host = '';
    port = DEFAULT_WS_PORT;
    token = '';
    tcAddress = null;
    detectHosts = true;
    saveToICloud = true;
    fingerprint = '';
    busy = false;
    error = null;
  }

  /**
   * Pasting a full pairing URI (`intent://pair?...`, PROTOCOL §5
   * `pairing.getInfo`) into the host field fills host/port/token from its
   * component params — and captures the optional `tc=` tunnel address, which
   * has no manual-entry equivalent. Non-URI pastes fall through untouched.
   */
  function handleHostPaste(e: ClipboardEvent) {
    const pasted = e.clipboardData?.getData('text') ?? '';
    if (!isPairingUri(pasted)) return;
    const parsed = parsePairingUri(pasted);
    if (!parsed) return;
    e.preventDefault();
    if (parsed.hosts.length > 0) host = parsed.hosts[0];
    if (parsed.port !== null) port = String(parsed.port);
    if (parsed.token) token = parsed.token;
    tcAddress = parsed.tcAddress;
  }

  function handleHostInput() {
    // Hand-editing the host detaches it from the pasted pairing payload; the
    // tunnel address must not be stored against a different backend.
    tcAddress = null;
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
    // Sync explicitly off but the box kept: enabling iCloud sync is
    // machine-global, so ask first instead of flipping it silently. Both
    // answers still add the backend (decline just excludes it from sync).
    if (syncSupported && !syncEnabled && saveToICloud) {
      error = null;
      step = 'syncConfirm';
      return;
    }
    await storeAndOpen(syncSupported && !saveToICloud);
  }

  async function storeAndOpen(syncExcluded: boolean, opts: { enableSyncAfterAdd?: boolean } = {}) {
    busy = true;
    error = null;
    const trimmedHost = host.trim();
    try {
      const addAction = addConnectionRequested({
        label: name.trim(),
        accent,
        host: trimmedHost,
        port: portNumber,
        fingerprint,
        token: token.trim(),
        ...(tcAddress ? { tcAddress } : {}),
        detectHosts,
        ...(syncExcluded ? { syncExcluded: true } : {}),
      });
      appStore.dispatch(addAction);
      const { connection } = await addAction.promise;
      if (opts.enableSyncAfterAdd) {
        // Enable machine-global sync only once the add succeeded, so a failed
        // add (bad token, WSS off on the target) leaves no machine-global
        // side effect. A retry re-runs the add as an idempotent upsert.
        const syncAction = setKeychainSyncEnabledRequested(true);
        appStore.dispatch(syncAction);
        await syncAction.promise;
      }
      const openAction = openConnectionRequested(connection.id);
      appStore.dispatch(openAction);
      await openAction.promise;
      close();
    } catch (e) {
      error = toMessage(e);
      busy = false;
    }
  }

  async function handleEnableSyncAndAdd() {
    await storeAndOpen(false, { enableSyncAfterAdd: true });
  }

  async function handleDeclineSync() {
    await storeAndOpen(true);
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

  function accentLabel(value: ConnectionAccent): string {
    if (value === null) return m.settings_devices_accentNone_label();
    return {
      blue: m.settings_devices_accentBlue_label(),
      indigo: m.settings_devices_accentIndigo_label(),
      violet: m.settings_devices_accentViolet_label(),
      rose: m.settings_devices_accentRose_label(),
      orange: m.settings_devices_accentOrange_label(),
      emerald: m.settings_devices_accentEmerald_label(),
      teal: m.settings_devices_accentTeal_label(),
    }[value];
  }

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
      if (prefillLabel && name === '') name = prefillLabel;
      accent = prefillAccent === undefined ? defaultAccent : prefillAccent;
      if (prefillHost && host === '') host = prefillHost;
      if (prefillPort != null && port === DEFAULT_WS_PORT) port = String(prefillPort);
      // Refresh the keychain sync state so the iCloud checkbox gate is current
      // even when settings never loaded it. A failed load leaves the state
      // null → the checkbox stays hidden and the add proceeds normally.
      const loadAction = loadKeychainSyncStateRequested();
      appStore.dispatch(loadAction);
      loadAction.promise.catch(() => {});
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
            <label class="text-xs text-subtle" for="connect-name"
              >{m.modals_connect_name_label()}</label
            >
            <Input
              id="connect-name"
              bind:ref={firstInput}
              bind:value={name}
              type="text"
              placeholder={m.modals_connect_name_placeholder()}
              class={inputClass}
              autocomplete="off"
            />
          </div>

          <fieldset class="space-y-1">
            <legend class="text-xs text-subtle">{m.settings_devices_accent_label()}</legend>
            <div class="flex flex-wrap gap-1">
              {#each accentOptions as option}
                <Button
                  type="button"
                  variant="plain"
                  class={cn(
                    'flex size-8 cursor-pointer items-center justify-center rounded-full border bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    option === accent
                      ? 'border-foreground shadow-[0_0_0_2px_var(--color-background),0_0_0_4px_var(--color-foreground)]'
                      : 'border-border hover:border-input',
                  )}
                  aria-label={m.modals_connect_accentOption_ariaLabel({
                    color: accentLabel(option),
                  })}
                  aria-pressed={option === accent}
                  onclick={() => (accent = option)}
                >
                  {#if option === null}
                    <span
                      class="size-4 rounded-full border border-muted-foreground/60 bg-background"
                      aria-hidden="true"
                    ></span>
                  {:else}
                    <span
                      class={cn('size-4 rounded-full', CONNECTION_ACCENT_CLASSES[option])}
                      aria-hidden="true"
                    ></span>
                  {/if}
                </Button>
              {/each}
            </div>
          </fieldset>

          <div class="space-y-1">
            <label class="text-xs text-subtle" for="connect-host"
              >{m.modals_connect_host_label()}</label
            >
            <input
              id="connect-host"
              bind:value={host}
              type="text"
              placeholder={m.modals_connect_host_placeholder()}
              class={inputClass}
              autocorrect="off"
              autocapitalize="off"
              spellcheck="false"
              onpaste={handleHostPaste}
              oninput={handleHostInput}
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
            <div class="flex items-center gap-2">
              <Checkbox id="connect-detect-hosts" bind:checked={detectHosts} />
              <Label for="connect-detect-hosts" class="text-sm font-normal"
                >{m.modals_connect_detectHosts_label()}</Label
              >
            </div>
            <p class="text-xs text-subtle">{m.modals_connect_detectHosts_description()}</p>
          </div>

          {#if syncSupported}
            <div class="space-y-1">
              <div class="flex items-center gap-2">
                <Checkbox id="connect-save-to-icloud" bind:checked={saveToICloud} />
                <Label for="connect-save-to-icloud" class="text-sm font-normal"
                  >{m.modals_connect_saveToICloud_label()}</Label
                >
              </div>
              <p class="text-xs text-subtle">{m.modals_connect_saveToICloud_description()}</p>
            </div>
          {/if}

          <p class="text-xs text-subtle">{m.modals_connect_whereToFind_help()}</p>
          <p class="text-xs text-subtle">
            {m.modals_connect_headless_before()}
            <a
              href={INTENTD_REPO_URL}
              class="text-primary hover:underline"
              onclick={openIntentdRepo}><!-- i18n-ignore (URL) -->github.com/intent-hq/intentd</a
            >
            {m.modals_connect_headless_after()}
          </p>
        {:else if step === 'confirm'}
          <p class="text-sm text-subtle">{m.modals_connect_confirmStep_description()}</p>
          <div class="space-y-1">
            <span class="text-xs text-subtle">{m.modals_connect_fingerprint_label()}</span>
            <!-- i18n-ignore (cert fingerprint hex, not translatable copy) -->
            <p class="font-mono text-xs break-all bg-muted/50 rounded p-2">{fingerprint}</p>
          </div>
        {:else}
          <p class="text-sm text-subtle">{m.modals_connect_enableSync_description()}</p>
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
        {:else if step === 'confirm'}
          <Button variant="ghost" onclick={back} disabled={busy}
            >{m.modals_connect_back_label()}</Button
          >
          <Button variant="default" onclick={handleConfirm} disabled={busy}>
            {busy ? m.modals_connect_connecting_label() : m.modals_connect_confirm_label()}
          </Button>
        {:else}
          <Button variant="ghost" onclick={back} disabled={busy}
            >{m.modals_connect_back_label()}</Button
          >
          <Button variant="ghost" onclick={handleDeclineSync} disabled={busy}>
            {m.modals_connect_enableSync_decline_label()}
          </Button>
          <Button variant="default" onclick={handleEnableSyncAndAdd} disabled={busy}>
            {busy
              ? m.modals_connect_connecting_label()
              : m.modals_connect_enableSync_confirm_label()}
          </Button>
        {/if}
      </div>
    </div>
  </div>
{/if}
