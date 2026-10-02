export declare function waitForSidebarRequest(
  requested: Promise<void>,
  preparation: Promise<unknown>,
  timeoutMs: number,
): Promise<void>;
