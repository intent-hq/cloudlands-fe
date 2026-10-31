/**
 * Helpers for main/renderer IPC path-parity contract tests.
 *
 * A renderer `invoke(channel, params)` reaches the daemon through one of two
 * implementations of the same channel: the main-process `ipcMain.handle`
 * handler, or the renderer mock IPC router's seeder handler (which the
 * generated `invoke()` uses in every build, Electron included). When both
 * exist they can drift: cloudlands-fe#3918 shipped a renderer
 * `terminal:createWithCommand` that dropped `env` while the main handler
 * forwarded it, so profile sign-ins logged into the default account.
 *
 * A parity test drives the SAME params through both paths and asserts the
 * daemon JSON-RPC requests they produce are identical. Register each channel
 * with {@link describeParity} — the ledger suite
 * (`src/store/renderer/seeders/ipc-path-parity-ledger.test.ts`) looks for that
 * call to accept the channel as covered.
 *
 * Wiring a parity test:
 *  - Main: mock `electron`'s `ipcMain.handle` to capture handlers, mock the
 *    backend client the handler uses so `request(method, params)` is recorded.
 *  - Renderer: un-mock `$lib/electron-bridge` (test-setup stubs it globally)
 *    with `vi.mock('$lib/electron-bridge', async (importOriginal) => importOriginal())`,
 *    mock `$lib/client/live/backend-transport` so `backendRequest` is
 *    recorded, import the seeder, and call the real bridge `invoke`.
 */
import { describe, expect } from 'vitest';
import { z } from 'zod';

/** One recorded daemon JSON-RPC request: `[method, params]`. */
export type DaemonCall = [method: string, params: unknown];

/** Register a channel's parity suite (the ledger keys on this exact call). */
export function describeParity(channel: string, body: () => void): void {
  describe(`IPC path parity: ${channel}`, body);
}

/**
 * Normalize recorded `request(method, params, ...rest)` calls to
 * `[method, params]`, keeping only the methods under contract — subscription
 * plumbing (`events.subscribe`) differs per path by design.
 */
export function contractCalls(
  calls: readonly unknown[][],
  methods: readonly string[],
): DaemonCall[] {
  return calls
    .filter((call) => typeof call[0] === 'string' && methods.includes(call[0]))
    .map((call) => [call[0] as string, call[1]]);
}

/** Assert both paths sent the daemon the same requests, naming the channel on failure. */
export function expectSameDaemonRequests(
  channel: string,
  main: DaemonCall[],
  renderer: DaemonCall[],
): void {
  expect(main.length, `${channel}: the main path sent no contract requests`).toBeGreaterThan(0);
  expect(
    renderer,
    `${channel}: the renderer mock-router path and the main-process handler sent different ` +
      'daemon requests for the same params. A field one path forwards and the other drops ' +
      'is the cloudlands-fe#3918 bug class — forward it on both paths.',
  ).toEqual(main);
}

/**
 * Assert the parity scenarios exercise every field the main-process schema
 * accepts, so a newly accepted field cannot skip the contract. `exempt` maps a
 * schema key to the reason no scenario sets it.
 */
export function expectSchemaKeysCovered(
  channel: string,
  schema: z.ZodTypeAny,
  inputs: readonly Record<string, unknown>[],
  exempt: Readonly<Record<string, string>> = {},
): void {
  const covered = new Set(inputs.flatMap((input) => Object.keys(input)));
  const missing = Object.keys(objectShape(schema)).filter(
    (key) => !covered.has(key) && !(key in exempt),
  );
  expect(
    missing,
    `${channel}: the main-process schema accepts fields no parity scenario sets. Add a ` +
      'scenario that sets each one so a path that drops it fails.',
  ).toEqual([]);
}

/** The object shape under a schema, unwrapping `.refine()` / `.transform()` effects. */
function objectShape(schema: z.ZodTypeAny): z.ZodRawShape {
  let current = schema;
  while (current instanceof z.ZodEffects) current = current.innerType();
  if (!(current instanceof z.ZodObject)) {
    throw new Error('expectSchemaKeysCovered needs an object schema (optionally refined)');
  }
  return current.shape;
}
