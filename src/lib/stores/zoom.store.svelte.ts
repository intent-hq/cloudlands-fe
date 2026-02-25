/**
 * Zoom Store
 *
 * Tracks the browser zoom level by querying Electron's main process.
 * Used to counter-scale UI elements that should remain at fixed sizes
 * regardless of zoom (e.g., title bar to stay aligned with macOS traffic lights).
 */

import { browser } from '$app/environment';
import { IPC_CHANNELS } from '$shared/ipc-registry';

/**
 * Current zoom factor (1.0 = 100%, 1.5 = 150%, etc.)
 */
let zoomFactor = $state(1.0);

/**
 * Counter-scale value (1 / zoomFactor)
 */
const counterScale = $derived(1 / zoomFactor);

/**
 * Fetch zoom factor from main process via IPC
 */
async function fetchZoomFactor(): Promise<number> {
  if (typeof window === 'undefined' || !window.electronAPI) {
    return 1.0;
  }

  try {
    const result = await window.electronAPI.invoke(IPC_CHANNELS.WINDOW.GET_ZOOM_FACTOR, undefined);
    if (result?.success && typeof result.data === 'number' && result.data > 0) {
      return result.data;
    }
  } catch {
    // IPC not available
  }

  return 1.0;
}

/**
 * Update zoom factor
 */
function updateZoom(factor: number) {
  if (factor > 0 && factor !== zoomFactor) {
    zoomFactor = factor;
  }
}

let initialized = false;

/**
 * Initialize zoom tracking
 */
async function initialize() {
  if (initialized || !browser) return;
  initialized = true;

  // Get initial zoom
  const initial = await fetchZoomFactor();
  updateZoom(initial);

  // Listen for resize (zoom changes trigger resize)
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  window.addEventListener('resize', () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      updateZoom(await fetchZoomFactor());
    }, 100);
  });

  // Listen for zoom changes from main process
  if (window.electronAPI) {
    window.electronAPI.on('window:zoom-changed', (data: { zoomFactor: number }) => {
      if (typeof data?.zoomFactor === 'number' && data.zoomFactor > 0) {
        updateZoom(data.zoomFactor);
      }
    });
  }
}

// Auto-initialize
if (browser) {
  initialize();
}

/**
 * Zoom store
 */
export const zoomStore = {
  get zoomFactor() {
    return zoomFactor;
  },
  get counterScale() {
    return counterScale;
  },
  async refresh() {
    if (browser) {
      updateZoom(await fetchZoomFactor());
    }
  },
};
