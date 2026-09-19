<script lang="ts">
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
   * triggers a fresh status load, and operation effects re-check locality so a
   * mid-flight local→remote switch never fires server.pairingInfo.
   *
   * Daemon and main-process results are consumed from selector-backed Redux state.
   */
  import { onDestroy } from 'svelte';
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
  import { notify } from '$lib/components/patterns/notify';
  import { SettingsFieldRow } from '$lib/components/patterns/settings';
  import ListenTargetSelector from './ListenTargetSelector.svelte';
  import type { ListenTargetSelection } from './ListenTargetSelector.svelte';
  import { m } from '$shared/paraglide/messages.js';
  import {
    selectCurrentConnectionId,
    selectKeychainSyncOperationState,
    selectKeychainSyncState,
    selectSelfPublishState,
  } from '$store/renderer/slices/connections/connections-selectors';
  import {
    loadKeychainSyncStateRequested,
    loadSelfPublishedStateRequested,
    publishSelfRequested,
    refreshSelfRequested,
    unpublishSelfRequested,
  } from '$store/renderer/slices/connections/connections-slice';
  import { store as appStore } from '$store/renderer/store';
  import { LOCAL_CONNECTION_ID } from '$shared/types/connections';
  import {
    getServerPairingInfoRequested,
    listSettingsRequested,
    rotateServerTokenRequested,
    updateSettingsRequested,
  } from '$store/renderer/slices/settings-events/settings-events-slice';
  import {
    selectServerPairingOperation,
    selectSettingsListOperation,
    selectSettingsUpdateOperation,
    selectTokenRotationOperation,
  } from '$store/renderer/slices/settings-events/settings-events-selectors';

  const activeConnectionId$ = selectCurrentConnectionId();
  const isRemote = $derived($activeConnectionId$ !== LOCAL_CONNECTION_ID);
  const LIST_KEY = 'websocket-api:list';
  const PAIRING_KEY = 'websocket-api:pairing';
  const LISTEN_UPDATE_KEY = 'websocket-api:update:listen';
  const TOGGLE_UPDATE_KEY = 'websocket-api:update:toggle';
  const PORT_UPDATE_KEY = 'websocket-api:update:port';
  const TOKEN_KEY = 'websocket-api:token';
  const listOperation$ = selectSettingsListOperation(LIST_KEY);
  const pairingOperation$ = selectServerPairingOperation(PAIRING_KEY);
  const listenUpdate$ = selectSettingsUpdateOperation(LISTEN_UPDATE_KEY);
  const toggleUpdate$ = selectSettingsUpdateOperation(TOGGLE_UPDATE_KEY);
  const portUpdate$ = selectSettingsUpdateOperation(PORT_UPDATE_KEY);
  const tokenRotation$ = selectTokenRotationOperation(TOKEN_KEY);
  const syncState$ = selectKeychainSyncState();
  const syncOperation$ = selectKeychainSyncOperationState();
  const selfPublish$ = selectSelfPublishState();

  let enabled = $state(false);
  let token = $state('');
  let port = $state<number | null>(null);
  let certFingerprint = $state('');
  let localIps = $state<string[]>([]);
  let availableIps = $state<string[] | undefined>(undefined);
  let _hostname = $state('');
  let loading = $state(true);
  const regenerating = $derived($tokenRotation$.status === 'loading');

  // Port editing state
  let persistedPort = $state<number>(5181); // persisted setting value
  let editedPort = $state<string>('5181'); // input value as string
  const portSaving = $derived($portUpdate$.status === 'loading');

  // Listen targets + tunnel state (monorepo tailcat feature). `tunnelSupported`
  // gates the whole tunnel surface: false on daemons predating the
  // `server.tunnel.*` settings, so the UI degrades to the plain IP selector.
  let bindIps = $state<string[]>([]);
  let bindAddressSupported = $state(false);
  let tunnelEnabled = $state(false);
  let tunnelOnly = $state(false);
  let tunnelSupported = $state(false);
  let tcAddress = $state('');
  const listenSaving = $derived($listenUpdate$.status === 'loading');

  let showToken = $state(false);
  let showQr = $state(false);
  let qrDataUrl = $state('');
  let qrTimer: ReturnType<typeof setTimeout> | null = null;

  // Publish-self state (spec Phase 2: sync is opt-out, so enabling the WSS
  // API auto-publishes this backend to iCloud Keychain). Loaded alongside the
  // WSS status; fail-soft — when it cannot be read, neither the auto-publish
  // nor the button fires.
  const publishStateLoaded = $derived(
    $syncOperation$.loadStatus === 'success' && $selfPublish$.stateStatus === 'success',
  );
  const syncSupported = $derived($syncState$?.supported ?? false);
  const syncEnabled = $derived($syncState$?.enabled ?? false);
  const selfPublished = $derived($selfPublish$.state?.published ?? false);
  const publishSuppressed = $derived($selfPublish$.state?.suppressed ?? false);
  const publishBusy = $derived($selfPublish$.publishStatus === 'loading');

  // Gate against overlapping toggle transitions: the awaited auto-unpublish
  // (toggle-off) keeps the toggle interactive otherwise, so a rapid off→on
  // could refresh state while the old record still exists, skip auto-publish,
  // and then have the queued unpublish delete it — WSS enabled but
  // unpublished (PR #1781 review).
  const toggleBusy = $derived(
    $toggleUpdate$.status === 'loading' || $selfPublish$.unpublishStatus === 'loading',
  );
  let seenListVersion = selectSettingsListOperation.select(appStore.state, LIST_KEY).version;
  let seenPairingVersion = selectServerPairingOperation.select(appStore.state, PAIRING_KEY).version;
  let seenListenVersion = selectSettingsUpdateOperation.select(
    appStore.state,
    LISTEN_UPDATE_KEY,
  ).version;
  let seenToggleVersion = selectSettingsUpdateOperation.select(
    appStore.state,
    TOGGLE_UPDATE_KEY,
  ).version;
  let seenPortVersion = selectSettingsUpdateOperation.select(
    appStore.state,
    PORT_UPDATE_KEY,
  ).version;
  let seenTokenVersion = selectTokenRotationOperation.select(appStore.state, TOKEN_KEY).version;
  let seenPublishVersion = selectSelfPublishState.select(appStore.state).publishVersion;
  let seenUnpublishVersion = selectSelfPublishState.select(appStore.state).unpublishVersion;
  let pendingListenSelection: ListenTargetSelection | null = null;
  let pendingToggle: boolean | null = null;
  let pendingPort: number | null = null;
  let autoPublishAfterStatus = false;
  let autoPublishPending = false;
  let pairingFailureSilent = false;
  let defaultLocalNetworkAfterStatus = false;
  let toggleRenderVersion = $state(0);

  const maskedToken = $derived(
    token ? '•'.repeat(Math.max(0, token.length - 8)) + token.slice(-8) : '',
  );

  // Reacts to connection switches while mounted (and covers the initial
  // mount): on remote, skip status requests entirely — server.* methods are
  // local-only; on local (including a remote→local switch) load fresh status.
  $effect(() => {
    if (isRemote) {
      autoPublishAfterStatus = false;
      autoPublishPending = false;
      loading = false;
      return;
    }
    requestStatus();
  });

  function requestStatus() {
    loading = true;
    appStore.dispatch(listSettingsRequested(LIST_KEY));
  }

  $effect(() => {
    const operation = $listOperation$;
    if (operation.version <= seenListVersion || operation.status === 'loading') return;
    seenListVersion = operation.version;
    if (isRemote) return;
    if (operation.status === 'success' && operation.data) {
      const settings = operation.data;
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
        pairingFailureSilent = false;
        appStore.dispatch(getServerPairingInfoRequested(PAIRING_KEY));
        appStore.dispatch(loadKeychainSyncStateRequested());
        appStore.dispatch(loadSelfPublishedStateRequested());
        if (autoPublishAfterStatus) {
          autoPublishAfterStatus = false;
          autoPublishPending = true;
        }
      } else {
        loading = false;
      }
    } else {
      autoPublishAfterStatus = false;
      loading = false;
      notify.error(
        m.settings_wsApi_loadStatusError({
          error: operation.error ?? '',
        }),
      );
    }
  });

  $effect(() => {
    const operation = $pairingOperation$;
    if (operation.version <= seenPairingVersion || operation.status === 'loading') return;
    seenPairingVersion = operation.version;
    loading = false;
    const silent = pairingFailureSilent;
    pairingFailureSilent = false;
    if (operation.status !== 'success' || !operation.data || isRemote) {
      if (operation.status === 'error' && !silent && !isRemote) {
        notify.error(m.settings_wsApi_loadStatusError({ error: operation.error ?? '' }));
      }
      return;
    }
    const info = operation.data;
    token = info.token;
    port = info.port;
    certFingerprint = info.certFingerprint;
    localIps = info.localIps;
    availableIps = info.availableIps;
    _hostname = info.hostname;
    tcAddress = info.tcAddress ?? '';
    if (defaultLocalNetworkAfterStatus) {
      defaultLocalNetworkAfterStatus = false;
      maybeDefaultLocalNetworkAccess();
    }
  });

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
   * selector re-syncs from a fresh status request.
   */
  function handleListenTargetChange(
    selection: ListenTargetSelection,
    options: { updateTunnel?: boolean } = {},
  ) {
    if (listenSaving) return;
    const changes: { path: string; value: unknown }[] = [];
    if (selection.ips.length > 0) {
      changes.push({ path: 'server.bindAddress', value: selection.ips });
    }
    if (tunnelSupported && options.updateTunnel !== false) {
      changes.push({ path: 'server.tunnel.enabled', value: selection.tunnel });
      changes.push({
        path: 'server.tunnel.only',
        value: selection.tunnel && selection.ips.length === 0,
      });
    }
    pendingListenSelection = selection;
    appStore.dispatch(updateSettingsRequested(changes, LISTEN_UPDATE_KEY));
  }

  $effect(() => {
    const operation = $listenUpdate$;
    if (operation.version <= seenListenVersion || operation.status === 'loading') return;
    seenListenVersion = operation.version;
    const selection = pendingListenSelection;
    pendingListenSelection = null;
    if (operation.status === 'success' && selection) {
      bindIps = selection.ips.length > 0 ? selection.ips : bindIps;
      tunnelEnabled = selection.tunnel;
      tunnelOnly = selection.tunnel && selection.ips.length === 0;
      notify.success(m.settings_listenTargets_saved());
      refreshSelfEntry();
    } else {
      notify.error(
        m.settings_listenTargets_saveError({
          error: operation.error ?? '',
        }),
      );
    }
    requestStatus();
  });

  const ALL_INTERFACES = '0.0.0.0';
  const LOOPBACK = '127.0.0.1';
  const UNSPECIFIED = new Set([ALL_INTERFACES, '::']);

  const localNetworkEnabled = $derived(!tunnelOnly && bindIps.some((ip) => ip !== LOOPBACK));
  let localNetworkOpen = $state(false);
  const localNetworkShown = $derived(localNetworkEnabled || localNetworkOpen);

  /**
   * Force loopback into a bind set while the tunnel is on: the tailcat
   * sidecar forwards tunnel connections to 127.0.0.1:<port>. All-interfaces
   * already covers loopback, and an empty set (tunnel-only) binds loopback
   * daemon-side, so neither needs the force.
   */
  function withLoopback(ips: string[]): string[] {
    if (ips.some((ip) => UNSPECIFIED.has(ip)) || ips.includes(LOOPBACK)) return ips;
    return [...ips, LOOPBACK];
  }

  /**
   * The "Enable Tailcat Tunnel" toggle drives `server.tunnel.enabled`.
   * Enabling locks loopback into the bind set (see withLoopback);
   * disabling from the tunnel-only posture restores the persisted bind IPs
   * as active listeners so the daemon never ends up with zero targets.
   */
  function handleTunnelToggle() {
    if (listenSaving) return;
    handleListenTargetChange({ ips: withLoopback(bindIps), tunnel: !tunnelEnabled });
  }

  function handleLocalNetworkToggle() {
    if (listenSaving) return;
    const turningOff = localNetworkShown;
    if (turningOff) {
      localNetworkOpen = false;
      if (!localNetworkEnabled) return;
    }
    handleListenTargetChange({
      ips: turningOff ? [LOOPBACK] : [ALL_INTERFACES],
      tunnel: tunnelEnabled,
    });
  }

  function handleSelectorChange(selection: ListenTargetSelection) {
    if (listenSaving) return;
    localNetworkOpen = true;
    handleListenTargetChange(selection);
  }

  function maybeDefaultLocalNetworkAccess() {
    if (!bindAddressSupported || localNetworkEnabled || tunnelOnly || listenSaving) return;
    handleListenTargetChange(
      { ips: [ALL_INTERFACES], tunnel: tunnelEnabled },
      { updateTunnel: false },
    );
  }

  async function handleCopyTcAddress() {
    try {
      await navigator.clipboard.writeText(tcAddress);
      notify.success(m.settings_tunnel_tcAddress_copied());
    } catch {
      notify.error(m.settings_tunnel_tcAddress_copyError());
    }
  }

  function handleToggle(checked: boolean) {
    if (toggleBusy) return;
    pendingToggle = checked;
    appStore.dispatch(
      updateSettingsRequested(
        [{ path: 'server.wsApi.enabled', value: checked }],
        TOGGLE_UPDATE_KEY,
      ),
    );
  }

  $effect(() => {
    const operation = $toggleUpdate$;
    if (operation.version <= seenToggleVersion || operation.status === 'loading') return;
    seenToggleVersion = operation.version;
    const checked = pendingToggle;
    pendingToggle = null;
    if (operation.status !== 'success' || checked === null) {
      notify.error(
        m.settings_wsApi_toggleError({
          error: operation.error ?? '',
        }),
      );
      if (checked !== null) {
        enabled = !checked;
        toggleRenderVersion += 1;
      }
      return;
    }
    const applied = operation.data?.find((change) => change.path === 'server.wsApi.enabled');
    if (applied && applied.value !== checked) {
      notify.error(m.settings_wsApi_startListenerError());
      enabled = false;
      toggleRenderVersion += 1;
      return;
    }
    enabled = checked;
    if (checked) {
      autoPublishAfterStatus = true;
      defaultLocalNetworkAfterStatus = true;
      requestStatus();
    } else if (!isRemote && publishStateLoaded && syncSupported && selfPublished) {
      localNetworkOpen = false;
      appStore.dispatch(unpublishSelfRequested());
    } else {
      localNetworkOpen = false;
    }
  });

  /**
   * Keep the published self entry fresh after a local change to its published
   * fields (token rotation, port change): main re-upserts the record from the
   * live pairing info so keychain sync pushes the new values to the user's
   * other devices. Strict no-op in main while unpublished or while the "do
   * not auto-publish" marker is set. Fire-and-forget and fail-soft — the
   * rotation/port change itself already succeeded.
   */
  function refreshSelfEntry() {
    if (isRemote) return;
    appStore.dispatch(refreshSelfRequested());
  }

  /**
   * After a successful toggle-on on the local connection: auto-publish this
   * backend to iCloud Keychain (sync is opt-out, no opt-in modal). Never on
   * non-macOS, when sync is explicitly disabled, when a self entry already
   * exists, or when the "do not auto-publish" marker is set (re-publishing
   * is button-only). Fail-soft: a publish failure surfaces a toast and never
   * rolls back the WSS toggle.
   */
  $effect(() => {
    const stateLoaded = publishStateLoaded;
    const remote = isRemote;
    const supported = syncSupported;
    const syncOn = syncEnabled;
    const published = selfPublished;
    const suppressed = publishSuppressed;
    if (!autoPublishPending || !stateLoaded) return;
    autoPublishPending = false;
    if (remote || !supported || !syncOn || published || suppressed) return;
    appStore.dispatch(publishSelfRequested());
  });

  $effect(() => {
    const operation = $selfPublish$;
    if (operation.publishVersion <= seenPublishVersion || operation.publishStatus === 'loading')
      return;
    seenPublishVersion = operation.publishVersion;
    if (operation.publishStatus === 'success') {
      notify.success(m.settings_wsApi_publishSelf_success());
    } else if (operation.publishStatus === 'error') {
      notify.error(
        m.settings_wsApi_publishSelf_error({
          error: operation.publishError ?? '',
        }),
      );
    }
  });

  $effect(() => {
    const operation = $selfPublish$;
    if (
      operation.unpublishVersion <= seenUnpublishVersion ||
      operation.unpublishStatus === 'loading'
    )
      return;
    seenUnpublishVersion = operation.unpublishVersion;
    if (operation.unpublishStatus === 'success' && operation.unpublishRemoved) {
      notify.success(m.settings_wsApi_unpublishSelf_success());
    } else if (operation.unpublishStatus === 'error') {
      notify.error(m.settings_wsApi_unpublishSelf_error({ error: operation.unpublishError ?? '' }));
    }
  });

  function handlePublishButton() {
    appStore.dispatch(publishSelfRequested());
  }

  function handlePortSave() {
    const newPort = Number(editedPort);
    if (!Number.isInteger(newPort) || newPort < 1024 || newPort > 65535) {
      return; // invalid input, do nothing
    }

    pendingPort = newPort;
    appStore.dispatch(
      updateSettingsRequested([{ path: 'server.wsApi.port', value: newPort }], PORT_UPDATE_KEY),
    );
  }

  $effect(() => {
    const operation = $portUpdate$;
    if (operation.version <= seenPortVersion || operation.status === 'loading') return;
    seenPortVersion = operation.version;
    const newPort = pendingPort;
    pendingPort = null;
    if (operation.status === 'success' && newPort !== null) {
      const applied = operation.data?.find((change) => change.path === 'server.wsApi.port');
      if (applied && applied.value !== newPort) {
        const rolledBackValue = typeof applied.value === 'number' ? applied.value : persistedPort;
        notify.error(m.settings_wsApi_portRollbackError());
        persistedPort = rolledBackValue;
        editedPort = String(rolledBackValue);
        return;
      }
      persistedPort = newPort;
      if (enabled) {
        pairingFailureSilent = true;
        appStore.dispatch(getServerPairingInfoRequested(PAIRING_KEY));
        refreshSelfEntry();
        notify.success(m.settings_wsApi_portChanged({ port: String(newPort) }));
      } else {
        notify.success(m.settings_wsApi_portSaved());
      }
    } else {
      notify.error(
        m.settings_wsApi_portChangeError({
          error: operation.error ?? '',
        }),
      );
      editedPort = String(persistedPort);
    }
  });

  function handleRegenerate() {
    appStore.dispatch(rotateServerTokenRequested(TOKEN_KEY));
  }

  $effect(() => {
    const operation = $tokenRotation$;
    if (operation.version <= seenTokenVersion || operation.status === 'loading') return;
    seenTokenVersion = operation.version;
    if (operation.status === 'success' && operation.data) {
      token = operation.data.token;
      refreshSelfEntry();
      notify.success(m.settings_wsApi_tokenRegenerated());
    } else {
      const message = operation.error ?? '';
      if (message.includes('INTENTD_AUTH_TOKEN') || message.includes('token is fixed')) {
        notify.error(m.settings_wsApi_tokenRotateFixedError());
      } else {
        notify.error(m.settings_wsApi_tokenRegenerateError({ error: message }));
      }
    }
  });

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(token);
      notify.success(m.settings_wsApi_tokenCopied());
    } catch {
      notify.error(m.settings_wsApi_tokenCopyError());
    }
  }

  async function handleShowQr() {
    if (!port) {
      notify.error(m.settings_wsApi_serverNotRunning());
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
</script>

<div class="flex min-w-0 flex-col gap-4" data-settings-websocket-api>
  {#if isRemote}
    <!-- Remote connection: info-only panel — no toggle/port/token/QR controls -->
    <section>
      <p class="type-body font-medium text-foreground">{m.settings_wsApi_enable_label()}</p>
      <p class="type-caption text-subtle mt-1">
        {m.settings_wsApi_remoteInfo_description()}
      </p>
    </section>
  {:else}
    <!-- Enable toggle -->
    <section>
      <div class="flex items-center justify-between">
        <div>
          <p class="type-body font-medium text-foreground">{m.settings_wsApi_enable_label()}</p>
          <p class="type-caption text-subtle mt-1">
            {m.settings_wsApi_enable_description()}
          </p>
        </div>
        {#key `${enabled}:${toggleRenderVersion}`}
          <Switch
            checked={enabled}
            onCheckedChange={handleToggle}
            size="xs"
            class="mb-auto"
            disabled={loading || toggleBusy}
            ariaLabel={m.settings_wsApi_enable_label()}
          />
        {/key}
      </div>
    </section>

    {#if enabled && tunnelSupported}
      <div transition:slide={{ tier: 'moderate' }}>
        <section data-tunnel-toggle-row>
          <div class="flex items-center justify-between">
            <div>
              <p class="type-body font-medium text-foreground">
                {m.settings_tunnel_enable_label()}
              </p>
              <p class="type-caption text-subtle mt-1">
                {m.settings_tunnel_enable_description()}{' '}<a
                  href="https://github.com/tailscale/tailcat"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="underline hover:text-foreground">{m.settings_tunnel_github_link()}</a
                >
              </p>
            </div>
            <Switch
              checked={tunnelEnabled}
              onCheckedChange={handleTunnelToggle}
              size="xs"
              class="mb-auto"
              disabled={toggleBusy || listenSaving}
              ariaLabel={m.settings_tunnel_enable_label()}
            />
          </div>
        </section>
      </div>
    {/if}

    {#if enabled && bindAddressSupported}
      <div transition:slide={{ tier: 'moderate' }}>
        <section data-local-network-toggle-row>
          <div class="flex items-center justify-between">
            <div>
              <p class="type-body font-medium text-foreground">
                {m.settings_wsApi_localNetworkAccess_label()}
              </p>
              <p class="type-caption text-subtle mt-1">
                {m.settings_wsApi_localNetworkAccess_description()}
              </p>
            </div>
            <Switch
              checked={localNetworkShown}
              onCheckedChange={handleLocalNetworkToggle}
              size="xs"
              class="mb-auto"
              disabled={toggleBusy || listenSaving}
              ariaLabel={m.settings_wsApi_localNetworkAccess_label()}
            />
          </div>
        </section>
      </div>
    {/if}

    <!-- Port (always visible) -->
    <section>
      {#snippet portValidation()}
        {@const portNum = Number(editedPort)}
        <!-- i18n-ignore (template expression, not user-facing text) -->
        {@const isValid = Number.isInteger(portNum) && portNum >= 1024 && portNum <= 65535}
        <div class="flex items-center justify-between gap-3">
          <span class="type-body text-muted-foreground">{m.settings_wsApi_port_label()}</span>
          <div class="flex items-center gap-2">
            <div class="shrink-0 w-32">
              <Input
                type="number"
                min="1024"
                max="65535"
                bind:value={editedPort}
                disabled={portSaving}
                aria-label={m.settings_wsApi_port_label()}
                class="h-9 type-body"
              />
            </div>
            {#if Number(editedPort) !== persistedPort}
              <Button
                variant="secondary"
                size="compact"
                type="button"
                onclick={handlePortSave}
                disabled={portSaving || !isValid}
                class="type-caption"
              >
                {portSaving ? m.settings_wsApi_port_saving() : m.settings_wsApi_port_save()}
              </Button>
            {/if}
          </div>
        </div>
        {#if !isValid}
          <p class="type-caption text-warning-ink mt-1">{m.settings_wsApi_port_invalid()}</p>
        {/if}
      {/snippet}
      {@render portValidation()}
    </section>

    {#if enabled}
      <div transition:slide={{ tier: 'moderate' }} class="space-y-4">
        <!-- Mobile App Pairing -->
        <SettingsFieldRow
          id="websocket-mobile-pairing"
          label={m.settings_wsApi_mobilePairing_label()}
          description={m.settings_wsApi_mobilePairing_description()}
        >
          {#snippet control()}
            <Button variant="secondary" size="sm" type="button" onclick={handleShowQr}>
              <Fa icon={faQrcode} size="sm" />
              {m.settings_wsApi_showQrCode()}
            </Button>
          {/snippet}
        </SettingsFieldRow>

        <!-- Publish this backend to iCloud Keychain (local + macOS + sync on
             + not currently published; re-publish clears the suppression) -->
        {#if publishStateLoaded && syncSupported && syncEnabled && !selfPublished}
          <section data-publish-self-row>
            <div class="flex items-center justify-between">
              <div>
                <p class="type-body font-medium text-foreground">
                  {m.settings_wsApi_publishSelf_label()}
                </p>
                <p class="type-caption text-subtle mt-1">
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

        <!-- Listen targets: the daemon's bound IPs. Rendered only once
             loaded; the tunnel is toggled above, not in the selector. -->
        {#if localNetworkShown}
          <section transition:slide={{ tier: 'moderate' }}>
            <ListenTargetSelector
              availableIps={availableIps ?? localIps}
              selectedIps={tunnelOnly ? [] : bindIps}
              tunnelSelected={tunnelEnabled}
              saving={listenSaving}
              onchange={handleSelectorChange}
            />
          </section>
        {/if}

        <!-- This daemon's own tailcat tunnel address (copyable) — surfaced
             here, where pairing happens, whenever the daemon reports one;
             absent on old daemons or with the tunnel down. -->
        {#if tunnelEnabled && tcAddress}
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
                  type="button"
                  onclick={handleCopyTcAddress}
                  class="p-1.5"
                  title={m.settings_tunnel_tcAddress_copy()}
                >
                  <Fa icon={faCopy} size="sm" />
                </Button>
              </div>
            </div>
          </section>
        {/if}

        <!-- TLS Certificate Fingerprint (truncated single line by user
             preference — reverses cloudlands-fe#1979's full-width display;
             the full value stays available via the title tooltip) -->
        {#if certFingerprint}
          <section>
            <div class="flex items-center justify-between">
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

        <!-- Token -->
        <section class="space-y-3">
          <div class="flex items-center justify-between">
            <span class="type-body text-muted-foreground">{m.settings_wsApi_apiToken_label()}</span>
            <div class="flex items-center gap-2">
              <code
                class="type-caption font-mono text-foreground bg-muted px-2 py-1 rounded max-w-[280px] truncate select-all"
              >
                {showToken ? token : maskedToken}
              </code>
              <Button
                variant="ghost"
                size="icon-compact"
                type="button"
                onclick={() => (showToken = !showToken)}
                class="p-1.5"
                title={showToken ? m.settings_wsApi_hideToken() : m.settings_wsApi_showToken()}
              >
                <Fa icon={showToken ? faEyeSlash : faEye} size="sm" />
              </Button>
              <Button
                variant="ghost"
                size="icon-compact"
                type="button"
                onclick={handleCopy}
                class="p-1.5"
                title={m.settings_wsApi_copyToken()}
              >
                <Fa icon={faCopy} size="sm" />
              </Button>
              <Button
                variant="ghost"
                size="icon-compact"
                type="button"
                onclick={handleRegenerate}
                disabled={regenerating}
                class="p-1.5"
                title={m.settings_wsApi_regenerateToken()}
              >
                {#if regenerating}
                  <IntentMarkLoader size={14} />
                {:else}
                  <Fa icon={faRotateRight} size="sm" />
                {/if}
              </Button>
            </div>
          </div>
          <p class="type-caption text-warning-ink">
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
    class="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50"
    onclick={(event) => {
      if (event.target === event.currentTarget) handleCloseQr();
    }}
    onkeydown={(e) => e.key === 'Escape' && handleCloseQr()}
    role="dialog"
    aria-modal="true"
    aria-label={m.settings_wsApi_qrDialogAriaLabel()}
    tabindex="-1"
  >
    <div class="w-full max-w-xs rounded-xl bg-card p-6 text-left shadow-xl">
      <h3 class="type-body font-medium text-foreground mb-3">
        {m.settings_wsApi_mobilePairing_label()}
      </h3>
      {#if qrDataUrl}
        <img
          src={qrDataUrl}
          alt={m.settings_wsApi_qrImageAlt()}
          class="w-full h-auto rounded-lg"
          width="544"
          height="544"
        />
      {/if}
      <p class="type-caption text-subtle mt-3">
        {m.settings_wsApi_scanDescription()}
      </p>
      <Button
        variant="secondary"
        size="compact"
        type="button"
        onclick={handleCloseQr}
        class="mt-4 type-caption"
      >
        {m.settings_wsApi_close()}
      </Button>
    </div>
  </div>
{/if}
