// @verify-changed-triggers: src/**, e2e/**, scripts/**, cdp-mcp-server/**
/**
 * Main-process IPC handler reachability.
 *
 * The generated `invoke()` routes every renderer call through the renderer
 * mock router, in every build, Electron included. A main-process
 * `ipcMain.handle(CHANNEL, …)` handler therefore runs only when something
 * calls the preload bridge (`window.electronAPI.invoke`) on CHANNEL:
 *  1. a renderer seeder that forwards to main — probed at runtime here;
 *  2. code that calls the bridge directly — scanned statically across
 *     src/, e2e/, scripts/ and cdp-mcp-server/ by string literal, channel
 *     constant, or a wrapper listed in KNOWN_BRIDGE_WRAPPERS.
 * A main handler with neither can never run. Proving that used to mean a
 * manual search (cloudlands-fe#3965 retired 16 such handlers and found
 * `workspace:clear-recent-repositories` by chance). This suite fails when a
 * new unreachable handler appears; today's are frozen in UNREACHABLE_LEGACY,
 * which may only shrink.
 *
 * The scanner errs toward "unreachable": a caller it cannot see makes this
 * suite fail rather than pass. So before deleting a UNREACHABLE_LEGACY
 * handler, still grep for the channel once — and if the scan missed a real
 * caller, teach scanDirectBridgeCallers() (src/test/ipc-channel-source-scan.ts)
 * that spelling instead of keeping the entry.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it, vi } from 'vitest';

// test-setup stubs the bridge globally; the probe needs seeders to see the
// real bridge (e.g. `isElectron()` reads `window.electronAPI`).
vi.mock('$lib/electron-bridge', async (importOriginal) => importOriginal());

import './index';
import { getRegisteredMockIpcChannels } from '$shared/ipc-mock-router';
import {
  type KnownBridgeWrapper,
  readBridgeCallerSources,
  scanDirectBridgeCallers,
  scanMainInvokeHandlers,
} from '../../../test/ipc-channel-source-scan';
import {
  probeSeederForwarding,
  withElectronUserAgent,
} from '../../../test/ipc-seeder-forward-probe';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const SEEDERS_DIR = 'src/store/renderer/seeders/';
const BROWSER_URL_RESOLUTION = 'src/lib/utils/browser-url-resolution.ts';

/**
 * Bridge calls whose channel is a parameter, keyed by the file holding the
 * call. Each names where its channels come from: `channelFiles` (every channel
 * token in those files counts) and/or `callers` (exported wrapper functions
 * whose call sites' first argument counts). Seeder forwards are exempt: the
 * runtime probe observes them.
 */
