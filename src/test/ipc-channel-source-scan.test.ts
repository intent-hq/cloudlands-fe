// @verify-changed-exempt: reads only the temp directories it creates
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type BridgeSourceFile,
  type KnownBridgeWrapper,
  readBridgeCallerSources,
  scanDirectBridgeCallers,
  scanMainInvokeHandlers,
} from './ipc-channel-source-scan';

function scan(
  files: Record<string, string>,
  wrappers: ReadonlyMap<string, KnownBridgeWrapper> = new Map(),
) {
  const sources: BridgeSourceFile[] = Object.entries(files).map(([file, source]) => ({
    file,
    source,
  }));
  return scanDirectBridgeCallers(sources, wrappers);
}

describe('scanDirectBridgeCallers', () => {
  it('resolves literal, registry, and alias channels in every bridge spelling', () => {
    const { called, dynamicSites } = scan({
      'src/a.ts': [
        "import { IPC_CHANNELS, WINDOW_CHANNELS } from '$shared/ipc-registry';",
        'const BACKEND = IPC_CHANNELS.BACKEND;',
        "await window.electronAPI.invoke('alpha:one', {});",
        'await window.electronAPI?.invoke(IPC_CHANNELS.WINDOW.SET_TITLE, { title });',
        'await (window as any).electronAPI.invoke(WINDOW_CHANNELS.GET_ZOOM_FACTOR);',
        'await window.electronAPI!.invoke<{ data?: Record<string, unknown> }>(',
        '  BACKEND.GET_STATUS,',
        ');',
        'await electronAPI().invoke(BACKEND.REPOSITORY.RELEASE, { id });',
      ].join('\n'),
    });
    expect([...called.keys()].sort()).toEqual([
      'alpha:one',
      'backend:get-status',
      'backend:repository:release',
      'window:get-zoom-factor',
      'window:set-title',
    ]);
    expect(called.get('backend:get-status')).toEqual(['src/a.ts:6']);
    expect(dynamicSites.size).toBe(0);
  });

  it('follows bridge locals, ternaries, rebound group locals, and saga context calls', () => {
    const { called, dynamicSites } = scan({
      'src/b.ts': [
        'const BACKEND = IPC_CHANNELS.BACKEND;',
        'const CONNECTIONS = IPC_CHANNELS.CONNECTIONS;',
        "const RESOLVE_CHANNEL = 'browser:resolve-url';",
        'function one() {',
        '  const api = typeof window !== "undefined" ? window.electronAPI : undefined;',
        '  const channels = BACKEND.REPOSITORY_SELECTION;',
        '  return api.invoke(channels.CONFIRM, {});',
        '}',
        'function two(bridge: Window["electronAPI"]) {',
        '  const channels = BACKEND.REPOSITORY_CHECKOUT;',
        '  return bridge.invoke(isGet ? CONNECTIONS.GET_TUNNEL : CONNECTIONS.SET_TUNNEL, channels.REQUEST);',
        '}',
        'function* three(api) {',
        '  yield* call([api, api.invoke], CONNECTIONS.REFRESH_SELF);',
        '  return api.invoke(RESOLVE_CHANNEL, url);',
        '}',
      ].join('\n'),
    });
    expect([...called.keys()].sort()).toEqual([
      'backend:repository-selection:confirm',
      'browser:resolve-url',
      'connections:get-tunnel',
      'connections:refresh-self',
      'connections:set-tunnel',
    ]);
    expect(dynamicSites.size).toBe(0);
  });

  it('ignores comments, mock-router clients, feature tests, and files that never name the bridge', () => {
    const { called, dynamicSites } = scan({
      'src/c.ts': [
        '// window.electronAPI.invoke("commented:out")',
        ' * window.electronAPI.invoke("doc:comment")',
        "this.invoke('git:push', {});",
        "TypedIpcClient.invoke('agent:create', data);",
        'if (!window.electronAPI?.invoke) return;',
        "if (typeof bridge.invoke === 'function') return;",
        'const ok = isElectron() && window.electronAPI?.invoke;',
      ].join('\n'),
      'src/no-bridge.ts': "client.invoke('never:bridge');",
    });
    expect([...called.keys()]).toEqual([]);
    expect(dynamicSites.size).toBe(0);
  });

  it('counts only receivers bound to the bridge, not other invoke clients in the same file', () => {
    const { called } = scan({
      'src/mixed.ts': [
        'const api = window.electronAPI;',
        "await api.invoke('demo:live-local');",
        "await client.invoke('demo:mock-router');",
        "await mockClient?.invoke('demo:mock-optional');",
      ].join('\n'),
      'src/getter.ts': [
        "function getApi(): Window['electronAPI'] | undefined {",
        "  return typeof window !== 'undefined' ? window.electronAPI : undefined;",
        '}',
        'const bridge =',
        "  typeof window !== 'undefined' && isElectron()",
        '    ? getApi()',
        '    : undefined;',
        "await bridge.invoke('demo:live-getter');",
        "await getApi()?.invoke('demo:live-getter-call');",
        "const other = createClient('x');",
        "await other.invoke('demo:mock-other');",
      ].join('\n'),
      'src/typed.ts': [
        'export interface IpcLike { invoke(channel: string): Promise<unknown> }',
        'export function getOwnerBridge(): IpcLike | null {',
        '  return (globalThis as { electronAPI?: IpcLike }).electronAPI ?? null;',
        '}',
        'export async function query(ipc: IpcLike) {',
        "  return ipc.invoke('demo:live-typed');",
        '}',
        "export function forward(target: Window['electronAPI'], rpc: RpcClient) {",
        "  target.invoke('demo:live-param');",
        "  rpc.invoke('demo:mock-param');",
        '}',
      ].join('\n'),
    });
    expect([...called.keys()].sort()).toEqual([
      'demo:live-getter',
      'demo:live-getter-call',
      'demo:live-local',
      'demo:live-param',
      'demo:live-typed',
    ]);
  });

  it('reports dynamic calls and handoffs, and resolves them through known wrappers', () => {
    const files = {
      'src/wrapper.ts': [
        'export async function devInvoke(channel: string, request: unknown) {',
        '  return window.electronAPI.invoke(channel, request);',
        '}',
        "export const open = () => devInvoke('dev:open', {});",
      ].join('\n'),
      'src/caller.ts': [
        "import { devInvoke } from './wrapper';",
        "await devInvoke<{ ok: boolean }>('dev:read', { id });",
        'yield* call(devInvoke, IPC_CHANNELS.WINDOW.CLOSE, {});',
      ].join('\n'),
      'src/handoff.ts': 'resolveLink(url, window.electronAPI?.invoke);',
      'src/resolver.ts': "export const CHANNEL = 'browser:resolve-url';",
    };
    const unresolved = scan(files);
    expect([...unresolved.called.keys()]).toEqual([]);
    expect(Object.fromEntries(unresolved.dynamicSites)).toEqual({
      'src/wrapper.ts': ['src/wrapper.ts:2 :: channel'],
      'src/handoff.ts': ['src/handoff.ts:1 :: handoff'],
    });

    const resolved = scan(
      files,
      new Map<string, KnownBridgeWrapper>([
        [
          'src/wrapper.ts',
          { reason: 'test', channelFiles: ['src/wrapper.ts'], callers: ['devInvoke'] },
        ],
        ['src/handoff.ts', { reason: 'test', channelFiles: ['src/resolver.ts'] }],
      ]),
    );
    expect([...resolved.called.keys()].sort()).toEqual([
      'browser:resolve-url',
      'dev:open',
      'dev:read',
      'window:close',
    ]);
    expect(resolved.called.get('dev:read')).toEqual(['src/caller.ts (via devInvoke)']);
  });
});

