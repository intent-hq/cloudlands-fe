<script lang="ts">
  /**
   * BrowserViewSlot — the box a main-owned browser page shows in (Labs).
   *
   * Replaces the `<webview>` when "Browser pages in the main process" is on.
   * Main draws the page as a native view over this box; the box itself only
   * shows a page snapshot while an overlay covers it (see
   * browser-view-slot-action.ts).
   */
  import type { EmbeddedBrowserWebview } from './embedded-browser-webview';
  import { mainOwnedBrowserSlot } from './browser-view-slot-action';
  import { reportTabBounds } from './tab-bounds-action';

  interface Props {
    tabId: string;
    workspaceId: string;
    url: string;
    pinned?: boolean;
    visible: boolean;
    webview?: EmbeddedBrowserWebview | null;
  }

  let { tabId, workspaceId, url, pinned, visible, webview = $bindable(null) }: Props = $props();
</script>

<div
  class="relative h-full w-full overflow-hidden"
  data-browser-view-slot={tabId}
  use:mainOwnedBrowserSlot={{
    tabId,
    workspaceId,
    url,
    ...(pinned === undefined ? {} : { pinned }),
    visible,
    onWebview: (next) => (webview = next),
  }}
  use:reportTabBounds={tabId}
></div>
