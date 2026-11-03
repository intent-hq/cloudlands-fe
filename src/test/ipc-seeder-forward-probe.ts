/**
 * Runtime probe for renderer mock-router seeders that forward to the main
 * process. Shared by the IPC path-parity ledger and the main-handler
 * reachability check (both under src/store/renderer/seeders/).
 *
 * Callers must load the seeders (`import './index'`) and let them see the real
 * `$lib/electron-bridge` (test-setup stubs it globally):
 * `vi.mock('$lib/electron-bridge', async (importOriginal) => importOriginal());`
 */
import { vi } from 'vitest';
import { mockInvoke } from '$shared/ipc-mock-router';

/** How long the probe waits for a seeder handler before treating it as not forwarding. */
const PROBE_TIMEOUT_MS = 500;

export interface SeederForwardProbe {
  /** The seeder handed the same frozen payload to main on the same channel and returned main's result. */
  verbatim: boolean;
  /** Every channel the seeder invoked on the preload bridge, with any arguments. */
  forwardedChannels: string[];
}

type BridgeWindow = { electronAPI: { invoke: unknown } };

/**
 * Stub the preload bridge, invoke `channel` through the mock router with a
 * unique payload, and record what reached `electronAPI.invoke`. The payload is
 * frozen (an in-place edit throws) and what reaches main is compared with an
 * independently built original, so a seeder that drops or adds a field cannot
 * pass as a verbatim forwarder. Restores the bridge's `invoke` afterwards.
 */
export async function probeSeederForwarding(channel: string): Promise<SeederForwardProbe> {
  const payload = Object.freeze({ parityProbe: channel });
  const original = JSON.stringify({ parityProbe: channel });
  const sentinel = { parityProbeResult: channel };
  const forwarded: unknown[][] = [];
  const bridge = (window as unknown as BridgeWindow).electronAPI;
  const previousInvoke = bridge.invoke;
  bridge.invoke = async (...args: unknown[]) => {
    forwarded.push(args);
    return sentinel;
  };
  let result: unknown;
  let threw = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    result = await Promise.race([
      mockInvoke(channel, payload),
      new Promise((resolve) => {
        timer = setTimeout(resolve, PROBE_TIMEOUT_MS);
      }),
    ]);
  } catch {
    threw = true;
  } finally {
    clearTimeout(timer);
    bridge.invoke = previousInvoke;
  }
  const verbatim =
    !threw &&
    result === sentinel &&
    forwarded.some(
      (args) => args[0] === channel && args.length === 2 && JSON.stringify(args[1]) === original,
    );
  const forwardedChannels = [
    ...new Set(forwarded.map(([name]) => name).filter((name) => typeof name === 'string')),
  ] as string[];
  return { verbatim, forwardedChannels };
}

/**
 * Run `body` as the packaged Electron renderer: some seeders forward only when
 * the user agent says Electron (`expectsElectronPreloadBridge`).
 */
export async function withElectronUserAgent<T>(body: () => Promise<T>): Promise<T> {
  const userAgent = vi
    .spyOn(navigator, 'userAgent', 'get')
    .mockReturnValue(`${navigator.userAgent} Electron/39.0.0`);
  try {
    return await body();
  } finally {
    userAgent.mockRestore();
  }
}
