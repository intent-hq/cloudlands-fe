import { describe, expect, it, vi } from 'vitest';
import { foregroundDocumentUrl, sampleDockForeground } from './dock-shortcut-foreground';

describe('native Figma document identity', () => {
  const app = 'com.figma.Desktop';
  it('keeps the verified file key across rename and selection changes', () => {
    expect(foregroundDocumentUrl('https://www.figma.com/design/AbC123/Old?node-id=1-2', app)).toBe(
      'https://www.figma.com/design/AbC123',
    );
    expect(
      foregroundDocumentUrl('https://www.figma.com/design/AbC123/New?node-id=3-4#other', app),
    ).toBe('https://www.figma.com/design/AbC123');
    expect(foregroundDocumentUrl('https://www.figma.com/design/Other/File', app)).not.toBe(
      foregroundDocumentUrl('https://www.figma.com/design/AbC123/File', app),
    );
  });
  it.each([
    'file:///Applications/Figma.app/index.html',
    'figma://design/AbC123/File',
    'https://www.figma.com/files/recents',
    'https://www.figma.com/design/',
    'https://other.test/design/AbC123/File',
    'https://www.figma.com.evil.test/design/AbC123/File',
    'https://user@www.figma.com/design/AbC123/File',
    'https://www.figma.com:444/design/AbC123/File',
    'https://www.figma.com/design/a%2Fb/File',
  ])('refuses unsupported Figma identity %s', (url) => {
    expect(foregroundDocumentUrl(url, app)).toBeNull();
  });
  it('leaves ordinary browser URLs exact', () => {
    const url = 'https://www.figma.com/design/AbC123/Renamed?node-id=1-2';
    expect(foregroundDocumentUrl(url, 'com.google.Chrome')).toBe(url);
    expect(foregroundDocumentUrl('http://localhost:3000/page?q=1')).toBe(
      'http://localhost:3000/page?q=1',
    );
  });
  it('returns app-only immediately during readiness and accepts a later document sample', async () => {
    const foregroundApp = vi.fn(async () => ({ pid: 1, appId: app }));
    const foregroundContext = vi
      .fn()
      .mockResolvedValueOnce({ pid: 1, urlStatus: 'unavailable' })
      .mockResolvedValueOnce({ pid: 1, url: 'https://www.figma.com/design/AbC123/File' });
    expect(
      (await sampleDockForeground({ foregroundApp, foregroundContext })).snapshot.url,
    ).toBeUndefined();
    expect(
      (await sampleDockForeground({ foregroundApp, foregroundContext })).snapshot.url,
    ).toContain('/design/AbC123');
  });
  it('discards an observation whose app changed during the read', async () => {
    await expect(
      sampleDockForeground({
        foregroundApp: async () => ({ pid: 1, appId: app }),
        foregroundContext: async () => ({
          pid: 2,
          url: 'https://www.figma.com/design/AbC123/File',
        }),
      }),
    ).rejects.toThrow('Foreground observation invalidated');
  });
});

// Exercise the actual main observation consumer with controlled Electron/native edges.
const focus = vi.hoisted(() => {
  const dock = { id: 45, isDestroyed: () => false, getTitle: () => 'Dock' };
  return { dock, current: null as typeof dock | null };
});
vi.mock('electron', () => ({ webContents: { getFocusedWebContents: () => focus.current } }));
vi.mock('./dock-window', () => ({ getDockWindow: () => ({ webContents: focus.dock }) }));
const native = vi.hoisted(() => ({ foregroundApp: vi.fn(), foregroundContext: vi.fn() }));
vi.mock('../features/desktop/main/desktop-native', () => ({
  getDesktopNativeAdapter: () => native,
}));
vi.mock('../features/browser/main/browser.ipc', () => ({ dockServiceAddress: () => null }));
vi.mock('../features/browser/main/embedded-browser-cdp-service', () => ({
  embeddedBrowserCdp: { liveUrlOwners: () => [], focusedTabOwner: () => null },
}));
import { readDockForegroundObservation } from './dock-foreground-observation';

it('main keeps one file identity across delayed readiness, selection and rename, but changes files', async () => {
  native.foregroundApp.mockResolvedValue({
    pid: 123,
    appId: 'com.figma.Desktop',
    appName: 'Figma',
  });
  native.foregroundContext.mockResolvedValueOnce({
    pid: 123,
    title: 'File',
    urlStatus: 'unavailable',
  });
  const pending = await readDockForegroundObservation('local');
  expect(pending).toMatchObject({ identityKind: 'app', url: null, tabTitle: null });
  native.foregroundContext.mockResolvedValueOnce({
    pid: 123,
    title: 'File',
    url: 'https://www.figma.com/design/AbC123/File?node-id=1-2',
  });
  const ready = await readDockForegroundObservation('local');
  expect(ready).toMatchObject({
    identityKind: 'url',
    url: 'https://www.figma.com/design/AbC123',
    tabTitle: 'File',
  });
  native.foregroundContext.mockResolvedValueOnce({
    pid: 123,
    title: 'Renamed',
    url: 'https://www.figma.com/design/AbC123/Renamed?node-id=8-9',
  });
  const renamed = await readDockForegroundObservation('local');
  expect(renamed.identityKey).toBe(ready.identityKey);
  expect(renamed.url).toBe(ready.url);
  native.foregroundContext.mockResolvedValueOnce({
    pid: 123,
    title: 'Other',
    url: 'https://www.figma.com/design/Other/Other',
  });
  expect((await readDockForegroundObservation('local')).identityKey).not.toBe(ready.identityKey);
  native.foregroundContext.mockResolvedValueOnce({
    pid: 123,
    title: 'Shell',
    url: 'file:///Applications/Figma.app/shell.html',
  });
  expect(await readDockForegroundObservation('local')).toMatchObject({
    identityKind: 'app',
    tabTitle: null,
    url: null,
  });
});

