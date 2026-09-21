<script lang="ts">
  let {
    url,
    workspaceId,
    tabId,
    onNavigate,
    onTitleChange,
    onFaviconChange,
    viewport,
    onViewportChange,
    isActive = true,
    focusUrlBarOnMount = false,
  }: {
    url: string;
    workspaceId: string;
    tabId?: string;
    onNavigate?: (url: string) => void;
    onTitleChange?: (title: string) => void;
    onFaviconChange?: (url: string) => void;
    viewport?: import('$shared/ipc/workspace-command-payloads').BrowserTabViewport;
    onViewportChange?: (
      viewport: import('$shared/ipc/workspace-command-payloads').BrowserTabViewport,
    ) => void;
    onFocus?: () => void;
    focusUrlBarOnMount?: boolean;
    isFocused?: boolean;
    isActive?: boolean;
  } = $props();
</script>

<div
  data-testid="embedded-browser"
  data-url={url}
  data-workspace-id={workspaceId}
  data-tab-id={tabId}
  data-is-active={isActive}
  data-focus-url-bar-on-mount={focusUrlBarOnMount}
  data-viewport-mode={viewport?.mode}
>
  <button type="button" onclick={() => onNavigate?.('https://next.example/')}>Navigate</button>
  <button type="button" onclick={() => onTitleChange?.('Next title')}>Change title</button>
  <button type="button" onclick={() => onFaviconChange?.('https://next.example/favicon.ico')}>
    Change favicon
  </button>
  <button
    type="button"
    onclick={() => onViewportChange?.({ mode: 'custom', width: 412, height: 915 })}
  >
    Change viewport
  </button>
</div>