const KNOWN_BRIDGE_WRAPPERS: ReadonlyMap<string, KnownBridgeWrapper> = new Map([
  [
    'src/features/dev-console/dev-console-client.ts',
    {
      reason: '`devConsoleInvoke(channel, request)` is the Dev Console window bridge.',
      channelFiles: ['src/features/dev-console/dev-console-client.ts'],
      callers: ['devConsoleInvoke'],
    },
  ],
  [
    'src/features/hud/components/dock-annotation-overlay-bridge.ts',
    {
      reason: '`call(channel, payload, fallback)` forwards the annotation overlay channels.',
      channelFiles: ['src/features/hud/components/dock-annotation-overlay-bridge.ts'],
    },
  ],
  [
    'src/features/hud/composer/dock-evidence-native.ts',
    {
      reason: '`nativeInvoke(channel, request)` forwards the dock evidence channels.',
      channelFiles: ['src/features/hud/composer/dock-evidence-native.ts'],
    },
  ],
  [
    'src/features/providers/provider-models.client.ts',
    {
      reason: '`invokeModelChannel` sends each provider `*:get-models` channel to main.',
      channelFiles: ['src/features/providers/provider-models.client.ts'],
    },
  ],
  [
    'src/store/renderer/slices/proposal-lifecycle/sagas/workspace-transfer-proposal.ts',
    {
      reason: '`invokeTransfer(channel, params)` sends transfer channels to main.',
      channelFiles: [
        'src/store/renderer/slices/proposal-lifecycle/sagas/workspace-transfer-proposal.ts',
      ],
    },
  ],
  [
    'src/store/renderer/slices/workspace-transfer/sagas/workspace-transfer-saga.ts',
    {
      reason: '`invokeTransfer(channel, params)` sends transfer channels to main.',
      channelFiles: [
        'src/store/renderer/slices/workspace-transfer/sagas/workspace-transfer-saga.ts',
      ],
    },
  ],
  [
    'src/store/renderer/slices/workspace-import/sagas/workspace-import-saga.ts',
    {
      reason: '`invokeImport(channel, params)` sends import channels to main.',
      channelFiles: ['src/store/renderer/slices/workspace-import/sagas/workspace-import-saga.ts'],
    },
  ],
  [
    'src/lib/utils/browser-link-open.ts',
    {
      reason: 'Hands `window.electronAPI.invoke` to the browser URL resolver.',
      channelFiles: [BROWSER_URL_RESOLUTION],
    },
  ],
  [
    'src/lib/components/terminal/QuakeTerminalOverlay.svelte',
    {
      reason: 'Hands `window.electronAPI.invoke` to the browser URL resolver.',
      channelFiles: [BROWSER_URL_RESOLUTION],
    },
  ],
  [
    'src/store/renderer/slices/panel-layout/sagas/panel-layout-saga.ts',
    {
      reason: 'Hands `window.electronAPI.invoke` to the browser URL resolver.',
      channelFiles: [BROWSER_URL_RESOLUTION],
    },
  ],
]);

/**
 * Seeders that forward to main only for some payloads, so the probe's
 * synthetic payload does not trigger the forward. Each reason names the
 * condition. Remove an entry when its seeder forwards unconditionally.
 */
const CONDITIONAL_FORWARDERS: ReadonlyMap<string, string> = new Map([
  [
    'file:read',
    'file-bridge-seeder forwards only `encoding: "base64"` host-file reads to main; text reads go to the daemon `file.read`.',
  ],
]);

/**
 * Main handlers no caller could reach when this check landed. FROZEN: never
 * add an entry. Remove one by deleting the dead main handler (first confirm no
 * caller the scanner missed), or by giving it a real caller.
 */
