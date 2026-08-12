<script lang="ts">
  let {
    url,
    workspaceId,
    tabId,
    onNavigate,
    onTitleChange,
    onFaviconChange,
    isActive = true,
  }: {
    url: string;
    workspaceId: string;
    tabId?: string;
    onNavigate?: (url: string) => void;
    onTitleChange?: (title: string) => void;
    onFaviconChange?: (url: string) => void;
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
>
  <button type="button" onclick={() => onNavigate?.('https://next.example/')}>Navigate</button>
  <button type="button" onclick={() => onTitleChange?.('Next title')}>Change title</button>
  <button type="button" onclick={() => onFaviconChange?.('https://next.example/favicon.ico')}>
    Change favicon
  </button>
</div>
