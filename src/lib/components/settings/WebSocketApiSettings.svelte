<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { slide } from 'svelte/transition';
  import Toggle from '$lib/components/ui/toggle/toggle.svelte';
  import Fa from 'svelte-fa';
  import {
    faCopy,
    faRotateRight,
    faEye,
    faEyeSlash,
    faQrcode,
  } from '@fortawesome/free-solid-svg-icons';
  import { toast } from '$lib/components/ui/toast';
  import { store as appStore } from '$store/renderer/store';
  import {
    loadWebSocketApiStatus,
    regenerateWebSocketApiToken,
    setWebSocketApiDiscoveryEnabled,
    setWebSocketApiEnabled,
  } from '$store/renderer/slices/websocket-api/websocket-api-slice';
  import {
    selectWebSocketApiCertFingerprint,
    selectWebSocketApiDiscoveryCountdown,
    selectWebSocketApiDiscoveryEnabled,
    selectWebSocketApiEnabled,
    selectWebSocketApiLoading,
    selectWebSocketApiLocalIps,
    selectWebSocketApiPort,
    selectWebSocketApiRegenerating,
    selectWebSocketApiToken,
  } from '$store/renderer/slices/websocket-api/websocket-api-selectors';

  const enabled$ = selectWebSocketApiEnabled();
  const token$ = selectWebSocketApiToken();
  const port$ = selectWebSocketApiPort();
  const loading$ = selectWebSocketApiLoading();
  const regenerating$ = selectWebSocketApiRegenerating();
  const discoveryEnabled$ = selectWebSocketApiDiscoveryEnabled();
  const discoveryCountdown$ = selectWebSocketApiDiscoveryCountdown();
  const localIps$ = selectWebSocketApiLocalIps();
  const certFingerprint$ = selectWebSocketApiCertFingerprint();

  let showToken = $state(false);
  let showQr = $state(false);
  let qrDataUrl = $state('');
  let qrTimer: ReturnType<typeof setTimeout> | null = null;

  const maskedToken = $derived(
    $token$ ? '•'.repeat(Math.max(0, $token$.length - 8)) + $token$.slice(-8) : '',
  );

  onMount(() => {
    appStore.dispatch(loadWebSocketApiStatus());
  });

  function handleToggle(checked: boolean) {
    appStore.dispatch(setWebSocketApiEnabled(checked));
  }

  function handleRegenerate() {
    appStore.dispatch(regenerateWebSocketApiToken());
  }

  function handleDiscoveryToggle(checked: boolean) {
    appStore.dispatch(setWebSocketApiDiscoveryEnabled(checked));
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText($token$);
      toast.success('Token copied to clipboard');
    } catch {
      toast.error('Failed to copy token');
    }
  }

  async function handleShowQr() {
    if (!$port$) {
      toast.error('WebSocket API server is not running');
      return;
    }
    try {
      const QRCode = (await import('qrcode')).default;
      const pairingUri = `intent://pair?token=${encodeURIComponent($token$)}&host=${$localIps$
        .map(encodeURIComponent)
        .join(',')}&port=${$port$}&path=/ws${
        $certFingerprint$ ? `&certFingerprint=${encodeURIComponent($certFingerprint$)}` : ''
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
        pressed={$enabled$}
        onclick={() => handleToggle(!$enabled$)}
        variant="indicator"
        size="xs"
        class="mb-auto"
        disabled={$loading$}
      />
    </div>
  </section>

  {#if $enabled$}
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

      <!-- Port -->
      <section class="px-6 py-4">
        <div class="flex items-center justify-between">
          <span class="text-sm text-muted-foreground">Port</span>
          <code class="text-sm font-mono text-foreground bg-muted px-2 py-0.5 rounded"
            >{$port$}</code
          >
        </div>
      </section>

      <!-- TLS Certificate Fingerprint -->
      {#if $certFingerprint$}
        <section class="px-6 py-4">
          <div class="flex items-center justify-between">
            <span class="text-sm text-muted-foreground">TLS Fingerprint</span>
            <code
              class="text-xs font-mono text-foreground bg-muted px-2 py-0.5 rounded max-w-[280px] truncate"
              title={$certFingerprint$}
            >{$certFingerprint$.slice(0, 23)}…</code>
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
              {showToken ? $token$ : maskedToken}
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
              disabled={$regenerating$}
              class="p-1.5 text-muted-foreground hover:text-foreground rounded-md hover:bg-muted transition-colors cursor-pointer disabled:opacity-50"
              title="Regenerate token"
            >
              <Fa icon={faRotateRight} size="sm" class={$regenerating$ ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>
        <p class="text-xs text-amber-500/90">
          ⚠ Keep this token secret. Anyone with it can access your workspaces.
        </p>
      </section>

      <!-- Network Discovery -->
      <section class="px-6 py-5">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-foreground">Network discovery</p>
            <p class="text-xs text-subtle mt-1">
              Advertise on your local network so mobile apps can find Intent automatically
              {#if $discoveryCountdown$}
                <span class="text-amber-500">· auto-off in {$discoveryCountdown$}</span>
              {/if}
            </p>
          </div>
          <Toggle
            pressed={$discoveryEnabled$}
            onclick={() => handleDiscoveryToggle(!$discoveryEnabled$)}
            variant="indicator"
            size="xs"
            class="mb-auto"
          />
        </div>
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