const UNREACHABLE_LEGACY: ReadonlySet<string> = new Set([
  'accept-changes:check-path-has-changes',
  'agent:circuit-breaker:reset',
  'agent:context:getBySession',
  'agent:context:getByWorkspace',
  'agent:context:update',
  'app:name',
  'app:path',
  'app:root',
  'app:set-badge',
  'app:version',
  'auggie:extract-file-changes',
  'auggie:get-latest-session',
  'auggie:get-path',
  'auggie:get-user-info',
  'auggie:uninstall-mcp-claude-code',
  'auggie:uninstall-mcp-codex',
  'auggie:uninstall-mcp-cortex',
  'auggie:uninstall-mcp-droid',
  'auggie:uninstall-mcp-opencode',
  'auggie:uninstall-mcp-pi',
  'browser:exec',
  'browser:unregister-tab',
  'config:get',
  'config:get-all',
  'config:set',
  'debug:list-agents',
  'debug:trigger-backend-resume',
  'deep-link:handle',
  'editor:get-selection',
  'events:emit',
  'events:get-agent-subscriptions',
  'events:subscribe',
  'events:unsubscribe',
  'export:chat-to-html',
  'file:getGitStatus',
  'file:getGitignorePatterns',
  'file:getTreeWithSizes',
  'file:list',
  'file:mkdir',
  'file:read-batch',
  'file:readDirWithStats',
  'first-visit-state:delete',
  'first-visit-state:exists',
  'first-visit-state:load',
  'first-visit-state:save',
  'generate_pr_content',
  'get_home_directory',
  'get_workspace_changes',
  'log:clear',
  'log:export-debug-bundle',
  'log:paths',
  'log:read',
  'log:summary',
  'log:track-agent-event',
  'log:track-file-change',
  'log:track-mcp-call',
  'resolve_merge_conflicts',
  'rules:get-context',
  'rules:list',
  'rules:load-workspace',
  'setup-scripts:detect-type',
  'setup-scripts:generate',
  'shell:openPath',
  'specialists:delete-file',
  'specialists:export-builtin',
  'specialists:file-exists',
  'specialists:get-folder-path',
  'specialists:list-all',
  'specialists:list-bundled',
  'specialists:list-files',
  'specialists:read-file',
  'specialists:write-file',
  'system:execute-command',
  'system:execute-command-streaming',
  'system:home-directory',
  'system:write-clipboard',
  'terminal:createWithCommand',
  'terminal:professional:create',
  'terminal:professional:dispose',
  'terminal:professional:get-buffer',
  'terminal:professional:info',
  'terminal:professional:list',
  'terminal:professional:refresh',
  'terminal:professional:resize',
  'terminal:professional:write',
  'universal-agent:enhancePrompt',
  'user-activity:get-note-read-status',
  'user-mcp:check-auth',
  'user-mcp:test-connection',
  'user-rules:delete-by-type',
  'user-rules:export',
  'user-rules:export-by-type',
  'user-rules:get-all',
  'user-rules:get-available-types',
  'user-rules:get-by-type',
  'user-rules:get-combined-prompt',
  'user-rules:get-formatted',
  'user-rules:get-formatted-by-type',
  'user-rules:import',
  'user-rules:set-enabled',
  'user-rules:set-enabled-by-type',
  'user-rules:update',
  'user-rules:update-by-type',
  'vscode:open-diff',
  'window:create',
  'window:maximize',
  'window:minimize',
  'workspace:activate',
  'workspace:backup',
  'workspace:cleanup',
  'workspace:clear-recent',
  'workspace:close',
  'workspace:delete',
  'workspace:duplicate',
  'workspace:export',
  'workspace:find-repositories',
  'workspace:get-by-id',
  'workspace:get-current',
  'workspace:get-hover-status',
  'workspace:get-metadata',
  'workspace:get-recent',
  'workspace:get-root',
  'workspace:get-settings',
  'workspace:get-stats',
  'workspace:get-tasks',
  'workspace:getSettings',
  'workspace:import',
  'workspace:list-files',
  'workspace:load-rules',
  'workspace:rename',
  'workspace:repair',
  'workspace:restore',
  'workspace:save',
  'workspace:search-in-files',
  'workspace:unarchive',
  'workspace:update',
  'workspace:update-current-context',
  'workspace:update-metadata',
  'workspace:update-spec-watcher-timestamp',
  'workspace:updateSettings',
  'workspace:update_git_info',
  'workspace:validate',
  'write_file',
]);

/** Ceiling for UNREACHABLE_LEGACY — lower it as entries leave; never raise it. */
const UNREACHABLE_LEGACY_CEILING = 143;

const mainScan = scanMainInvokeHandlers(path.join(PACKAGE_ROOT, 'src'));
const bridgeSources = readBridgeCallerSources(PACKAGE_ROOT);
const bridgeScan = scanDirectBridgeCallers(bridgeSources, KNOWN_BRIDGE_WRAPPERS);
const seederChannels = new Set(getRegisteredMockIpcChannels());
const mainChannels = [...mainScan.handled.keys()].sort();

