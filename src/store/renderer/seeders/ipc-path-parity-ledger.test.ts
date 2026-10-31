// @verify-changed-triggers: src/main/**, src/features/**/main/**, src/**/*.ipc.ts,
// src/store/renderer/seeders/**, src/**/*-ipc-path-parity.test.ts, src/shared/ipc-registry.ts,
// src/shared/ipc/**, src/test/ipc-channel-source-scan.ts
/**
 * Main/renderer IPC path-parity ledger (cloudlands-fe#3918).
 *
 * Many channels have TWO implementations: a main-process `ipcMain.handle`
 * handler and a renderer mock-router seeder handler — and the generated
 * `invoke()` routes through the seeder in every build, Electron included.
 * When the seeder reimplements the daemon call instead of forwarding to main,
 * the two can drift: the renderer `terminal:createWithCommand` dropped `env`
 * while main forwarded it, so profile sign-ins hit the default account.
 *
 * This suite finds every shared channel (statically scanned `ipcMain.handle`
 * registrations ∩ the channels the seeders register) and requires each to be
 * one of:
 *  1. a verbatim forwarder — probed here: the seeder hands the same params to
 *     `window.electronAPI.invoke` on the same channel, so main does the work;
 *  2. covered by a parity suite (`describeParity` from src/test/ipc-path-parity.ts)
 *     that sends the same params through both paths and compares the daemon
 *     requests — listed in PARITY_SUITES;
 *  3. an intentional difference, justified in DIVERGENT;
 *  4. frozen pre-existing debt in UNCHECKED_LEGACY (entries only leave).
 * A new shared channel that is none of these fails.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// test-setup stubs the bridge globally; the probe needs seeders to see the
// real bridge (e.g. `isElectron()` reads `window.electronAPI`).
vi.mock('$lib/electron-bridge', async (importOriginal) => importOriginal());

import './index';
import {
  getRegisteredMockIpcChannels,
  mockInvoke,
  registerMockIpcHandler,
  unregisterMockIpcHandler,
} from '$shared/ipc-mock-router';
import {
  collectGroupAliases,
  resolveChannelArgument,
  scanMainInvokeHandlers,
} from '../../../test/ipc-channel-source-scan';

const SRC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** Shared channel → parity suite (path relative to `src/`) that calls `describeParity(channel, …)`. */
const PARITY_SUITES: ReadonlyMap<string, string> = new Map([
  ['terminal:createWithCommand', 'features/terminal/terminal-ipc-path-parity.test.ts'],
  ['terminal:professional:write', 'features/terminal/terminal-ipc-path-parity.test.ts'],
  ['system:execute-command', 'features/system/system-ipc-path-parity.test.ts'],
]);

/** Shared channels whose paths differ on purpose; each reason says why that is safe. */
const DIVERGENT: ReadonlyMap<string, string> = new Map([
  ['antigravity:close-setup', 'Forwards to main without the payload; the main handler takes none.'],
  ['notification:test', 'Forwards to main without the payload; the main handler takes none.'],
  [
    'notification:requestPermission',
    'Forwards to main without the payload; the main handler takes none.',
  ],
  [
    'system:list-fonts',
    'Forwards `{}` to main; the main handler validates EmptySchema and takes no fields.',
  ],
  [
    'window:open-new',
    'Forwards a sanitized `{ route, requestId }` to main — every WindowOpenNewSchema field.',
  ],
]);

/**
 * Pre-existing renderer reimplementations of a main-handled channel with no
 * parity suite yet, snapshotted when this check landed. FROZEN: never add an
 * entry. Remove one by writing a parity suite, making the seeder forward to
 * main, retiring one side, or moving it to DIVERGENT with a confirmed reason.
 * Many are likely by-design differences (bridge-less stand-ins that return
 * "not available in this build", or main handlers that use local OS
 * resources the renderer reaches through the daemon); the best parity
 * candidates are the channels where both sides call the daemon, such as
 * `presence:report` (presence.update) and the provider `*:get-models`
 * channels.
 */
