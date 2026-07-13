/**
 * AppClient seam entry point.
 *
 * Exposes the domain contract types and a single process-wide `appClient`
 * singleton backed by `LiveAppClient`, which implements all domains against
 * the live intentd daemon via the JSON-RPC IPC bridge.
 */
import type { AppClient } from "./app-client";
import { LiveAppClient } from "./live/live-app-client";

export * from "./app-client";
export { MockAppClient } from "./mock/mock-app-client";
export { LiveAppClient } from "./live/live-app-client";

/** The single boundary the renderer uses to reach "the backend". */
export const appClient: AppClient = new LiveAppClient();
