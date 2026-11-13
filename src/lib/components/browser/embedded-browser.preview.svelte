<script lang="ts" module>
  import { definePreview } from '$lib/component-catalog/preview-definition';

  interface Props {
    loading?: boolean;
    brokenFavicon?: boolean;
    error?: 'connection' | 'long' | 'closed';
    showDetails?: boolean;
  }

  export const preview = definePreview<Props>({
    id: 'embedded-browser',
    title: 'Embedded browser address',
    defaultState: 'ready',
    states: {
      ready: { props: {} },
      loading: { props: { loading: true } },
      'broken-favicon': { props: { brokenFavicon: true } },
      'load-error': { props: { error: 'connection' } },
      'long-load-error': { props: { error: 'long' } },
      'load-error-details': { props: { error: 'connection', showDetails: true } },
      'page-closed': { props: { error: 'closed' } },
    },
  });
</script>

<script lang="ts">
  import { onMount, tick } from 'svelte';
  import EmbeddedBrowser from './EmbeddedBrowser.svelte';

  let { loading = false, brokenFavicon = false, error, showDetails = false }: Props = $props();
  let root: HTMLElement;
  let url = $state('about:blank');
  let lastAction = $state('');
  let ready = $state(false);

  onMount(() => {
    let disposed = false;
    void tick().then(async () => {
      if (disposed) return;
      const webview = root.querySelector('webview');
      if (!webview) throw new Error('Embedded browser fixture webview missing');
      // The only native src is about:blank. No tabId, registration, transport, or remote page.
      // Fake guest events exercise the production toolbar without live browsing.
      let currentUrl =
        error === 'connection' ? 'http://localhost:5173' : 'https://example.invalid/docs';
      let guestClosed = false;
      const emit = (type: string, fields: Record<string, unknown> = {}) =>
        webview.dispatchEvent(Object.assign(new Event(type), fields));
      Object.assign(webview, {
        getWebContentsId: () => 1,
        getURL: () => {
          if (guestClosed) throw new Error('Preview guest closed');
          return currentUrl;
        },
        executeJavaScript: async () => undefined,
        canGoBack: () => false,
        canGoForward: () => false,
        loadURL: async (url: string) => {
          currentUrl = url;
          lastAction = `navigate ${url}`;
          emit('did-navigate', { url });
          emit('did-stop-loading');
        },
        reload: () => {
          lastAction = 'refresh';
          emit('did-navigate', { url: currentUrl });
          emit('did-stop-loading');
        },
        setAudioMuted: () => {},
      });
      emit('did-navigate', { url: currentUrl });
      if (error !== 'connection') emit('page-title-updated', { title: 'Example docs' });
      emit('dom-ready');
      if (brokenFavicon) {
        emit('page-favicon-updated', { favicons: ['data:image/png;base64,broken'] });
      }
      emit(loading ? 'did-start-loading' : 'did-stop-loading');
      if (error === 'connection')
        emit('did-fail-load', {
          isMainFrame: true,
          errorCode: -102,
          validatedURL: 'http://localhost:5173',
        });
      if (error === 'long')
        emit('did-fail-load', {
          isMainFrame: true,
          errorCode: -105,
          validatedURL: currentUrl,
          errorDescription: `The server could not be reached at https://${'unreachable-'.repeat(12)}example.invalid. Check the connection and try again.`,
        });
      if (error === 'closed') {
        guestClosed = true;
        emit('destroyed');
      }
      if (showDetails) {
        await tick();
        if (!disposed)
          root.querySelector<HTMLButtonElement>('[data-browser-status] button')?.click();
      }
      ready = true;
    });
    return () => {
      disposed = true;
    };
  });
</script>

<section class="grid w-full gap-3" bind:this={root} data-embedded-browser-fixture={ready}>
  <div class="overflow-hidden rounded-lg border border-border {error === 'long' ? 'h-48' : 'h-80'}">
    <EmbeddedBrowser
      {url}
      workspaceId="preview-browser-address"
      onNavigate={(next) => (url = next)}
    />
  </div>
  {#if lastAction}
    <p class="text-sm text-muted-foreground" data-preview-last-action={lastAction}>{lastAction}</p>
  {/if}
</section>