const UNCHECKED_LEGACY: ReadonlySet<string> = new Set([
  'agent:get-active-streams',
  'antigravity:get-models',
  'auggie:authenticate',
  'auggie:get-models',
  'auggie:install',
  'backend:get-sidecar-run-log',
  'backend:get-status',
  'backend:node-capabilities',
  'backend:open-local-and-spawn',
  'backend:read-principal',
  'backend:restart-orphaned-sidecar',
  'backend:spawn-sidecar',
  'claude-code:check-availability',
  'claude-code:get-models',
  'codex:check-availability',
  'codex:get-models',
  'connections:add',
  'connections:capture-fingerprint',
  'connections:forget',
  'connections:list',
  'connections:publish-self',
  'connections:refresh-self',
  'connections:self-published-state',
  'connections:sync-get-state',
  'connections:sync-set-enabled',
  'connections:unpublish-self',
  'connections:update-backend',
  'cortex:check-availability',
  'cortex:get-models',
  'droid:check-availability',
  'droid:get-models',
  'external-editors:detect-installed',
  'external-editors:open',
  'external-editors:open-with-other',
  'feature-codes:activate',
  'feature-codes:deactivate',
  'feature-codes:get-active',
  'feature-codes:restart-app',
  'file:copy',
  'file:delete',
  'file:exists',
  'file:getDirectoryStatus',
  'file:move',
  'file:read',
  'file:write',
  'grok:get-models',
  'guest-sessions:leave',
  'guest-sessions:leave-workspace',
  'guest-sessions:list',
  'jetbrains:open',
  'opencode:check-availability',
  'opencode:get-models',
  'panel-layout:load',
  'panel-layout:save',
  'pi:get-models',
  'presence:report',
  'providers:check-single',
  'providers:get-availability',
  'providers:get-paths',
  'shell:openExternal',
  'shell:showItemInFolder',
  'system:check-gh',
  'system:check-git',
  'system:check-node',
  'system:check-rtk',
  'unsloth:get-models',
  'vscode:open',
  'vscode:open-git-diff',
  'vscode:openFile',
  'workspace:add-recent-repository',
  'workspace:get',
  'workspace:get-diff-summary',
  'workspace:get-git-summary',
  'workspace:get-recent-repositories',
  'workspace:list',
  'workspace:open',
  'workspace:remove-recent-repository',
  'workspace:rename-branch',
  'workspace:update-settings',
  'xcode:open',
]);

/** Ceiling for UNCHECKED_LEGACY — lower it as entries leave; never raise it. */
const UNCHECKED_LEGACY_CEILING = 80;

/** How long the probe waits for a seeder handler before treating it as not forwarding. */
const PROBE_TIMEOUT_MS = 500;

const DESCRIBE_PARITY_RE = /\bdescribeParity\(\s*([^,\n)]+)/g;

const mainScan = scanMainInvokeHandlers(SRC_ROOT);
const rendererChannels = new Set(getRegisteredMockIpcChannels());
const sharedChannels = [...mainScan.handled.keys()].filter((c) => rendererChannels.has(c)).sort();

/**
 * Probe whether the seeder for `channel` forwards verbatim to main: stub the
 * preload bridge, invoke with a unique payload, and require the same channel
 * and payload to reach `electronAPI.invoke` and its result to come back.
 * The payload is frozen (an in-place edit throws) and what reaches main is
 * compared with an independently built original, so a seeder that drops or
 * adds a field cannot pass as a forwarder.
 */
async function forwardsVerbatimToMain(channel: string): Promise<boolean> {
  const payload = Object.freeze({ parityProbe: channel });
  const original = JSON.stringify({ parityProbe: channel });
  const sentinel = { parityProbeResult: channel };
  const forwarded: unknown[][] = [];
  const bridge = (window as unknown as { electronAPI: { invoke: unknown } }).electronAPI;
  bridge.invoke = async (...args: unknown[]) => {
    forwarded.push(args);
    return sentinel;
  };
  let result: unknown;
  try {
    result = await Promise.race([
      mockInvoke(channel, payload),
      new Promise((resolve) => setTimeout(resolve, PROBE_TIMEOUT_MS)),
    ]);
  } catch {
    return false;
  }
  return (
    result === sentinel &&
    forwarded.some(
      (args) => args[0] === channel && args.length === 2 && JSON.stringify(args[1]) === original,
    )
  );
}

/** Channels `describeParity(...)` registers in one parity suite file. */
function parityChannelsIn(relativeFile: string): Set<string> {
  const absolute = path.join(SRC_ROOT, relativeFile);
  if (!fs.existsSync(absolute)) return new Set();
  const source = fs.readFileSync(absolute, 'utf8');
  const aliases = collectGroupAliases(source);
  const channels = new Set<string>();
  for (const match of source.matchAll(DESCRIBE_PARITY_RE)) {
    const { channel } = resolveChannelArgument(match[1].trim(), aliases);
    if (channel) channels.add(channel);
  }
  return channels;
}