describe('main-process IPC handler reachability', () => {
  /** Channel → seeder channels whose handler forwarded to it during the probe. */
  const forwardedBy = new Map<string, string[]>();

  beforeAll(async () => {
    await withElectronUserAgent(async () => {
      for (const channel of mainChannels.filter((c) => seederChannels.has(c))) {
        for (const target of (await probeSeederForwarding(channel)).forwardedChannels) {
          forwardedBy.set(target, [...(forwardedBy.get(target) ?? []), channel]);
        }
      }
    });
  });

  const unreachable = () =>
    mainChannels.filter(
      (channel) =>
        !bridgeScan.called.has(channel) &&
        !forwardedBy.has(channel) &&
        !CONDITIONAL_FORWARDERS.has(channel),
    );

  it('scanner sanity: finds known direct callers, wrappers, and forwarders', () => {
    expect(mainScan.unresolved).toEqual([]);
    expect(bridgeSources.some((entry) => entry.file.startsWith('e2e/'))).toBe(true);
    // Literal call from an e2e build-smoke helper.
    expect(bridgeScan.called.get('backend:request')).toEqual(
      expect.arrayContaining([expect.stringMatching(/^e2e\/build-smoke-helpers\.ts:/)]),
    );
    // Group-alias constant (`BACKEND.GET_STATUS`) from a saga.
    expect(bridgeScan.called.has('backend:get-status')).toBe(true);
    // Saga context call: `call([api, api.invoke], CONNECTIONS.REFRESH_SELF)`.
    expect(bridgeScan.called.has('connections:refresh-self')).toBe(true);
    // Known wrapper called from another file.
    expect(bridgeScan.called.has('dev-console:read')).toBe(true);
    // Seeder probed at runtime.
    expect(forwardedBy.get('window:set-title')).toContain('window:set-title');
  });

  it('every dynamic bridge call outside the seeders is a known wrapper', () => {
    const unknown = [...bridgeScan.dynamicSites]
      .filter(([file]) => !file.startsWith(SEEDERS_DIR) && !KNOWN_BRIDGE_WRAPPERS.has(file))
      .flatMap(([, sites]) => sites);
    expect(
      unknown,
      'These call (or hand off) `electronAPI.invoke` with a channel the scanner cannot name, so ' +
        'the main handlers they reach look unreachable. Pass the channel as a literal or ' +
        'IPC_CHANNELS constant, or list the file in KNOWN_BRIDGE_WRAPPERS with where its ' +
        'channels come from.',
    ).toEqual([]);
    const stale = [...KNOWN_BRIDGE_WRAPPERS.keys()].filter(
      (file) => !bridgeScan.dynamicSites.has(file),
    );
    expect(
      stale,
      'KNOWN_BRIDGE_WRAPPERS entries with no dynamic bridge call — remove them.',
    ).toEqual([]);
  });

  it('every main handler has a direct caller or a forwarding seeder', () => {
    const offenders = unreachable().filter((channel) => !UNREACHABLE_LEGACY.has(channel));
    expect(
      offenders.map((channel) => `${channel} (main: ${mainScan.handled.get(channel)!.join(', ')})`),
      'These main-process handlers can never run: no code calls `window.electronAPI.invoke` on ' +
        'their channel and no renderer seeder forwards it to main (the generated `invoke()` ' +
        'stops at the renderer mock router). Delete the dead handler, or forward the channel ' +
        'from its seeder. Never add to UNREACHABLE_LEGACY.',
    ).toEqual([]);
  });

  it('ledger entries are not stale', () => {
    const handled = new Set(mainChannels);
    const unreachableNow = new Set(unreachable());
    expect(
      [...UNREACHABLE_LEGACY].filter((channel) => !unreachableNow.has(channel)),
      'These UNREACHABLE_LEGACY handlers are gone or now reachable — remove them and lower ' +
        'UNREACHABLE_LEGACY_CEILING.',
    ).toEqual([]);
    expect(
      [...CONDITIONAL_FORWARDERS.keys()].filter(
        (channel) =>
          !handled.has(channel) ||
          !seederChannels.has(channel) ||
          bridgeScan.called.has(channel) ||
          forwardedBy.has(channel),
      ),
      'These CONDITIONAL_FORWARDERS entries are unhandled, unseeded, or already found by the ' +
        'scan or probe — remove them.',
    ).toEqual([]);
  });

  it('UNREACHABLE_LEGACY only shrinks', () => {
    expect(
      UNREACHABLE_LEGACY.size,
      'UNREACHABLE_LEGACY is frozen debt. Do not add entries; when one leaves, lower ' +
        'UNREACHABLE_LEGACY_CEILING to match.',
    ).toBeLessThanOrEqual(UNREACHABLE_LEGACY_CEILING);
    expect(
      UNREACHABLE_LEGACY_CEILING - UNREACHABLE_LEGACY.size,
      'Lower the ceiling to the size.',
    ).toBe(0);
  });
});