import { createDockContextFeed } from './dock-context-feed';
import { dockContextLinkKey } from '../shared/dock-context-links';
import type { DockForegroundObservation } from '../shared/dock-context-links';

it('notch self-focus preserves the verified file link while a newer Chrome scope fences a late Figma read', async () => {
  native.foregroundApp.mockResolvedValue({ pid: 123, appId: 'com.figma.Desktop' });
  native.foregroundContext.mockResolvedValue({
    pid: 123,
    title: 'File',
    url: 'https://www.figma.com/design/AbC123/File?node-id=1-2',
  });
  const figma = await readDockForegroundObservation('local');
  const scope = {};
  const changed = vi.fn();
  let next: Promise<Omit<DockForegroundObservation, 'contextVersion' | 'sequence'>> =
    Promise.resolve(figma);
  const feed = createDockContextFeed({
    scope: () => scope,
    visible: () => true,
    read: () => next,
    changed,
    version: () => 'version',
  });
  feed.start();
  try {
    const ready = await feed.read();
    expect(ready?.identityKind).toBe('url');
    const link = dockContextLinkKey(ready!, 'tab');
    expect(link).not.toBeNull();
    next = Promise.resolve({ ...figma, self: true, url: null, identityKey: 'app:intent' });
    expect(await feed.read()).toBe(ready);
    expect(dockContextLinkKey((await feed.read())!, 'tab')).toBe(link);
    let resolveLate!: (value: typeof figma) => void;
    next = new Promise((resolve) => {
      resolveLate = resolve;
    });
    const late = feed.read();
    const chrome = feed.admit(scope, {
      ...figma,
      self: false,
      appId: 'com.google.Chrome',
      identityKey: 'url:chrome',
      url: 'https://example.test/current',
    });
    resolveLate(figma);
    expect(await late).toBe(chrome);
    expect(changed.mock.calls.at(-1)?.[0]).toBe(chrome);
    expect(dockContextLinkKey(chrome!, 'tab')).not.toBe(link);
  } finally {
    feed.stop();
  }
});

it('retains a verified Figma link when a click focuses the notch during an empty native detail reply', async () => {
  native.foregroundApp.mockResolvedValue({ pid: 123, appId: 'com.figma.Desktop' });
  native.foregroundContext.mockResolvedValue({
    pid: 123,
    title: 'File',
    url: 'https://www.figma.com/design/AbC123/File',
  });
  const scope = {};
  const changed = vi.fn();
  const feed = createDockContextFeed({
    scope: () => scope,
    visible: () => true,
    read: () => readDockForegroundObservation('local'),
    changed,
    version: () => 'version',
  });
  feed.start();
  try {
    const ready = await feed.read();
    expect(ready?.url).toBe('https://www.figma.com/design/AbC123');
    const link = dockContextLinkKey(ready!, 'tab');
    const calls = native.foregroundContext.mock.calls.length;
    let finish!: (value: object) => void;
    native.foregroundContext.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const duringClick = feed.read();
    await vi.waitFor(() => expect(native.foregroundContext).toHaveBeenCalledTimes(calls + 1));
    // Direct window focus does not call feed.admit: native invalidates its old read with {}.
    focus.current = focus.dock;
    native.foregroundApp.mockResolvedValue({ pid: process.pid, appId: 'intent' });
    native.foregroundContext.mockResolvedValue({ pid: process.pid, appId: 'intent' });
    finish({});
    expect(await duringClick).toBe(ready);
    expect(await feed.read()).toBe(ready);
    expect(dockContextLinkKey((await feed.read())!, 'tab')).toBe(link);
    focus.current = null;
    native.foregroundApp.mockResolvedValue({ pid: 456, appId: 'com.google.Chrome' });
    native.foregroundContext.mockResolvedValue({ pid: 456, url: 'https://example.test/new' });
    const chrome = await feed.read();
    expect(chrome?.url).toBe('https://example.test/new');
    expect(changed.mock.calls.at(-1)?.[0]).toBe(chrome);
    expect(dockContextLinkKey(chrome!, 'tab')).not.toBe(link);
  } finally {
    focus.current = null;
    feed.stop();
  }
});

it('retains app fallback for unavailable permission, transport rejection and timeout', async () => {
  const app = { pid: 123, appId: 'com.figma.Desktop' };
  const foregroundApp = async () => app;
  expect(
    (
      await sampleDockForeground({
        foregroundApp,
        foregroundContext: async () => ({ ...app, urlStatus: 'permission-required' as const }),
      })
    ).snapshot,
  ).toEqual({ ...app, urlStatus: 'permission-required' });
  expect(
    (
      await sampleDockForeground({
        foregroundApp,
        foregroundContext: async () => {
          throw new Error('unavailable');
        },
      })
    ).snapshot,
  ).toEqual(app);
  vi.useFakeTimers();
  try {
    const pending = sampleDockForeground({
      foregroundApp,
      foregroundContext: () => new Promise(() => {}),
    });
    await vi.advanceTimersByTimeAsync(650);
    expect(await pending).toMatchObject({ snapshot: app, urlOutcome: 'timeout' });
  } finally {
    vi.useRealTimers();
  }
});
