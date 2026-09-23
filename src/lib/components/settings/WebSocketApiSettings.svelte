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
  import { onDestroy, tick, type Snippet } from 'svelte';
  import { slide } from '$lib/motion';
  import {
    Button,
    Input,
    IntentMarkLoader,
    Switch,
  } from '$lib/components/patterns/settings/custom-controls';
  import Fa from 'svelte-fa';
  import {
    faCopy,
    faRotateRight,
    faEye,
    faEyeSlash,
    faQrcode,
  } from '@fortawesome/free-solid-svg-icons';
  import { ContentDialog } from '$lib/components/patterns/confirm';
  import { notify } from '$lib/components/patterns/notify';
  import {
    SettingsDisclosure,
    SettingsFieldRow,
    SettingsForm,
    defineSettings,
  } from '$lib/components/patterns/settings';
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

  let {
    expanded = true,
    children,
    onEnabled,
  }: {
    expanded?: boolean;
    children?: Snippet;
    onEnabled?: () => void;
  } = $props();

  const CONNECTIONS = IPC_CHANNELS.CONNECTIONS;

  const activeConnectionId$ = selectCurrentConnectionId();
  const isRemote = $derived($activeConnectionId$ !== LOCAL_CONNECTION_ID);

  let enabled = $state(false);
  let token = $state('');
  let port = $state<number | null>(null);
  let certFingerprint = $state('');
  let localIps = $state<string[]>([]);
  // Bind candidates unfiltered by the bind set (additive `availableIps`).
  // Undefined on older daemons, where the selector falls back to the
  // bind-filtered `localIps` (its union with the bound set keeps the bound
  // entries visible, but a loopback-only bind then offers nothing to pick).
  let availableIps = $state<string[] | undefined>(undefined);
  let _hostname = $state('');
  let loading = $state(true);
  let regenerating = $state(false);

  // Port editing state
  let persistedPort = $state<number>(5181); // persisted setting value
  let editedPort = $state<string>('5181'); // input value as string
  let portSaving = $state(false);
  const portValid = $derived.by(() => {
    const value = Number(editedPort);
    return Number.isInteger(value) && value >= 1024 && value <= 65535;
  });

  // Listen targets + tunnel state (monorepo tailcat feature). `tunnelSupported`
  // gates the whole tunnel surface: false on daemons predating the
  // `server.tunnel.*` settings, so the UI degrades to the plain IP selector.
  let bindIps = $state<string[]>([]);
  let bindAddressSupported = $state(false);
  let tunnelEnabled = $state(false);
  let tunnelOnly = $state(false);
  let tunnelSupported = $state(false);
  let tcAddress = $state('');
  let listenSaving = $state(false);

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
      bindAddressSupported = bindAddress !== undefined;
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

      if (enabled) {
        const info = await appClient.server.pairingInfo();
        token = info.token;
        port = info.port; // bound port from pairing info
        certFingerprint = info.certFingerprint;
        localIps = info.localIps;
        availableIps = info.availableIps;
        _hostname = info.hostname;
        tcAddress = info.tcAddress ?? '';
        await refreshPublishState();
      }
    } catch (error) {
      notify.error(
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
   * `server.tunnel.enabled`. Loopback is always bound (every selection
   * carries at least 127.0.0.1 or 0.0.0.0), so a change always leaves the
   * tunnel-only posture (`server.tunnel.only=false`). One atomic
   * settings.update batch; on failure the selector re-syncs from a fresh
   * loadStatus().
   */
  async function handleListenTargetChange(selection: ListenTargetSelection) {
    if (listenSaving) return;
    listenSaving = true;
    try {
      const changes: { path: string; value: unknown }[] = [
        { path: 'server.bindAddress', value: selection.ips },
      ];
      // settings.update is atomic: on daemons predating server.tunnel.* the
      // unknown paths would reject the whole batch, so only include them when
      // supported (the selector never emits tunnel selections otherwise).
      if (tunnelSupported) {
        changes.push({ path: 'server.tunnel.enabled', value: selection.tunnel });
        changes.push({ path: 'server.tunnel.only', value: false });
      }
      await appClient.settings.update(changes);
      bindIps = selection.ips;
      tunnelEnabled = selection.tunnel;
      tunnelOnly = false;
      notify.success(m.settings_listenTargets_saved());
      // The listen targets changed the published fields (hosts from the new
      // bind IPs, tc address from the tunnel toggle) — propagate them to the
      // published self entry (no-op in main when unpublished/suppressed).
      refreshSelfEntry();
      // The bound listeners changed — refresh the pairing info (port/IPs/tc).
      await loadStatus();
    } catch (error) {
      notify.error(
        m.settings_listenTargets_saveError({
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      await loadStatus();
    } finally {
      listenSaving = false;
    }
  }

  const ALL_INTERFACES = '0.0.0.0';
  const LOOPBACK = '127.0.0.1';
  // The daemon treats the IPv6 unspecified address like 0.0.0.0: it must
  // stand alone and already covers loopback (out-of-band config only).
  const UNSPECIFIED = new Set([ALL_INTERFACES, '::']);

  const localNetworkEnabled = $derived(!tunnelOnly && bindIps.some((ip) => ip !== LOOPBACK));

  /**
   * Loopback is always bound: this app and the tailcat sidecar (which forwards
   * tunnel connections to 127.0.0.1:<port>) reach the daemon over it. Force
   * it into every persisted bind set unless an unspecified address already
   * covers it. An empty set (tunnel-only restore) therefore becomes
   * loopback-only.
   */
  function withLoopback(ips: string[]): string[] {
    if (ips.some((ip) => UNSPECIFIED.has(ip)) || ips.includes(LOOPBACK)) return ips;
    return [...ips, LOOPBACK];
  }

  /**
   * The "Enable Tailcat Tunnel" toggle drives `server.tunnel.enabled`; the
   * bind set is carried through (loopback-repaired). Disabling from the
   * tunnel-only posture restores the persisted bind IPs as active listeners
   * so the daemon never ends up with zero targets.
   */
  function handleTunnelToggle() {
    if (listenSaving) return;
    void handleListenTargetChange({ ips: withLoopback(bindIps), tunnel: !tunnelEnabled });
  }

  /**
   * Loopback-only enable default: the daemon binds loopback only out of the
   * box, so turning the WebSocket API on from that state widens the bind set
   * to all interfaces. This applies on every enable from loopback-only,
   * including after choosing loopback in Available Networks.
   * A bindAddress the user already customized beyond loopback is left alone,
   * the tunnel is untouched, and a persisted tunnel-only posture is respected
   * (writing 0.0.0.0 there would contradict tunnel.only=true). Runs under
   * listenSaving so the network picker and tunnel toggle cannot issue a concurrent
   * bindAddress write.
   * Fail-soft: a failure surfaces a toast and never rolls back the toggle.
   */
  async function maybeDefaultLocalNetworkAccess() {
    if (!bindAddressSupported || localNetworkEnabled || tunnelOnly || listenSaving) return;
    listenSaving = true;
    try {
      await appClient.settings.update([{ path: 'server.bindAddress', value: [ALL_INTERFACES] }]);
      bindIps = [ALL_INTERFACES];
      refreshSelfEntry();
      // The bound listeners changed — refresh the pairing info (port/IPs).
      await loadStatus();
    } catch (error) {
      notify.error(
        m.settings_listenTargets_saveError({
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      listenSaving = false;
    }
  }

  async function handleCopyTcAddress() {
    try {
      await navigator.clipboard.writeText(tcAddress);
      notify.success(m.settings_tunnel_tcAddress_copied());
    } catch {
      notify.error(m.settings_tunnel_tcAddress_copyError());
    }
  }

  async function handleToggle(checked: boolean) {
    if (toggleBusy) return;
    const previousValue = enabled;
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
        notify.error(m.settings_wsApi_startListenerError());
        enabled = checked;
        await tick();
        enabled = applied.value === true;
        return;
      }

      enabled = checked;
      if (checked) {
        onEnabled?.();
        await loadStatus();
        await maybeDefaultLocalNetworkAccess();
        await maybeAutoPublish();
      } else {
        await maybeAutoUnpublish();
      }
    } catch (error) {
      notify.error(
        m.settings_wsApi_toggleError({
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      enabled = checked;
      await tick();
      enabled = previousValue;
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
      notify.error(
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
        notify.success(m.settings_wsApi_unpublishSelf_success());
      }
    } catch (error) {
      notify.error(
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
    notify.success(m.settings_wsApi_publishSelf_success());
  }

  async function handlePublishButton() {
    try {
      publishBusy = true;
      await publishSelf();
    } catch (error) {
      notify.error(
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
        notify.error(m.settings_wsApi_portRollbackError());
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
        notify.success(m.settings_wsApi_portChanged({ port: String(newPort) }));
      } else {
        notify.success(m.settings_wsApi_portSaved());
      }
    } catch (error) {
      // Daemon error (e.g., port already in use)
      notify.error(
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
      notify.success(m.settings_wsApi_tokenRegenerated());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('INTENTD_AUTH_TOKEN') || message.includes('token is fixed')) {
        notify.error(m.settings_wsApi_tokenRotateFixedError());
      } else {
        notify.error(m.settings_wsApi_tokenRegenerateError({ error: message }));
      }
    } finally {
      regenerating = false;
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(token);
      notify.success(m.settings_wsApi_tokenCopied());
    } catch {
      notify.error(m.settings_wsApi_tokenCopyError());
    }
  }

  function getPairingUri(): string {
    // Use one URI for QR pairing and clipboard sharing, including tunnel-only access.
    return `intent://pair?token=${encodeURIComponent(token)}&host=${localIps
      .map(encodeURIComponent)
      .join(',')}&port=${port}&path=/ws${
      certFingerprint ? `&certFingerprint=${encodeURIComponent(certFingerprint)}` : ''
    }${tcAddress ? `&tc=${encodeURIComponent(tcAddress)}` : ''}`;
  }

  async function handleCopyShareLink() {
    if (!port) {
      notify.error(m.settings_wsApi_serverNotRunning());
      return;
    }
    try {
      await navigator.clipboard.writeText(getPairingUri());
      notify.success(m.settings_wsApi_shareLink_copied());
    } catch {
      notify.error(m.settings_wsApi_shareLink_copyError());
    }
  }

  async function handleShowQr() {
    if (!port) {
      notify.error(m.settings_wsApi_serverNotRunning());
      return;
    }
    try {
      const QRCode = (await import('qrcode')).default;
      qrDataUrl = await QRCode.toDataURL(getPairingUri(), {
        width: 544,
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
      notify.error(m.settings_wsApi_qrGenerateError());
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

  const connectionSchema = $derived.by(() =>
    defineSettings({
      sections: [
        {
          id: 'websocket-api',
          title: m.settings_wsApi_enable_label(),
          entries: isRemote
            ? [
                {
                  kind: 'custom',
                  id: 'websocket-api-remote',
                  label: m.settings_wsApi_enable_label(),
                  description: m.settings_wsApi_remoteInfo_description(),
                },
              ]
            : [
                {
                  kind: 'switch',
                  id: 'websocket-api-enabled',
                  label: m.settings_wsApi_enable_label(),
                  description: m.settings_devices_remoteAccess_description(),
                  get: () => enabled,
                  set: handleToggle,
                  disabled: () => loading || toggleBusy,
                },
              ],
        },
      ],
    }),
  );
</script>

<div class="flex min-w-0 flex-col gap-4" data-settings-websocket-api>
  <SettingsForm schema={connectionSchema} embedded compact={false} />

  {#if !isRemote && expanded}
    {#if enabled && tunnelSupported}
      <div transition:slide={{ tier: 'moderate' }} class="space-y-4">
        <!-- Tailcat tunnel toggle: drives server.tunnel.enabled. Absent on
             old daemons predating the server.tunnel.* settings. -->
        {#snippet tunnelDescription()}
          {m.settings_tunnel_enable_description()}{' '}<Button
            variant="link"
            size="sm"
            href="https://github.com/tailscale/tailcat"
            target="_blank"
            rel="noopener noreferrer"
            class="h-auto px-0">{m.settings_tunnel_github_link()}</Button
          >
        {/snippet}
        <section data-tunnel-toggle-row>
          <SettingsFieldRow
            id="websocket-tunnel"
            label={m.settings_tunnel_enable_label()}
            descriptionContent={tunnelDescription}
            disabled={toggleBusy || listenSaving}
          >
            {#snippet control({ labelId, descriptionId })}
              <Switch
                checked={tunnelEnabled}
                onCheckedChange={handleTunnelToggle}
                disabled={toggleBusy || listenSaving}
                ariaLabelledby={labelId}
                ariaDescribedby={descriptionId}
              />
            {/snippet}
          </SettingsFieldRow>
        </section>
      </div>
    {/if}

    {#if enabled}
      <div transition:slide={{ tier: 'moderate' }} class="space-y-4">
        <!-- Mobile App Pairing -->
        <SettingsFieldRow
          id="websocket-mobile-pairing"
          label={m.settings_wsApi_mobilePairing_label()}
          description={m.settings_wsApi_mobilePairing_description()}
        >
          {#snippet control()}
            <div class="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" type="button" onclick={handleShowQr}>
                <Fa icon={faQrcode} size="sm" />
                {m.settings_wsApi_showQrCode()}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                type="button"
                onclick={handleCopyShareLink}
                disabled={!port || loading}
              >
                <Fa icon={faCopy} size="sm" />
                {m.settings_wsApi_shareLink_label()}
              </Button>
            </div>
          {/snippet}
        </SettingsFieldRow>

        <!-- Publish this backend to iCloud Keychain (local + macOS + sync on
             + not currently published; re-publish clears the suppression) -->
        {#if publishStateLoaded && syncSupported && syncEnabled && !selfPublished}
          <SettingsFieldRow
            id="websocket-publish-self"
            label={m.settings_wsApi_publishSelf_label()}
            description={m.settings_wsApi_publishSelf_description()}
            disabled={publishBusy}
          >
            {#snippet control()}
              <Button
                variant="secondary"
                size="sm"
                onclick={handlePublishButton}
                disabled={publishBusy}
              >
                {publishSuppressed
                  ? m.settings_wsApi_publishSelf_republish_label()
                  : m.settings_wsApi_publishSelf_button_label()}
              </Button>
            {/snippet}
          </SettingsFieldRow>
        {/if}
      </div>
    {/if}
    <SettingsDisclosure
      label={m.settings_devices_advanced_label()}
      flush
      muted
      class="pt-4 [&_[data-accordion-trigger]]:flex-none"
    >
      <div class="space-y-4">
        {@render children?.()}
        {#if enabled}
          {#if bindAddressSupported}
            <section transition:slide={{ tier: 'moderate' }}>
              <ListenTargetSelector
                availableIps={availableIps ?? localIps}
                selectedIps={tunnelOnly ? [] : bindIps}
                tunnelSelected={tunnelEnabled}
                saving={toggleBusy || listenSaving}
                onchange={handleListenTargetChange}
              />
            </section>
          {/if}

          <!-- Token -->
          <section class="space-y-3">
            <SettingsFieldRow id="websocket-token" label={m.settings_wsApi_apiToken_label()}>
              {#snippet control()}
                <div class="flex min-w-0 max-w-full items-center gap-2">
                  <code
                    class="type-caption font-mono text-foreground bg-muted px-2 py-1 rounded min-w-0 max-w-[280px] truncate select-all"
                  >
                    {showToken ? token : maskedToken}
                  </code>
                  <Button
                    variant="ghost"
                    size="icon-compact"
                    iconOnly
                    type="button"
                    onclick={() => (showToken = !showToken)}
                    class="text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
                    title={showToken ? m.settings_wsApi_hideToken() : m.settings_wsApi_showToken()}
                  >
                    <Fa icon={showToken ? faEyeSlash : faEye} size="sm" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-compact"
                    iconOnly
                    type="button"
                    onclick={handleCopy}
                    class="text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
                    title={m.settings_wsApi_copyToken()}
                  >
                    <Fa icon={faCopy} size="sm" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-compact"
                    iconOnly
                    type="button"
                    onclick={handleRegenerate}
                    disabled={regenerating}
                    class="text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer disabled:opacity-50"
                    title={m.settings_wsApi_regenerateToken()}
                  >
                    {#if regenerating}
                      <IntentMarkLoader size={14} />
                    {:else}
                      <Fa icon={faRotateRight} size="sm" />
                    {/if}
                  </Button>
                </div>
              {/snippet}
            </SettingsFieldRow>
            <p class="type-body text-warning-ink">
              {m.settings_wsApi_tokenSecretWarning()}
            </p>
            <!-- This daemon's own tailcat tunnel address (copyable) — shown only
                 while the tunnel is on and the daemon reports one. -->
            {#if tunnelSupported && tunnelEnabled && tcAddress}
              <section data-tunnel-address-row>
                <div class="flex items-center justify-between gap-2">
                  <span class="type-body text-muted-foreground">
                    {m.settings_tunnel_tcAddress_label()}
                  </span>
                  <div class="flex items-center gap-2 shrink-0">
                    <code
                      class="type-caption font-mono text-foreground bg-muted px-2 py-0.5 rounded max-w-[280px] truncate"
                      title={tcAddress}>{tcAddress}</code
                    >
                    <Button
                      variant="ghost"
                      size="icon-compact"
                      iconOnly
                      type="button"
                      onclick={handleCopyTcAddress}
                      class="text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
                      title={m.settings_tunnel_tcAddress_copy()}
                    >
                      <Fa icon={faCopy} size="sm" />
                    </Button>
                  </div>
                </div>
              </section>
            {/if}
          </section>
        {/if}

        <!-- Port remains configurable even while remote access is disabled. -->
        <SettingsFieldRow
          id="websocket-port"
          label={m.settings_wsApi_port_label()}
          error={portValid ? undefined : m.settings_wsApi_port_invalid()}
          disabled={portSaving}
        >
          {#snippet control({ labelId, errorId })}
            <div class="flex items-center gap-2">
              <div class="shrink-0 w-32">
                <Input
                  type="number"
                  min="1024"
                  max="65535"
                  bind:value={editedPort}
                  disabled={portSaving}
                  aria-label={m.settings_wsApi_port_ariaLabel()}
                  aria-labelledby={labelId}
                  aria-describedby={errorId}
                />
              </div>
              {#if Number(editedPort) !== persistedPort}
                <Button
                  variant="link"
                  size="sm"
                  type="button"
                  onclick={handlePortSave}
                  disabled={portSaving || !portValid}
                  class="h-auto px-0"
                >
                  {portSaving ? m.settings_wsApi_port_saving() : m.settings_wsApi_port_save()}
                </Button>
              {/if}
            </div>
          {/snippet}
        </SettingsFieldRow>

        {#if enabled}
          <!-- TLS Certificate Fingerprint (truncated single line by user
             preference — reverses cloudlands-fe#1979's full-width display;
             the full value stays available via the title tooltip) -->
          {#if certFingerprint}
            <section>
              <div class="flex flex-wrap items-center justify-between gap-2">
                <span class="type-body text-muted-foreground"
                  >{m.settings_wsApi_tlsFingerprint_label()}</span
                >
                <code
                  class="type-caption font-mono text-foreground bg-muted px-2 py-0.5 rounded max-w-[280px] truncate"
                  title={certFingerprint}>{certFingerprint.slice(0, 23)}…</code
                >
              </div>
            </section>
          {/if}
        {/if}
      </div>
    </SettingsDisclosure>
  {/if}
</div>

{#if showQr}
  <ContentDialog
    open
    title={m.settings_wsApi_mobilePairing_label()}
    description={m.settings_wsApi_scanDescription()}
    size="sm"
    closeLabel={m.settings_wsApi_close()}
    onClose={handleCloseQr}
  >
    {#if qrDataUrl}<img
        src={qrDataUrl}
        alt={m.settings_wsApi_qrImageAlt()}
        class="h-auto w-full rounded-lg"
        width="544"
        height="544"
      />{/if}
    {#snippet footer()}<Button variant="ghost" onclick={handleCloseQr}
        >{m.settings_wsApi_close()}</Button
      >{/snippet}
  </ContentDialog>
{/if}
