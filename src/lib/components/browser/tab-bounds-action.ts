/**
 * Svelte action reporting a visible browser webview element's bounds (CSS px)
 * to the main process so fit viewports follow their panel and fixed
 * viewports scale-to-fit (docs/protocol §5.9). Reports apply to every tab.
 *
 * Lives outside the component per the no-component-async-data-fetch
 * boundary — IPC stays in this module (offscreen-webview-action precedent).
 */
import { createLogger } from '$lib/utils/client-logger';

const logger = createLogger('TabBoundsReporter');

/** Trailing debounce for resize bursts (panel drags fire per frame). */
const REPORT_DEBOUNCE_MS = 150;

function report(tabId: string, width: number, height: number): void {
  if (!(width > 0) || !(height > 0)) return;
  window.electronAPI?.invoke('browser:report-tab-bounds', { tabId, width, height }).catch((err) => {
    logger.debug('Failed to report tab bounds', { tabId, error: err });
  });
}

/**
 * Explicitly clear a tab's recorded bounds (scale back to 1). Sent when this
 * element stops displaying the tab — a visible→offscreen handoff re-registers
 * the tab with a new webContents BEFORE the old guest's destroyed event fires,
 * so main's destroyed-hook cleanup cannot cover it (its handoff guard is
 * false) and the offscreen host would inherit a stale visible-panel scale.
 */
function clear(tabId: string): void {
  window.electronAPI?.invoke('browser:report-tab-bounds', { tabId }).catch((err) => {
    logger.debug('Failed to clear tab bounds', { tabId, error: err });
  });
}

export function reportTabBounds(node: HTMLElement, tabId: string | undefined) {
  let currentTabId = tabId;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  // Absent in non-browser test environments (jsdom); the initial report
  // below still fires.
  const observer =
    typeof ResizeObserver === 'undefined'
      ? undefined
      : new ResizeObserver((entries) => {
          if (!currentTabId) return;
          const rect = entries[entries.length - 1]?.contentRect;
          if (!rect) return;
          const targetTabId = currentTabId;
          clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            report(targetTabId, rect.width, rect.height);
          }, REPORT_DEBOUNCE_MS);
        });
  observer?.observe(node);

  // Initial report without waiting for the first observer tick, so a tab
  // that mounts at its final size gets its scale immediately.
  if (currentTabId) {
    const rect = node.getBoundingClientRect();
    report(currentTabId, rect.width, rect.height);
  }

  return {
    update(nextTabId: string | undefined) {
      if (nextTabId === currentTabId) return;
      clearTimeout(debounceTimer);
      if (currentTabId) clear(currentTabId);
      currentTabId = nextTabId;
      if (currentTabId) {
        const rect = node.getBoundingClientRect();
        report(currentTabId, rect.width, rect.height);
      }
    },
    destroy() {
      clearTimeout(debounceTimer);
      observer?.disconnect();
      if (currentTabId) clear(currentTabId);
    },
  };
}
