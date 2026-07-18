/**
 * Backend status IPC bridge — provides daemon connection status to renderer.
 *
 * Bridges `backend:get-status` and `backend:status` (emitted events) to keep
 * the FE informed of the main process's JSON-RPC client connection state.
 * The daemon-health middleware polls `backend:get-status` and subscribes
 * to `backend:status` events to track health.
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
