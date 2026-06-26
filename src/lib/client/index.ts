/**
 * AppClient seam entry point.
 *
 * Exposes the domain contract types and a single process-wide `appClient`
 * singleton. It is backed by `LiveAppClient`, which implements migrated domains
 * against the live intentd daemon (via the JSON-RPC IPC bridge) and delegates
 * the remaining domains to an internal `MockAppClient`. Each later wave migrates
 * one more domain until the mock delegate can be removed entirely.
 */
import type { AppClient } from "./app-client";
import { LiveAppClient } from "./live/live-app-client";

export * from "./app-client";
export { MockAppClient } from "./mock/mock-app-client";
export { LiveAppClient } from "./live/live-app-client";

/** The single boundary the renderer uses to reach "the backend". */
export const appClient: AppClient = new LiveAppClient();
