<script lang="ts">
  import { tick, untrack, type Snippet } from 'svelte';
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
  import {
    SettingsDisclosure,
    SettingsFieldRow,
    SettingsForm,
    defineSettings,
  } from '$lib/components/patterns/settings';
  import { registerWebsocketCredentials } from '$features/settings/websocket-api-credentials';
  import ListenTargetSelector from './ListenTargetSelector.svelte';
  import type { ListenTargetSelection } from './ListenTargetSelector.svelte';
  import { m } from '$shared/paraglide/messages.js';
  import {
    selectCurrentConnectionId,
    selectKeychainSyncState,
    selectSelfPublication,
    selectSelfPublicationBusy,
  } from '$store/renderer/slices/connections/connections-selectors';
  import {
    settingsFormOpened,
    settingsFormClosed,
  } from '$store/renderer/slices/settings-events/settings-events-slice';
  import {
    selectSettingsFormById,
    selectSettingsFormOperationById,
  } from '$store/renderer/slices/settings-events/settings-events-selectors';
  import { websocketApiRequested } from '$store/renderer/slices/websocket-api/websocket-api-slice';
  import { selectWebsocketApiSnapshotById } from '$store/renderer/slices/websocket-api/websocket-api-selectors';
  import { store as appStore } from '$store/renderer/store';
  import { LOCAL_CONNECTION_ID } from '$shared/types/connections';

  let {
    expanded = true,
    children,
    onEnabled,
  }: {
    expanded?: boolean;
    children?: Snippet;
    onEnabled?: () => void;
  } = $props();

  const activeConnectionId$ = selectCurrentConnectionId();
  const isRemote = $derived($activeConnectionId$ !== LOCAL_CONNECTION_ID);
  const formId = crypto.randomUUID();
  let identity = { formId, sessionId: '' };
  const form$ = selectSettingsFormById(formId);
  const snapshot$ = selectWebsocketApiSnapshotById(formId);
  const save$ = selectSettingsFormOperationById(formId, 'save');
  const load$ = selectSettingsFormOperationById(formId, 'load');
  let toggleDraft = $state<boolean | null>(null);
  const enabled = $derived($snapshot$.enabled);
  let token = $state('');
  const port = $derived($snapshot$.port);
  const certFingerprint = $derived($snapshot$.certFingerprint);
  const localIps = $derived($snapshot$.localIps);
  const availableIps = $derived($snapshot$.availableIps);
  const loading = $derived($load$?.status === 'pending' || (!$form$ && (!isRemote || expanded)));
  const saving = $derived($save$?.status === 'pending');
  const regenerating = $derived(saving);

  // Port editing state
  const persistedPort = $derived($snapshot$.persistedPort);
  let editedPort = $state<string>('5181'); // input value as string
  const portSaving = $derived(saving || loading);
  const portValid = $derived.by(() => {
    const value = Number(editedPort);
    return Number.isInteger(value) && value >= 1024 && value <= 65535;
  });

  const bindIps = $derived($snapshot$.bindIps);
  const bindAddressSupported = $derived($snapshot$.bindAddressSupported);
  const tunnelEnabled = $derived($snapshot$.tunnelEnabled);
  const tunnelOnly = $derived($snapshot$.tunnelOnly);
  const tunnelSupported = $derived($snapshot$.tunnelSupported);
  const tcAddress = $derived($snapshot$.tcAddress);
  const listenSaving = $derived(saving || loading);

  let showToken = $state(false);
  let qrDataUrl = $state('');
  const showQr = $derived(qrDataUrl !== '');

  // Publish-self state (spec Phase 2: sync is opt-out, so enabling the WSS
  // API auto-publishes this backend to iCloud Keychain). Loaded alongside the
  // WSS status; fail-soft — when it cannot be read, neither the auto-publish
  // nor the button fires.
  const publication$ = selectSelfPublication();
  const publicationBusy$ = selectSelfPublicationBusy();
  const syncState$ = selectKeychainSyncState();
  const publishStateLoaded = $derived($publication$ !== null);
  const syncSupported = $derived($syncState$?.supported ?? false);
  const syncEnabled = $derived($syncState$?.enabled ?? false);
  const selfPublished = $derived($publication$?.published ?? false);
  const publishSuppressed = $derived($publication$?.suppressed ?? false);
  const publishBusy = $derived($publicationBusy$);

  // Gate against overlapping toggle transitions: the awaited auto-unpublish
  // (toggle-off) keeps the toggle interactive otherwise, so a rapid off→on
  // could refresh state while the old record still exists, skip auto-publish,
  // and then have the queued unpublish delete it — WSS enabled but
  // unpublished (PR #1781 review).
  const toggleBusy = $derived(saving || $publicationBusy$);

  const maskedToken = $derived(
    token ? '•'.repeat(Math.max(0, token.length - 8)) + token.slice(-8) : '',
  );

  $effect(() => {
    const connectionId = $activeConnectionId$;
    const active = connectionId === LOCAL_CONNECTION_ID || expanded;
    if (!active) return;
    const session = { formId, sessionId: crypto.randomUUID() };
    identity = session;
    showToken = false;
    toggleDraft = null;
    // eslint-disable-next-line intent/no-component-async-data-fetch -- Synchronous mount-only credential receiver, not domain I/O; secrets must remain outside Redux.
    const dispose = registerWebsocketCredentials(session.formId, session.sessionId, (value) => {
      token = value.token;
      qrDataUrl = value.qrDataUrl;
    });
    appStore.dispatch(settingsFormOpened(session, 'websocket-api'));
    appStore.dispatch(
      websocketApiRequested(
        { ...session, resource: 'load', requestId: crypto.randomUUID() },
        { kind: 'load', connectionId },
      ),
    );
    return () => {
      dispose();
      appStore.dispatch(settingsFormClosed(session));
    };
  });

  let appliedPortReset = '';
  $effect(() => {
    const reset = $form$?.values.portResetId;
    if (typeof reset === 'string' && reset !== appliedPortReset) {
      appliedPortReset = reset;
      editedPort = String(untrack(() => persistedPort));
    }
  });
  let notifiedEnable = '';
  $effect(() => {
    const requestId = $form$?.values.enabledAcknowledged;
    if (typeof requestId === 'string' && requestId !== notifiedEnable) {
      notifiedEnable = requestId;
      untrack(() => onEnabled?.());
    }
  });

  function handleToggle(checked: boolean) {
    if (toggleBusy || loading) return;
    toggleDraft = checked;
    appStore.dispatch(
      websocketApiRequested(
        { ...identity, resource: 'save', requestId: crypto.randomUUID() },
        { kind: 'toggle', enabled: checked, connectionId: $activeConnectionId$ },
      ),
    );
  }

  $effect(() => {
    const operation = $save$;
    if (!operation || operation.status === 'pending' || toggleDraft === null) return;
    let active = true;
    // Let the controlled switch observe its optimistic frame before rollback.
    void tick().then(() => {
      if (active) toggleDraft = null;
    });
    return () => {
      active = false;
    };
  });
  function handleListenTargetChange(selection: ListenTargetSelection) {
    if (listenSaving) return;
    appStore.dispatch(
      websocketApiRequested(
        { ...identity, resource: 'save', requestId: crypto.randomUUID() },
        { kind: 'listen', ...selection, connectionId: $activeConnectionId$ },
      ),
    );
  }
  function handleTunnelToggle() {
    if (listenSaving) return;
    appStore.dispatch(
      websocketApiRequested(
        { ...identity, resource: 'save', requestId: crypto.randomUUID() },
        { kind: 'tunnel', connectionId: $activeConnectionId$ },
      ),
    );
  }
  function handlePortSave() {
    if (!portValid || portSaving) return;
    appStore.dispatch(
      websocketApiRequested(
        { ...identity, resource: 'save', requestId: crypto.randomUUID() },
        { kind: 'port', port: Number(editedPort), connectionId: $activeConnectionId$ },
      ),
    );
  }
  function handleRegenerate() {
    if (saving) return;
    appStore.dispatch(
      websocketApiRequested(
        { ...identity, resource: 'save', requestId: crypto.randomUUID() },
        { kind: 'rotate', connectionId: $activeConnectionId$ },
      ),
    );
  }
  function handlePublishButton() {
    appStore.dispatch(
      websocketApiRequested(
        { ...identity, resource: 'save', requestId: crypto.randomUUID() },
        { kind: 'publish', connectionId: $activeConnectionId$ },
      ),
    );
  }
  function handleCopy() {
    appStore.dispatch(
      websocketApiRequested(
        { ...identity, resource: 'copy', requestId: crypto.randomUUID() },
        { kind: 'copy', target: 'token', connectionId: $activeConnectionId$ },
      ),
    );
  }
  function handleCopyFingerprint() {
    appStore.dispatch(
      websocketApiRequested(
        { ...identity, resource: 'copy', requestId: crypto.randomUUID() },
        { kind: 'copy', target: 'fingerprint', connectionId: $activeConnectionId$ },
      ),
    );
  }
  function handleCopyTcAddress() {
    appStore.dispatch(
      websocketApiRequested(
        { ...identity, resource: 'copy', requestId: crypto.randomUUID() },
        { kind: 'copy', target: 'tc', connectionId: $activeConnectionId$ },
      ),
    );
  }
  function handleCopyShareLink() {
    appStore.dispatch(
      websocketApiRequested(
        { ...identity, resource: 'copy', requestId: crypto.randomUUID() },
        { kind: 'copy', target: 'share', connectionId: $activeConnectionId$ },
      ),
    );
  }
  function handleShowQr() {
    appStore.dispatch(
      websocketApiRequested(
        { ...identity, resource: 'qr', requestId: crypto.randomUUID() },
        { kind: 'qr', connectionId: $activeConnectionId$ },
      ),
    );
  }
  function handleCloseQr() {
    appStore.dispatch(
      websocketApiRequested(
        { ...identity, resource: 'qr', requestId: crypto.randomUUID() },
        { kind: 'closeQr', connectionId: $activeConnectionId$ },
      ),
    );
  }

  const connectionSchema = $derived.by(() =>
    defineSettings({
      sections: [
        {
          id: 'websocket-api',
          title: m.settings_wsApi_enable_label(),
          entries: [
            {
              kind: 'switch',
              id: 'websocket-api-enabled',
              label: m.settings_wsApi_enable_label(),
              description: m.settings_devices_remoteAccess_description(),
              get: () => toggleDraft ?? enabled,
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
  {#if !isRemote || expanded}
    <SettingsForm schema={connectionSchema} embedded compact={false} />
  {/if}

  {#if expanded}
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
    <div hidden={!expanded}>
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
            <section
              class="space-y-3 [&_[data-field-label]]:font-normal"
              aria-labelledby="connection-details-heading"
            >
              <h3 id="connection-details-heading" class="type-body font-medium text-foreground">
                {m.settings_wsApi_connectionDetails_label()}
              </h3>
              <SettingsFieldRow
                id="websocket-token"
                label={m.settings_wsApi_apiToken_label()}
                class="md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:[&>[data-field-control]]:w-full"
              >
                {#snippet control()}
                  <div class="flex min-w-0 w-full items-center gap-2">
                    <code
                      class="type-caption font-mono text-foreground bg-muted px-2 py-1 rounded min-w-0 flex-1 truncate select-all"
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
                      title={showToken
                        ? m.settings_wsApi_hideToken()
                        : m.settings_wsApi_showToken()}
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
              <!-- This daemon's own tailcat tunnel address (copyable) — shown only
                 while the tunnel is on and the daemon reports one. -->
              {#if tunnelSupported && tunnelEnabled && tcAddress}
                <section data-tunnel-address-row>
                  <SettingsFieldRow
                    id="websocket-tailcat"
                    label={m.settings_tunnel_tcAddress_label()}
                    class="md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:[&>[data-field-control]]:w-full"
                  >
                    {#snippet control()}
                      <div class="flex min-w-0 w-full items-center gap-2">
                        <code
                          class="type-caption font-mono text-foreground bg-muted px-2 py-1 rounded min-w-0 flex-1 truncate"
                          title={tcAddress}>{tcAddress}</code
                        >
                        <Button
                          variant="ghost"
                          size="icon-compact"
                          iconOnly
                          type="button"
                          onclick={handleCopyTcAddress}
                          title={m.settings_tunnel_tcAddress_copy()}
                        >
                          <Fa icon={faCopy} size="sm" />
                        </Button>
                      </div>
                    {/snippet}
                  </SettingsFieldRow>
                </section>
              {/if}
              {#if certFingerprint}
                <SettingsFieldRow
                  id="websocket-fingerprint"
                  label={m.settings_wsApi_tlsFingerprint_label()}
                  class="md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:[&>[data-field-control]]:w-full"
                >
                  {#snippet control()}
                    <div class="flex min-w-0 w-full items-center gap-2">
                      <code
                        class="type-caption font-mono text-foreground bg-muted px-2 py-1 rounded min-w-0 flex-1 truncate"
                        title={certFingerprint}>{certFingerprint.slice(0, 23)}…</code
                      >
                      <Button
                        variant="ghost"
                        size="icon-compact"
                        iconOnly
                        type="button"
                        onclick={handleCopyFingerprint}
                        title={m.settings_wsApi_copyFingerprint_label()}
                      >
                        <Fa icon={faCopy} size="sm" />
                      </Button>
                    </div>
                  {/snippet}
                </SettingsFieldRow>
              {/if}
            </section>
          {/if}
        </div>
      </SettingsDisclosure>
    </div>
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
