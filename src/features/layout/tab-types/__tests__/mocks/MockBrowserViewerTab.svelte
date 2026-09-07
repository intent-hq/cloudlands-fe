<script lang="ts">
  import type { BrowserTabHost } from '$lib/components/browser/browser-tab-host';

  let {
    url,
    title,
    host,
    isActive = true,
    onNavigate,
    onClose,
    onFaviconChange,
  }: {
    url: string;
    title?: string;
    host: BrowserTabHost;
    isActive?: boolean;
    onNavigate?: (url: string) => void;
    onClose?: (options: { force: boolean }) => void;
    onFaviconChange?: (url: string) => void;
    onFocus?: () => void;
  } = $props();
</script>

<div
  data-testid="browser-viewer-tab"
  data-url={url}
  data-title={title}
  data-host-name={host.name}
  data-host-connected={host.connected}
  data-is-active={isActive}
>
  <button type="button" onclick={() => onNavigate?.('https://next.example/')}>Navigate</button>
  <button type="button" onclick={() => onClose?.({ force: false })}>Close</button>
  <button type="button" onclick={() => onClose?.({ force: true })}>Close anyway</button>
  <button type="button" onclick={() => onFaviconChange?.('https://next.example/favicon.ico')}>
    Change favicon
  </button>
</div>