describe('IPC path-parity ledger (main handler vs renderer mock-router seeder)', () => {
  const forwarders = new Set<string>();
  const originalInvoke = (window as unknown as { electronAPI: { invoke: unknown } }).electronAPI
    .invoke;

  beforeAll(async () => {
    // Model the packaged Electron renderer: some seeders forward only when the
    // user agent says Electron (`expectsElectronPreloadBridge`).
    const userAgent = vi
      .spyOn(navigator, 'userAgent', 'get')
      .mockReturnValue(`${navigator.userAgent} Electron/39.0.0`);
    try {
      for (const channel of sharedChannels) {
        if (await forwardsVerbatimToMain(channel)) forwarders.add(channel);
      }
    } finally {
      userAgent.mockRestore();
    }
  });

  afterAll(() => {
    (window as unknown as { electronAPI: { invoke: unknown } }).electronAPI.invoke = originalInvoke;
  });

  it('scanner sanity: resolves every ipcMain.handle registration', () => {
    expect(
      mainScan.unresolved,
      'Main-process handler registrations whose channel the scanner cannot name. Extend ' +
        'resolveMainHandlerChannel() in src/test/ipc-channel-source-scan.ts.',
    ).toEqual([]);
    expect(mainScan.handled.size).toBeGreaterThan(250);
    expect(sharedChannels).toContain('terminal:createWithCommand');
  });

  it('probe rejects a seeder that edits the payload before forwarding it', async () => {
    const forward = (channel: string, payload: unknown) =>
      (
        window as unknown as { electronAPI: { invoke: (...a: unknown[]) => unknown } }
      ).electronAPI.invoke(channel, payload);
    const cases: [string, (payload: Record<string, unknown>) => unknown, boolean][] = [
      ['parity-probe:verbatim', (payload) => forward('parity-probe:verbatim', payload), true],
      [
        'parity-probe:drops-field-in-place',
        (payload) => {
          delete payload.parityProbe;
          return forward('parity-probe:drops-field-in-place', payload);
        },
        false,
      ],
      [
        'parity-probe:adds-field-in-place',
        (payload) => {
          payload.extra = true;
          return forward('parity-probe:adds-field-in-place', payload);
        },
        false,
      ],
      [
        'parity-probe:forwards-a-reshaped-copy',
        () => forward('parity-probe:forwards-a-reshaped-copy', {}),
        false,
      ],
    ];
    try {
      for (const [channel, handler] of cases) {
        registerMockIpcHandler(channel, (payload) => handler(payload as Record<string, unknown>));
      }
      const verdicts = [];
      for (const [channel] of cases)
        verdicts.push([channel, await forwardsVerbatimToMain(channel)]);
      expect(verdicts).toEqual(cases.map(([channel, , expected]) => [channel, expected]));
    } finally {
      for (const [channel] of cases) unregisterMockIpcHandler(channel);
    }
  });

  it('probe sanity: detects known verbatim forwarders', () => {
    expect(forwarders).toContain('window:set-title');
    expect(forwarders).not.toContain('terminal:createWithCommand');
  });

  it('every shared channel forwards to main, has a parity suite, or is justified', () => {
    const unclassified = sharedChannels.filter(
      (channel) =>
        !forwarders.has(channel) &&
        !PARITY_SUITES.has(channel) &&
        !DIVERGENT.has(channel) &&
        !UNCHECKED_LEGACY.has(channel),
    );
    expect(
      unclassified.map(
        (channel) => `${channel} (main: ${mainScan.handled.get(channel)!.join(', ')})`,
      ),
      'These channels have a main-process handler AND a renderer seeder handler that does ' +
        'not forward to main verbatim, so the two can drift (cloudlands-fe#3918). Prefer ' +
        'forwarding to `window.electronAPI.invoke(channel, payload)`; otherwise add a ' +
        '`describeParity` suite (src/test/ipc-path-parity.ts) and list it in PARITY_SUITES, ' +
        'or justify the difference in DIVERGENT. Never add to UNCHECKED_LEGACY.',
    ).toEqual([]);
  });

  it('parity suites exist and register their channels', () => {
    const missing = [...PARITY_SUITES].filter(
      ([channel, file]) => !parityChannelsIn(file).has(channel),
    );
    expect(
      missing.map(([channel, file]) => `${channel} → ${file}`),
      'Each PARITY_SUITES entry must name a test file that calls describeParity(<channel>, …).',
    ).toEqual([]);
  });

  it('ledger entries are not stale', () => {
    const shared = new Set(sharedChannels);
    const ledger = [...PARITY_SUITES.keys(), ...DIVERGENT.keys(), ...UNCHECKED_LEGACY];
    const notShared = ledger.filter((channel) => !shared.has(channel));
    expect(
      notShared,
      'Ledger entries for channels that are no longer handled on both paths — remove them.',
    ).toEqual([]);
    const nowForwarding = [...DIVERGENT.keys(), ...UNCHECKED_LEGACY].filter((channel) =>
      forwarders.has(channel),
    );
    expect(
      nowForwarding,
      'These seeders now forward verbatim to main, so they need no ledger entry — remove them.',
    ).toEqual([]);
    const overlapping = [...UNCHECKED_LEGACY].filter(
      (channel) => PARITY_SUITES.has(channel) || DIVERGENT.has(channel),
    );
    expect(overlapping, 'A channel covered elsewhere must leave UNCHECKED_LEGACY.').toEqual([]);
  });

  it('UNCHECKED_LEGACY only shrinks', () => {
    expect(
      UNCHECKED_LEGACY.size,
      'UNCHECKED_LEGACY is frozen debt. Do not add entries; when one leaves, lower ' +
        'UNCHECKED_LEGACY_CEILING to match.',
    ).toBeLessThanOrEqual(UNCHECKED_LEGACY_CEILING);
    expect(UNCHECKED_LEGACY_CEILING - UNCHECKED_LEGACY.size, 'Lower the ceiling to the size.').toBe(
      0,
    );
  });
});