describe('main handler reachability from a package tree', () => {
  let root: string | undefined;
  afterEach(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
    root = undefined;
  });

  function write(relative: string, source: string) {
    const absolute = path.join(root!, relative);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, source);
  }

  function unreachable(): string[] {
    const handled = scanMainInvokeHandlers(path.join(root!, 'src')).handled;
    const { called } = scanDirectBridgeCallers(readBridgeCallerSources(root!));
    return [...handled.keys()].filter((channel) => !called.has(channel)).sort();
  }

  it('flags a new ipcMain.handle with no caller, and only test files calling it do not count', () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ipc-reachability-'));
    write(
      'src/features/demo/main/demo.ipc.ts',
      [
        "ipcMain.handle('demo:live', async () => true);",
        "ipcMain.handle('demo:e2e-only', async () => true);",
        "ipcMain.handle('demo:script-only', async () => true);",
        "ipcMain.handle('demo:dead', async () => true);",
      ].join('\n'),
    );
    write('src/features/demo/demo.client.ts', "window.electronAPI.invoke('demo:live');");
    write('e2e/demo-helpers.ts', "await (window as any).electronAPI.invoke('demo:e2e-only');");
    write(
      'scripts/demo.mjs',
      "await page.evaluate(() => window.electronAPI.invoke('demo:script-only'));",
    );
    write('src/features/demo/demo.test.ts', "window.electronAPI.invoke('demo:dead');");
    write('src/features/demo/__tests__/fixture.ts', "window.electronAPI.invoke('demo:dead');");
    write('src/features/demo/Demo.preview.svelte', "window.electronAPI.invoke('demo:dead');");
    expect(unreachable()).toEqual(['demo:dead']);

    write('cdp-mcp-server/tools.ts', "await evaluate(`window.electronAPI.invoke('demo:dead')`);");
    expect(unreachable()).toEqual([]);
  });
});
