/**
 * Panel-layout IPC bridge — registers mock handlers for the panel-layout
 * persistence channels that save and load layout history to/from disk via
 * the main process.
 *
 * Channels served here:
 *  - `panel-layout:save` → saves layout history entry to disk
 *  - `panel-layout:load` → loads layout history from disk
 *
 * These channels are used by the panel-layout-persistence middleware to
 * persist panel layout state beyond localStorage (localStorage only holds
 * the current state; disk history holds the full timeline). The middleware
 * debounces save calls and loads history once on workspace mount.
 *
 * Handlers are registered at import time (seeder idiom).
 */
import { registerMockIpcHandler } from '$shared/ipc-mock-router';

/**
 * Panel layout history entry shape (matches what the middleware stores).
 */
interface PanelLayoutHistoryEntry {
  timestamp: number;
  layout: unknown; // The serialized panel layout state
}

// ── panel-layout:save → stub (no-op for tests) ──

// The save channel writes a layout history entry to disk. In test mode this
// is a no-op (the reconciliation test just needs the channel to be bridged
// so it doesn't fail the unbridged-invoke check).
registerMockIpcHandler('panel-layout:save', async (arg) => {
  // In real implementation (main process), this would write to disk.
  // For tests, we just acknowledge the save.
  return { success: true };
});

// ── panel-layout:load → stub (empty history for tests) ──

// The load channel reads layout history from disk. In test mode this
// returns an empty history array (no persisted layouts).
registerMockIpcHandler('panel-layout:load', async (arg) => {
  // In real implementation (main process), this would read from disk.
  // For tests, we return empty history (no layouts saved).
  const emptyHistory: PanelLayoutHistoryEntry[] = [];
  return { success: true, data: emptyHistory };
});
