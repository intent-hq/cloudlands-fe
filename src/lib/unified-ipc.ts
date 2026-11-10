/**
 * Unified window (Labs) IPC. Its state is main-owned, so calls go straight through
 * the preload bridge (like the dock lab) rather than the mock IPC router, which
 * only reaches main for channels a seeder bridges. Without a bridge (web build,
 * tests) calls reject.
 */
interface BridgeLike {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
}

export async function unifiedInvoke<T>(channel: string, payload: unknown = {}): Promise<T> {
  const bridge = (globalThis as { electronAPI?: BridgeLike }).electronAPI;
  if (!bridge) throw new Error('Electron bridge unavailable');
  return (await bridge.invoke(channel, payload)) as T;
}
