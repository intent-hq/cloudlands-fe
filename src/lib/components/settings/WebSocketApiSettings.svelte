<script lang="ts">
  /* eslint-disable intent/no-component-async-data-fetch */
  /**
   * WebSocket API Settings Component
   *
   * Restored from commit 27293564, rewired to use AppClient + daemon RPCs:
   * - settings.update with server.wsApi.enabled
   * - server.pairingInfo for QR code + pairing details
   * - server.rotateToken for token regeneration
   *
   * Handles error states (failed start rolls back setting, INTENTD_AUTH_TOKEN
   * blocks rotation).
   *
   * Remote gating: `server.*` methods are local-only by design (the daemon
   * rejects them with -32001 on non-local connections), and toggling
   * `server.wsApi.enabled` remotely could sever the FE's own connection. So when
   * the active connection is remote (activeId !== LOCAL_CONNECTION_ID) this
   * component renders an info-only panel — no daemon calls, no controls. The
   * gating is reactive to connection switches while mounted: remote→local
   * triggers a fresh status load, and loadStatus() re-checks locality after
   * awaits so a mid-flight local→remote switch never fires server.pairingInfo.
   *
   * This component directly calls appClient methods per the restored pattern from
   * commit 27293564. The WebSocket API settings are transient UI state that do not
   * belong in Redux; the settings themselves are persisted by the daemon.
   */
  import { onDestroy } from 'svelte';
  import { slide } from 'svelte/transition';
  import Toggle from '$lib/components/ui/toggle/toggle.svelte';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import Fa from 'svelte-fa';
  import {
    faCopy,
    faRotateRight,
    faEye,
    faEyeSlash,
    faQrcode,
  } from '@fortawesome/free-solid-svg-icons';
  import { toast } from '$lib/components/ui/toast';
  import { appClient } from '$lib/client';
  import ListenTargetSelector from './ListenTargetSelector.svelte';
  import type { ListenTargetSelection } from './ListenTargetSelector.svelte';
  import { m } from '$shared/paraglide/messages.js';
  import { selectCurrentConnectionId } from '$store/renderer/slices/connections/connections-selectors';
  import { loadKeychainSyncStateRequested } from '$store/renderer/slices/connections/connections-slice';
  import { store as appStore } from '$store/renderer/store';
  import { IPC_CHANNELS } from '$shared/ipc-registry';
  import { LOCAL_CONNECTION_ID } from '$shared/types/connections';
  import type {
    PublishSelfResult,
    SelfPublishedStateResult,
    UnpublishSelfResult,
  } from '$shared/types/connections';

  const CONNECTIONS = IPC_CHANNELS.CONNECTIONS;

  const activeConnectionId$ = selectCurrentConnectionId();
  const isRemote = $derived($activeConnectionId$ !== LOCAL_CONNECTION_ID);

  let enabled = $state(false);
  let token = $state('');
  let port = $state<number | null>(null);
  let certFingerprint = $state('');
  let localIps = $state<string[]>([]);
  let _hostname = $state('');
  let loading = $state(true);
  let regenerating = $state(false);

  // Port editing state
  let persistedPort = $state<number>(5181); // persisted setting value
  let editedPort = $state<string>('5181'); // input value as string
  let portSaving = $state(false);

  // Listen targets + tunnel state (monorepo tailcat feature). `tunnelSupported`
  // gates the whole tunnel surface: false on daemons predating the
  // `server.tunnel.*` settings, so the UI degrades to the plain IP selector.
  let bindIps = $state<string[]>([]);
  let tunnelEnabled = $state(false);
  let tunnelOnly = $state(false);
  let tunnelSupported = $state(false);
  let tcAddress = $state('');
  let derpUrl = $state('');
  let persistedDerpUrl = $state('');
  let listenSaving = $state(false);
  let derpSaving = $state(false);

  let showToken = $state(false);
  let showQr = $state(false);
  let qrDataUrl = $state('');
  let qrTimer: ReturnType<typeof setTimeout> | null = null;

  // Publish-self state (spec Phase 2: sync is opt-out, so enabling the WSS
  // API auto-publishes this backend to iCloud Keychain). Loaded alongside the
  // WSS status; fail-soft — when it cannot be read, neither the auto-publish
  // nor the button fires.
  let publishStateLoaded = $state(false);
  let syncSupported = $state(false);
  let syncEnabled = $state(false);
  let selfPublished = $state(false);
  let publishSuppressed = $state(false);
  let publishBusy = $state(false);

  // Gate against overlapping toggle transitions: the awaited auto-unpublish
  // (toggle-off) keeps the toggle interactive otherwise, so a rapid off→on
  // could refresh state while the old record still exists, skip auto-publish,
  // and then have the queued unpublish delete it — WSS enabled but
  // unpublished (PR #1781 review).
  let toggleBusy = $state(false);

  const maskedToken = $derived(
    token ? '•'.repeat(Math.max(0, token.length - 8)) + token.slice(-8) : '',
  );

  // Reacts to connection switches while mounted (and covers the initial
  // mount): on remote, skip loadStatus() entirely — server.* methods are
  // local-only; on local (including a remote→local switch) load fresh status.
  $effect(() => {
    if (isRemote) {
      loading = false;
      return;
    }
    void loadStatus();
  });

  async function loadStatus() {
    try {
      loading = true;
      const settings = await appClient.settings.list();
      if (isRemote) {
        // Connection switched to remote mid-flight — server.pairingInfo is
        // local-only, so drop this stale load entirely.
        return;
      }
      const wsApiEnabled = settings.find(
        (s: { path: string; value: unknown }) => s.path === 'server.wsApi.enabled',
      );
      const wsApiPort = settings.find(
        (s: { path: string; value: unknown }) => s.path === 'server.wsApi.port',
      );

      enabled = wsApiEnabled?.value === true;

      // Load persisted port (always, not only when enabled)
      if (typeof wsApiPort?.value === 'number') {
        persistedPort = wsApiPort.value;
        editedPort = String(wsApiPort.value);
      }

      // Listen targets + tunnel settings (additive; absent on older daemons —
      // `tunnelSupported` stays false and the tunnel UI is not rendered).
      const bindAddress = settings.find(
        (s: { path: string; value: unknown }) => s.path === 'server.bindAddress',
      );
      bindIps = parseBindAddress(bindAddress?.value);
      const tunnelSetting = settings.find(
        (s: { path: string; value: unknown }) => s.path === 'server.tunnel.enabled',
      );
      tunnelSupported = tunnelSetting !== undefined;
      tunnelEnabled = tunnelSetting?.value === true;
      const tunnelOnlySetting = settings.find(
        (s: { path: string; value: unknown }) => s.path === 'server.tunnel.only',
      );
      // Tunnel-only keeps the persisted bindAddress for later restoration, so
      // the selector must not present those IPs as active listeners.
      tunnelOnly = tunnelEnabled && tunnelOnlySetting?.value === true;
      const derpSetting = settings.find(
        (s: { path: string; value: unknown }) => s.path === 'server.tunnel.derpUrl',
      );
      persistedDerpUrl = typeof derpSetting?.value === 'string' ? derpSetting.value : '';
      derpUrl = persistedDerpUrl;

      if (enabled) {
        const info = await appClient.server.pairingInfo();
        token = info.token;
        port = info.port; // bound port from pairing info
        certFingerprint = info.certFingerprint;
        localIps = info.localIps;
        _hostname = info.hostname;
        tcAddress = info.tcAddress ?? '';
        await refreshPublishState();
      }
    } catch (error) {
      toast.error(
        m.settings_wsApi_loadStatusError({
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      loading = false;
    }
  }

  /**
   * `server.bindAddress` is a single IP string (back-compat) or an array of
   * IP strings (monorepo#3314) — normalize to an array for the selector.
   */
  function parseBindAddress(value: unknown): string[] {
    if (typeof value === 'string' && value.length > 0) return [value];
    if (Array.isArray(value)) {
      return value.filter((v): v is string => typeof v === 'string' && v.length > 0);
    }
    return [];
  }

  /**
   * Persist a listen-target change: bind IPs → `server.bindAddress`, tunnel →
   * `server.tunnel.enabled`, and tunnel-only (no IPs selected) →
   * `server.tunnel.only`. One atomic settings.update batch; on failure the
   * selector re-syncs from a fresh loadStatus().
   */
  async function handleListenTargetChange(selection: ListenTargetSelection) {
    if (listenSaving) return;
    listenSaving = true;
    try {
      const changes: { path: string; value: unknown }[] = [];
      // Tunnel-only leaves the persisted bindAddress untouched — tunnel.only
      // already disables direct listeners, and the previous IPs restore when
      // an IP is re-selected.
      if (selection.ips.length > 0) {
        changes.push({ path: 'server.bindAddress', value: selection.ips });
      }
      // settings.update is atomic: on daemons predating server.tunnel.* the
      // unknown paths would reject the whole batch, so only include them when
      // supported (the selector never emits tunnel selections otherwise).
      if (tunnelSupported) {
        changes.push({ path: 'server.tunnel.enabled', value: selection.tunnel });
        changes.push({
          path: 'server.tunnel.only',
          value: selection.tunnel && selection.ips.length === 0,
        });
      }
      await appClient.settings.update(changes);
      bindIps = selection.ips.length > 0 ? selection.ips : bindIps;
      tunnelEnabled = selection.tunnel;
      tunnelOnly = selection.tunnel && selection.ips.length === 0;
      toast.success(m.settings_listenTargets_saved());
      // The bound listeners changed — refresh the pairing info (port/IPs/tc).
      await loadStatus();
    } catch (error) {
      toast.error(
        m.settings_listenTargets_saveError({
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      await loadStatus();
    } finally {
      listenSaving = false;
    }
  }

  async function handleDerpUrlSave() {
    if (derpSaving) return;
    derpSaving = true;
    try {
      await appClient.settings.update([{ path: 'server.tunnel.derpUrl', value: derpUrl }]);
      persistedDerpUrl = derpUrl;
      toast.success(m.settings_tunnel_derpUrl_saved());
    } catch (error) {
      toast.error(
        m.settings_tunnel_derpUrl_saveError({
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      derpUrl = persistedDerpUrl;
    } finally {
      derpSaving = false;
    }
  }

  async function handleCopyTcAddress() {
    try {
      await navigator.clipboard.writeText(tcAddress);
      toast.success(m.settings_tunnel_tcAddress_copied());
    } catch {
      toast.error(m.settings_tunnel_tcAddress_copyError());
    }
  }

  async function handleToggle(checked: boolean) {
    if (toggleBusy) return;
    toggleBusy = true;
    try {
      const result = await appClient.settings.update([
        { path: 'server.wsApi.enabled', value: checked },
      ]);

      // Check if the daemon rolled back the setting on failure
      const applied = result.find(
        (r: { path: string; value: unknown }) => r.path === 'server.wsApi.enabled',
      );
      if (applied && applied.value !== checked) {
        toast.error(m.settings_wsApi_startListenerError());
        enabled = false;
        return;
      }

      enabled = checked;
      if (checked) {
        await loadStatus();
        await maybeAutoPublish();
      } else {
        await maybeAutoUnpublish();
      }
    } catch (error) {
      toast.error(
        m.settings_wsApi_toggleError({
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      enabled = !checked;
    } finally {
      toggleBusy = false;
    }
  }

  function getApi(): Window['electronAPI'] | undefined {
    return typeof window !== 'undefined' ? window.electronAPI : undefined;
  }

  /** Load keychain-sync + self-published state (gates the modal and button). */
  async function refreshPublishState() {
    const api = getApi();
    if (!api) return;
    try {
      const [sync, self] = await Promise.all([
        appStore.dispatch(loadKeychainSyncStateRequested()).promise,
        api.invoke(CONNECTIONS.SELF_PUBLISHED_STATE) as Promise<SelfPublishedStateResult>,
      ]);
      syncSupported = sync.supported;
      syncEnabled = sync.enabled;
      selfPublished = self.published;
      publishSuppressed = self.suppressed;
      publishStateLoaded = true;
    } catch {
      // Fail-soft: without a readable state, offer neither modal nor button.
      publishStateLoaded = false;
    }
  }

  /**
   * Keep the published self entry fresh after a local change to its published
   * fields (token rotation, port change): main re-upserts the record from the
   * live pairing info so keychain sync pushes the new values to the user's
   * other devices. Strict no-op in main while unpublished or while the "do
   * not auto-publish" marker is set. Fire-and-forget and fail-soft — the
   * rotation/port change itself already succeeded.
   */
  function refreshSelfEntry() {
    const api = getApi();
    if (!api || isRemote) return;
    void Promise.resolve(api.invoke(CONNECTIONS.REFRESH_SELF)).catch(() => {});
  }

  /**
   * After a successful toggle-on on the local connection: auto-publish this
   * backend to iCloud Keychain (sync is opt-out, no opt-in modal). Never on
   * non-macOS, when sync is explicitly disabled, when a self entry already
   * exists, or when the "do not auto-publish" marker is set (re-publishing
   * is button-only). Fail-soft: a publish failure surfaces a toast and never
   * rolls back the WSS toggle.
   */
  async function maybeAutoPublish() {
    if (isRemote || !publishStateLoaded) return;
    if (!syncSupported || !syncEnabled || selfPublished || publishSuppressed) return;
    try {
      publishBusy = true;
      await publishSelf();
    } catch (error) {
      toast.error(
        m.settings_wsApi_publishSelf_error({
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      publishBusy = false;
    }
  }

  /**
   * After a successful toggle-off on the local connection: silently remove
   * this machine's published entry from iCloud Keychain — the record no
   * longer points at a reachable backend. Never on non-macOS or when no
   * published self entry exists (the state from the last refresh while WSS
   * was on; fail-soft when never loaded). Main removes the entry WITHOUT
   * setting the "do not auto-publish" marker, so toggling WSS back on
   * auto-publishes again. Fail-soft: an unpublish failure surfaces a toast
   * and never rolls back the WSS toggle.
   */
  async function maybeAutoUnpublish() {
    if (isRemote || !publishStateLoaded) return;
    if (!syncSupported || !selfPublished) return;
    const api = getApi();
    if (!api) return;
    try {
      const result = await (api.invoke(CONNECTIONS.UNPUBLISH_SELF) as Promise<UnpublishSelfResult>);
      // `removed: false` means main found no self entry to remove (the local
      // `selfPublished` was stale) — nothing was unpublished, so no success
      // toast; the state still converges to unpublished-side truth.
      selfPublished = false;
      if (result.removed) {
        toast.success(m.settings_wsApi_unpublishSelf_success());
      }
    } catch (error) {
      toast.error(
        m.settings_wsApi_unpublishSelf_error({
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }

  async function publishSelf() {
    const api = getApi();
    if (!api) throw new Error('electronAPI is not available');
    await (api.invoke(CONNECTIONS.PUBLISH_SELF) as Promise<PublishSelfResult>);
    selfPublished = true;
    publishSuppressed = false;
    toast.success(m.settings_wsApi_publishSelf_success());
  }

  async function handlePublishButton() {
    try {
      publishBusy = true;
      await publishSelf();
    } catch (error) {
      toast.error(
        m.settings_wsApi_publishSelf_error({
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      publishBusy = false;
    }
  }

  async function handlePortSave() {
    const newPort = Number(editedPort);
    if (!Number.isInteger(newPort) || newPort < 1024 || newPort > 65535) {
      return; // invalid input, do nothing
    }

    try {
      portSaving = true;
      const result = await appClient.settings.update([
        { path: 'server.wsApi.port', value: newPort },
      ]);

      // Check if the daemon rolled back the setting on failure
      const applied = result.find(
        (r: { path: string; value: unknown }) => r.path === 'server.wsApi.port',
      );
      if (applied && applied.value !== newPort) {
        // Daemon rolled back to a different value (could be the old value or a different one)
        const rolledBackValue = typeof applied.value === 'number' ? applied.value : persistedPort;
        toast.error(m.settings_wsApi_portRollbackError());
        persistedPort = rolledBackValue;
        editedPort = String(rolledBackValue);
        return;
      }

      // Success
      persistedPort = newPort;
      if (enabled) {
        // Refresh pairing info to show the new bound port (separate try/catch so only update failures are treated as save failures)
        try {
          const info = await appClient.server.pairingInfo();
          port = info.port;
        } catch {
          // Pairing info refresh failed, but the setting was saved successfully
        }
        // Propagate the new port to the published self entry (no-op in main
        // when unpublished/suppressed).
        refreshSelfEntry();
        toast.success(m.settings_wsApi_portChanged({ port: String(newPort) }));
      } else {
        toast.success(m.settings_wsApi_portSaved());
      }
    } catch (error) {
      // Daemon error (e.g., port already in use)
      toast.error(
        m.settings_wsApi_portChangeError({
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      editedPort = String(persistedPort);
    } finally {
      portSaving = false;
    }
  }

  async function handleRegenerate() {
    try {
      regenerating = true;
      const result = await appClient.server.rotateToken();
      token = result.token;
      // Propagate the rotated token to the published self entry (no-op in
      // main when unpublished/suppressed).
      refreshSelfEntry();
      toast.success(m.settings_wsApi_tokenRegenerated());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('INTENTD_AUTH_TOKEN') || message.includes('token is fixed')) {
        toast.error(m.settings_wsApi_tokenRotateFixedError());
      } else {
        toast.error(m.settings_wsApi_tokenRegenerateError({ error: message }));
      }
    } finally {
      regenerating = false;
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(token);
      toast.success(m.settings_wsApi_tokenCopied());
    } catch {
      toast.error(m.settings_wsApi_tokenCopyError());
    }
  }

  async function handleShowQr() {
    if (!port) {
      toast.error(m.settings_wsApi_serverNotRunning());
      return;
    }
    try {
      const QRCode = (await import('qrcode')).default;
      // `tc=` carries the tunnel address (PROTOCOL §12.3) so a scanned device
      // can reach the daemon in tunnel-only mode or away from the LAN.
      const pairingUri = `intent://pair?token=${encodeURIComponent(token)}&host=${localIps
        .map(encodeURIComponent)
        .join(',')}&port=${port}&path=/ws${
        certFingerprint ? `&certFingerprint=${encodeURIComponent(certFingerprint)}` : ''
      }${tcAddress ? `&tc=${encodeURIComponent(tcAddress)}` : ''}`;
      qrDataUrl = await QRCode.toDataURL(pairingUri, {
        width: 200,
        margin: 2,
        color: { dark: '#000000', light: '#ffffff' },
      });
      showQr = true;

      // Auto-dismiss after 30 seconds
      if (qrTimer) clearTimeout(qrTimer);
      qrTimer = setTimeout(() => {
        showQr = false;
        qrDataUrl = '';
      }, 30_000);
    } catch {
      toast.error(m.settings_wsApi_qrGenerateError());
    }
  }

  function handleCloseQr() {
    showQr = false;
    qrDataUrl = '';
    if (qrTimer) {
      clearTimeout(qrTimer);
      qrTimer = null;
    }
  }

  onDestroy(() => {
    if (qrTimer) clearTimeout(qrTimer);
  });
</script>

<div class="flex min-w-0 flex-col gap-4" data-settings-websocket-api>
  {#if isRemote}
    <!-- Remote connection: info-only panel — no toggle/port/token/QR controls -->
    <section>
      <p class="text-sm font-medium text-foreground">{m.settings_wsApi_enable_label()}</p>
      <p class="text-xs text-subtle mt-1">
        {m.settings_wsApi_remoteInfo_description()}
      </p>
    </section>
  {:else}
    <!-- Enable toggle -->
    <section>
      <div class="flex items-center justify-between">
        <div>
          <p class="text-sm font-medium text-foreground">{m.settings_wsApi_enable_label()}</p>
          <p class="text-xs text-subtle mt-1">
            {m.settings_wsApi_enable_description()}
          </p>
        </div>
        <Toggle
          pressed={enabled}
          onclick={() => handleToggle(!enabled)}
          variant="indicator"
          size="xs"
          class="mb-auto"
          disabled={loading || toggleBusy}
          ariaLabel={m.settings_wsApi_enable_label()}
        />
      </div>
    </section>

    <!-- Port (always visible) -->
    <section>
      {#snippet portValidation()}
        {@const portNum = Number(editedPort)}
        <!-- i18n-ignore (template expression, not user-facing text) -->
        {@const isValid = Number.isInteger(portNum) && portNum >= 1024 && portNum <= 65535}
        <div class="flex items-center justify-between gap-3">
          <span class="text-sm text-muted-foreground">{m.settings_wsApi_port_label()}</span>
          <div class="flex items-center gap-2">
            <div class="shrink-0 w-32">
              <Input
                type="number"
                min="1024"
                max="65535"
                bind:value={editedPort}
                disabled={portSaving}
                aria-label={m.settings_wsApi_port_ariaLabel()}
                class="h-9 text-sm"
              />
            </div>
            {#if Number(editedPort) !== persistedPort}
              <button
                type="button"
                onclick={handlePortSave}
                disabled={portSaving || !isValid}
                class="px-3 py-1 text-xs font-medium text-foreground bg-accent hover:bg-accent/80 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {portSaving ? m.settings_wsApi_port_saving() : m.settings_wsApi_port_save()}
              </button>
            {/if}
          </div>
        </div>
        {#if !isValid}
          <p class="text-xs text-amber-500/90 mt-1">{m.settings_wsApi_port_invalid()}</p>
        {/if}
        {#if enabled && port}
          <p class="text-xs text-subtle mt-1">
            {m.settings_wsApi_port_currentlyBound({ port: String(port) })}
          </p>
        {/if}
      {/snippet}
      {@render portValidation()}
    </section>

    {#if enabled}
      <div transition:slide={{ duration: 200 }} class="space-y-4">
        <!-- Listen targets: bound IPs + the tailcat tunnel entry. Rendered only
             once loaded; on old daemons the tunnel entry is absent
             (tunnelSupported=false) and only IPs show. -->
        <section>
          <ListenTargetSelector
            availableIps={localIps}
            selectedIps={tunnelOnly ? [] : bindIps}
            tunnelSelected={tunnelEnabled}
            {tunnelSupported}
            saving={listenSaving}
            onchange={handleListenTargetChange}
          />
        </section>

        {#if tunnelSupported && tunnelEnabled}
          <!-- This daemon's own tunnel address (copyable) -->
          <section data-tunnel-address-row>
            <div class="flex items-start justify-between gap-2">
              <div>
                <p class="text-sm font-medium text-foreground">
                  {m.settings_tunnel_tcAddress_label()}
                </p>
                <p class="text-xs text-subtle mt-1">
                  {m.settings_tunnel_tcAddress_description()}
                </p>
              </div>
              {#if tcAddress}
                <div class="flex items-center gap-2 shrink-0">
                  <code
                    class="text-xs font-mono text-foreground bg-muted px-2 py-0.5 rounded break-all select-all"
                    title={tcAddress}>{tcAddress}</code
                  >
                  <button
                    type="button"
                    onclick={handleCopyTcAddress}
                    class="p-1.5 text-muted-foreground hover:text-foreground rounded-md hover:bg-muted transition-colors cursor-pointer"
                    title={m.settings_tunnel_tcAddress_copy()}
                  >
                    <Fa icon={faCopy} size="sm" />
                  </button>
                </div>
              {:else}
                <p class="text-xs text-subtle shrink-0">
                  {m.settings_tunnel_tcAddress_pending()}
                </p>
              {/if}
            </div>
          </section>

          <!-- DERP relay URL -->
          <section data-tunnel-derp-row>
            <div class="flex items-center justify-between gap-3">
              <div>
                <p class="text-sm font-medium text-foreground">
                  {m.settings_tunnel_derpUrl_label()}
                </p>
                <p class="text-xs text-subtle mt-1">
                  {m.settings_tunnel_derpUrl_description()}
                </p>
              </div>
              <div class="flex items-center gap-2 shrink-0">
                <div class="w-56">
                  <Input
                    type="text"
                    bind:value={derpUrl}
                    disabled={derpSaving}
                    placeholder={m.settings_tunnel_derpUrl_placeholder()}
                    aria-label={m.settings_tunnel_derpUrl_label()}
                    class="h-9 text-sm"
                  />
                </div>
                {#if derpUrl !== persistedDerpUrl}
                  <button
                    type="button"
                    onclick={handleDerpUrlSave}
                    disabled={derpSaving}
                    class="px-3 py-1 text-xs font-medium text-foreground bg-accent hover:bg-accent/80 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {derpSaving
                      ? m.settings_tunnel_derpUrl_saving()
                      : m.settings_tunnel_derpUrl_save()}
                  </button>
                {/if}
              </div>
            </div>
          </section>
        {/if}

        <!-- Mobile App Pairing -->
        <section>
          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm font-medium text-foreground">
                {m.settings_wsApi_mobilePairing_label()}
              </p>
              <p class="text-xs text-subtle mt-1">
                {m.settings_wsApi_mobilePairing_description()}
              </p>
            </div>
            <button
              type="button"
              onclick={handleShowQr}
              class="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-foreground bg-muted hover:bg-muted/80 rounded-lg transition-colors cursor-pointer"
            >
              <Fa icon={faQrcode} size="sm" />
              {m.settings_wsApi_showQrCode()}
            </button>
          </div>
        </section>

        <!-- Publish this backend to iCloud Keychain (local + macOS + sync on
             + not currently published; re-publish clears the suppression) -->
        {#if publishStateLoaded && syncSupported && syncEnabled && !selfPublished}
          <section data-publish-self-row>
            <div class="flex items-center justify-between">
              <div>
                <p class="text-sm font-medium text-foreground">
                  {m.settings_wsApi_publishSelf_label()}
                </p>
                <p class="text-xs text-subtle mt-1">
                  {m.settings_wsApi_publishSelf_description()}
                </p>
              </div>
              <Button size="sm" onclick={handlePublishButton} disabled={publishBusy}>
                {publishSuppressed
                  ? m.settings_wsApi_publishSelf_republish_label()
                  : m.settings_wsApi_publishSelf_button_label()}
              </Button>
            </div>
          </section>
        {/if}

        <!-- TLS Certificate Fingerprint -->
        {#if certFingerprint}
          <section>
            <div class="flex items-start justify-between gap-2">
              <span class="text-sm text-muted-foreground shrink-0"
                >{m.settings_wsApi_tlsFingerprint_label()}</span
              >
              <code
                class="text-xs font-mono text-foreground bg-muted px-2 py-0.5 rounded break-all"
                title={certFingerprint}>{certFingerprint}</code
              >
            </div>
          </section>
        {/if}

        <!-- Token -->
        <section class="space-y-3">
          <div class="flex items-center justify-between">
            <span class="text-sm text-muted-foreground">{m.settings_wsApi_apiToken_label()}</span>
            <div class="flex items-center gap-2">
              <code
                class="text-xs font-mono text-foreground bg-muted px-2 py-1 rounded max-w-[280px] truncate select-all"
              >
                {showToken ? token : maskedToken}
              </code>
              <button
                type="button"
                onclick={() => (showToken = !showToken)}
                class="p-1.5 text-muted-foreground hover:text-foreground rounded-md hover:bg-muted transition-colors cursor-pointer"
                title={showToken ? m.settings_wsApi_hideToken() : m.settings_wsApi_showToken()}
              >
                <Fa icon={showToken ? faEyeSlash : faEye} size="sm" />
              </button>
              <button
                type="button"
                onclick={handleCopy}
                class="p-1.5 text-muted-foreground hover:text-foreground rounded-md hover:bg-muted transition-colors cursor-pointer"
                title={m.settings_wsApi_copyToken()}
              >
                <Fa icon={faCopy} size="sm" />
              </button>
              <button
                type="button"
                onclick={handleRegenerate}
                disabled={regenerating}
                class="p-1.5 text-muted-foreground hover:text-foreground rounded-md hover:bg-muted transition-colors cursor-pointer disabled:opacity-50"
                title={m.settings_wsApi_regenerateToken()}
              >
                <Fa icon={faRotateRight} size="sm" class={regenerating ? 'animate-spin' : ''} />
              </button>
            </div>
          </div>
          <p class="text-xs text-amber-500/90">
            {m.settings_wsApi_tokenSecretWarning()}
          </p>
        </section>
      </div>
    {/if}
  {/if}
</div>

{#if showQr}
  <!-- QR Code overlay -->
  <div
    class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
    onclick={(event) => {
      if (event.target === event.currentTarget) handleCloseQr();
    }}
    onkeydown={(e) => e.key === 'Escape' && handleCloseQr()}
    role="dialog"
    aria-modal="true"
    aria-label={m.settings_wsApi_qrDialogAriaLabel()}
    tabindex="-1"
  >
    <div class="bg-card rounded-xl p-6 shadow-xl max-w-xs text-center">
      <h3 class="text-sm font-medium text-foreground mb-3">{m.settings_wsApi_scanToConnect()}</h3>
      {#if qrDataUrl}
        <img
          src={qrDataUrl}
          alt={m.settings_wsApi_qrImageAlt()}
          class="mx-auto rounded-lg"
          width="200"
          height="200"
        />
      {/if}
      <p class="text-xs text-subtle mt-3">
        {m.settings_wsApi_scanDescription()}
      </p>
      <p class="text-xs text-amber-500/90 mt-2">
        {m.settings_wsApi_qrTokenWarning()}
      </p>
      <button
        type="button"
        onclick={handleCloseQr}
        class="mt-4 px-4 py-1.5 text-xs font-medium text-foreground bg-muted hover:bg-muted/80 rounded-md transition-colors cursor-pointer"
      >
        {m.settings_wsApi_close()}
      </button>
    </div>
  </div>
{/if}
