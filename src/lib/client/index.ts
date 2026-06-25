/**
 * AppClient seam entry point.
 *
 * Exposes the domain contract types and a single process-wide `appClient`
 * singleton. Today it is backed by the in-memory `MockAppClient`; swapping in a
 * future `WebSocketAppClient` only requires changing the singleton wiring here.
 */
import type { AppClient } from "./app-client";
import { MockAppClient } from "./mock/mock-app-client";

export * from "./app-client";
export { MockAppClient } from "./mock/mock-app-client";

/** The single boundary the renderer uses to reach "the backend". */
export const appClient: AppClient = new MockAppClient();
