/**
 * Backend status IPC bridge — provides daemon connection status to renderer.
 *
 * Bridges `backend:get-status`, `backend:spawn-sidecar`, and `backend:status`
 * (emitted events) to keep the FE informed of the main process's JSON-RPC
 * client connection state. The daemon-health middleware polls
 * `backend:get-status`, invokes `backend:spawn-sidecar` from the daemon-loss
 * modal, and subscribes to `backend:status` events to track health.
 *
 * In production (live electronAPI), these are handled by main-process code;
 * in tests (mock router), this seeder provides fallback responses.
 */
import { registerMockIpcHandler } from "$shared/ipc-mock-router";
import { IPC_CHANNELS } from "$shared/ipc-registry";

const BACKEND = IPC_CHANNELS.BACKEND;

/**
 * Mock backend status — default to connected for most tests.
 * Tests can override by calling `registerMockIpcHandler(BACKEND.GET_STATUS, ...)`
 * after this seeder has run.
 *
 * Transport info is additively included (sidecar-uds for tests by default).
 */
registerMockIpcHandler(BACKEND.GET_STATUS, async () => {
  return {
    status: "connected",
    transport: { mode: "sidecar-uds" as const },
  };
});

/**
 * Sidecar spawn fallback (#439). Only the Electron main process can spawn the
 * intentd sidecar (ipcMain handler in features/backend/main/backend.ipc.ts);
 * in bridge-less builds and tests the mock router answers with the real
 * handler's failure shape so the daemon-loss UI surfaces the error instead of
 * the invoke rejecting. Tests override via `registerMockIpcHandler`.
 */
registerMockIpcHandler(BACKEND.SPAWN_SIDECAR, async () => {
  return {
    ok: false,
    spawned: false,
    reason: "Sidecar spawn is not available in this build",
  };
});
