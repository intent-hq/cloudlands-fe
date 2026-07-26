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
   * blocks rotation, -32001 on remote calls).
   *
   * This component directly calls appClient methods per the restored pattern from
   * commit 27293564. The WebSocket API settings are transient UI state that do not
   * belong in Redux; the settings themselves are persisted by the daemon.
   */
  import { onMount, onDestroy } from 'svelte';
  import { slide } from 'svelte/transition';
  import Toggle from '$lib/components/ui/toggle/toggle.svelte';
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

  let showToken = $state(false);
  let showQr = $state(false);
  let qrDataUrl = $state('');
  let qrTimer: ReturnType<typeof setTimeout> | null = null;

  const maskedToken = $derived(
    token ? '•'.repeat(Math.max(0, token.length - 8)) + token.slice(-8) : '',
  );

  onMount(async () => {
    await loadStatus();
  });

  async function loadStatus() {
    try {
      loading = true;
      const settings = await appClient.settings.list();
      const wsApiEnabled = settings.find((s: { path: string; value: unknown }) => s.path === 'server.wsApi.enabled');
      const wsApiPort = settings.find((s: { path: string; value: unknown }) => s.path === 'server.wsApi.port');

      enabled = wsApiEnabled?.value === true;

      // Load persisted port (always, not only when enabled)
      if (typeof wsApiPort?.value === 'number') {
        persistedPort = wsApiPort.value;
        editedPort = String(wsApiPort.value);
      }

      if (enabled) {
        const info = await appClient.server.pairingInfo();
        token = info.token;
        port = info.port; // bound port from pairing info
        certFingerprint = info.certFingerprint;
        localIps = info.localIps;
        _hostname = info.hostname;
      }
    } catch (error) {
      toast.error(`Failed to load WebSocket API status: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      loading = false;
    }
  }

  async function handleToggle(checked: boolean) {
    try {
      const result = await appClient.settings.update([
        { path: 'server.wsApi.enabled', value: checked },
      ]);

      // Check if the daemon rolled back the setting on failure
      const applied = result.find((r: { path: string; value: unknown }) => r.path === 'server.wsApi.enabled');
      if (applied && applied.value !== checked) {
        toast.error('Failed to start WebSocket listener; setting rolled back');
        enabled = false;
        return;
      }

      enabled = checked;
      if (checked) {
        await loadStatus();
      }
    } catch (error) {
      toast.error(`Failed to toggle WebSocket API: ${error instanceof Error ? error.message : String(error)}`);
      enabled = !checked;
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
      const applied = result.find((r: { path: string; value: unknown }) => r.path === 'server.wsApi.port');
      if (applied && applied.value !== newPort) {
        // Daemon rolled back to a different value (could be the old value or a different one)
        const rolledBackValue = typeof applied.value === 'number' ? applied.value : persistedPort;
        toast.error('Failed to change port; setting rolled back');
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
        toast.success(`Port changed to ${newPort}`);
      } else {
        toast.success(`Port saved (will be used when enabled)`);
      }
    } catch (error) {
      // Daemon error (e.g., port already in use)
      toast.error(`Failed to change port: ${error instanceof Error ? error.message : String(error)}`);
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
      toast.success('Token regenerated successfully');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('INTENTD_AUTH_TOKEN') || message.includes('token is fixed')) {
        toast.error('Cannot rotate token: INTENTD_AUTH_TOKEN environment variable is set');
      } else {
        toast.error(`Failed to regenerate token: ${message}`);
      }
    } finally {
      regenerating = false;
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(token);
      toast.success('Token copied to clipboard');
    } catch {
      toast.error('Failed to copy token');
    }
  }

  async function handleShowQr() {
    if (!port) {
      toast.error('WebSocket API server is not running');
      return;
    }
    try {
      const QRCode = (await import('qrcode')).default;
      const pairingUri = `intent://pair?token=${encodeURIComponent(token)}&host=${localIps
        .map(encodeURIComponent)
        .join(',')}&port=${port}&path=/ws${
        certFingerprint ? `&certFingerprint=${encodeURIComponent(certFingerprint)}` : ''
      }`;
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
      toast.error('Failed to generate QR code');
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

<div class="flex flex-col bg-card rounded-xl divide-y divide-border">
  <!-- Enable toggle -->
  <section class="px-6 py-5">
    <div class="flex items-center justify-between">
      <div>
        <p class="text-sm font-medium text-foreground">Enable WebSocket API</p>
        <p class="text-xs text-subtle mt-1">
          When enabled, external tools can connect to Intent via WebSocket to interact with
          workspaces and agents programmatically.
        </p>
      </div>
      <Toggle
        pressed={enabled}
        onclick={() => handleToggle(!enabled)}
        variant="indicator"
        size="xs"
        class="mb-auto"
        disabled={loading}
      />
    </div>
  </section>

  <!-- Port (always visible) -->
  <section class="px-6 py-4">
    {#snippet portValidation()}
      {@const portNum = Number(editedPort)}
      {@const isValid = Number.isInteger(portNum) && portNum >= 1024 && portNum <= 65535}
      <div class="flex items-center justify-between gap-3">
        <span class="text-sm text-muted-foreground">Port</span>
        <div class="flex items-center gap-2">
          <div class="shrink-0 w-32">
            <Input
              type="number"
              min="1024"
              max="65535"
              bind:value={editedPort}
              disabled={portSaving}
              aria-label="WebSocket API port"
              class="h-9 text-sm"
            />
          </div>
          {#if editedPort !== String(persistedPort)}
            <button
              type="button"
              onclick={handlePortSave}
              disabled={portSaving || !isValid}
              class="px-3 py-1 text-xs font-medium text-foreground bg-accent hover:bg-accent/80 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {portSaving ? 'Saving...' : 'Save'}
            </button>
          {/if}
        </div>
      </div>
      {#if !isValid}
        <p class="text-xs text-amber-500/90 mt-1">Port must be an integer between 1024 and 65535</p>
      {/if}
      {#if enabled && port}
        <p class="text-xs text-subtle mt-1">Currently bound to port {port}</p>
      {/if}
    {/snippet}
    {@render portValidation()}
  </section>

  {#if enabled}
    <div transition:slide={{ duration: 200 }}>
      <!-- Mobile App Pairing -->
      <section class="px-6 py-5">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-foreground">Connect Mobile App</p>
            <p class="text-xs text-subtle mt-1">
              Scan a QR code with the Intent iOS app to pair instantly
            </p>
          </div>
          <button
            type="button"
            onclick={handleShowQr}
            class="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-foreground bg-muted hover:bg-muted/80 rounded-lg transition-colors cursor-pointer"
          >
            <Fa icon={faQrcode} size="sm" />
            Show QR Code
          </button>
        </div>
      </section>

      <!-- TLS Certificate Fingerprint -->
      {#if certFingerprint}
        <section class="px-6 py-4">
          <div class="flex items-center justify-between">
            <span class="text-sm text-muted-foreground">TLS Fingerprint</span>
            <code
              class="text-xs font-mono text-foreground bg-muted px-2 py-0.5 rounded max-w-[280px] truncate"
              title={certFingerprint}
            >{certFingerprint.slice(0, 23)}…</code>
          </div>
        </section>
      {/if}

      <!-- Token -->
      <section class="px-6 py-4 space-y-3">
        <div class="flex items-center justify-between">
          <span class="text-sm text-muted-foreground">API Token</span>
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
              title={showToken ? 'Hide token' : 'Show token'}
            >
              <Fa icon={showToken ? faEyeSlash : faEye} size="sm" />
            </button>
            <button
              type="button"
              onclick={handleCopy}
              class="p-1.5 text-muted-foreground hover:text-foreground rounded-md hover:bg-muted transition-colors cursor-pointer"
              title="Copy token"
            >
              <Fa icon={faCopy} size="sm" />
            </button>
            <button
              type="button"
              onclick={handleRegenerate}
              disabled={regenerating}
              class="p-1.5 text-muted-foreground hover:text-foreground rounded-md hover:bg-muted transition-colors cursor-pointer disabled:opacity-50"
              title="Regenerate token"
            >
              <Fa icon={faRotateRight} size="sm" class={regenerating ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>
        <p class="text-xs text-amber-500/90">
          ⚠ Keep this token secret. Anyone with it can access your workspaces.
        </p>
      </section>
    </div>
  {/if}
</div>

{#if showQr}
  <!-- QR Code overlay -->
  <div
    class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
    onclick={handleCloseQr}
    onkeydown={(e) => e.key === 'Escape' && handleCloseQr()}
    role="dialog"
    aria-modal="true"
    aria-label="QR code for mobile pairing"
    tabindex="-1"
  >
    <div
      class="bg-card rounded-xl p-6 shadow-xl max-w-xs text-center"
      onclick={(e) => e.stopPropagation()}
    >
      <h3 class="text-sm font-medium text-foreground mb-3">Scan to connect</h3>
      {#if qrDataUrl}
        <img src={qrDataUrl} alt="QR code for pairing" class="mx-auto rounded-lg" width="200" height="200" />
      {/if}
      <p class="text-xs text-subtle mt-3">
        Scan with the Intent mobile app to connect automatically.
      </p>
      <p class="text-xs text-amber-500/90 mt-2">
        ⚠ This QR code contains your API token. It will auto-dismiss in 30 seconds.
      </p>
      <button
        type="button"
        onclick={handleCloseQr}
        class="mt-4 px-4 py-1.5 text-xs font-medium text-foreground bg-muted hover:bg-muted/80 rounded-md transition-colors cursor-pointer"
      >
        Close
      </button>
    </div>
  </div>
{/if}
