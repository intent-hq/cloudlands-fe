import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createCustomViewTheme,
  type CustomViewTheme,
  type CustomViewThemeSnapshot,
} from './index.js';

const testWindow = window;
let hostWindow: Window;
let frame: HTMLIFrameElement;
let childWindow: Window;
let clients: CustomViewTheme[];

function connect(options: Parameters<typeof createCustomViewTheme>[0] = {}) {
  const client = createCustomViewTheme(options);
  clients.push(client);
  return client;
}

function message(data: unknown, origin = 'app://workspaces', source: Window = hostWindow) {
  childWindow.dispatchEvent(new MessageEvent('message', { data, origin, source }));
}

function update(overrides: Partial<CustomViewThemeSnapshot> = {}) {
  return {
    type: 'intent:theme:update',
    version: 1,
    theme: {
      version: 1,
      mode: 'dark',
      reducedMotion: false,
      cssVariables: { '--background': '210 20% 10%', '--font-ui': 'Example, sans-serif' },
      ...overrides,
    },
  };
}

beforeEach(() => {
  frame = testWindow.document.createElement('iframe');
  testWindow.document.body.appendChild(frame);
  childWindow = frame.contentWindow!;
  hostWindow = childWindow.parent;
  clients = [];
  vi.stubGlobal('window', childWindow);
  vi.spyOn(hostWindow, 'postMessage').mockImplementation(() => {});
});

afterEach(() => {
  for (const client of clients) client.dispose();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  frame.remove();
});

describe('createCustomViewTheme', () => {
  it('announces ready on connection and on a valid late host init', () => {
    const client = connect();
    expect(client.getSnapshot()).toBeNull();
    expect(hostWindow.postMessage).toHaveBeenLastCalledWith(
      { type: 'intent:theme:ready', version: 1 },
      'app://workspaces',
    );
    message({ type: 'intent:theme:init', version: 1 });
    expect(hostWindow.postMessage).toHaveBeenCalledTimes(2);
    message({ type: 'intent:theme:init', version: 2 });
    message({ type: 'intent:theme:init', version: 1 }, 'https://untrusted.example');
    message({ type: 'intent:theme:init', version: 1 }, 'app://workspaces', childWindow);
    expect(hostWindow.postMessage).toHaveBeenCalledTimes(2);
  });

  it('requires the exact parent window, origin, version and public payload', () => {
    const client = connect();
    message(update(), 'https://untrusted.example');
    message(update(), 'null');
    message(update(), 'app://workspaces.evil');
    message(update(), 'app://workspaces', childWindow);
    message({ ...update(), version: 2 });
    message(
      update({ cssVariables: { '--background': 123 } } as unknown as CustomViewThemeSnapshot),
    );
    expect(client.getSnapshot()).toBeNull();
    expect(childWindow.document.documentElement.style.length).toBe(0);
    message(update());
    expect(client.getSnapshot()?.mode).toBe('dark');
  });

  it.each(['app://workspaces', 'http://localhost:5173', 'https://intent.example'])(
    'supports explicit parent origin %s without widening it',
    (parentOrigin) => {
      const client = connect({ parentOrigin });
      expect(hostWindow.postMessage).toHaveBeenCalledWith(
        { type: 'intent:theme:ready', version: 1 },
        parentOrigin,
      );
      message(update(), `${parentOrigin}/`);
      expect(client.getSnapshot()).toBeNull();
      message(update(), parentOrigin);
      expect(client.getSnapshot()?.mode).toBe('dark');
    },
  );

  it.each([
    '*',
    'null',
    '',
    'app://elsewhere',
    'https://intent.example/path',
    'https://intent.example/',
    'https://user@intent.example',
    'file:///tmp/view.html',
  ])('rejects unsafe or non-exact configured origin %s', (parentOrigin) => {
    expect(() => connect({ parentOrigin })).toThrow(TypeError);
    expect(hostWindow.postMessage).not.toHaveBeenCalled();
  });

  it('applies the same tokens exposed to subscribers and updates color-scheme', () => {
    const client = connect();
    const listener = vi.fn();
    const unsubscribe = client.subscribe(listener);
    expect(listener).not.toHaveBeenCalled();
    message(update());
    const root = childWindow.document.documentElement;
    expect(root.style.getPropertyValue('--background')).toBe('210 20% 10%');
    expect(root.style.getPropertyValue('--font-ui')).toBe('Example, sans-serif');
    expect(root.style.colorScheme).toBe('dark');
    expect(listener).toHaveBeenLastCalledWith(client.getSnapshot());
    const late = vi.fn();
    client.subscribe(late);
    expect(late).toHaveBeenCalledOnce();
    message(
      update({
        mode: 'light',
        reducedMotion: true,
        cssVariables: { '--background': '0 0% 98%', '--motion-reduced': '1' },
      }),
    );
    expect(root.style.colorScheme).toBe('light');
    expect(root.style.getPropertyValue('--background')).toBe('0 0% 98%');
    expect(root.style.getPropertyValue('--font-ui')).toBe('');
    expect(root.style.getPropertyValue('--motion-reduced')).toBe('1');
    expect(client.getSnapshot()?.reducedMotion).toBe(true);
    unsubscribe();
    message(update());
    expect(listener).toHaveBeenCalledTimes(2);
    expect(late).toHaveBeenCalledTimes(3);
  });

  it('keeps snapshots isolated when callers or subscribers attempt mutation', () => {
    const client = connect();
    client.subscribe((theme) => {
      Reflect.set(theme, 'mode', 'light');
      Reflect.set(theme.cssVariables, '--background', '0 0% 100%');
    });
    const observer = vi.fn();
    client.subscribe(observer);
    const payload = update();
    message(payload);
    payload.theme.cssVariables['--background'] = '0 0% 100%';
    Reflect.set(client.getSnapshot()!, 'mode', 'light');
    expect(observer.mock.lastCall?.[0].cssVariables['--background']).toBe('210 20% 10%');
    expect(client.getSnapshot()?.mode).toBe('dark');
    expect(childWindow.document.documentElement.style.getPropertyValue('--background')).toBe(
      '210 20% 10%',
    );
  });

  it('continues delivery when a subscriber throws, including immediate delivery', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const client = connect();
    client.subscribe(() => {
      throw new Error('consumer failure');
    });
    const observer = vi.fn();
    client.subscribe(observer);
    message(update());
    expect(() =>
      client.subscribe(() => {
        throw new Error('late consumer failure');
      }),
    ).not.toThrow();
    message(update({ mode: 'light' }));
    expect(observer).toHaveBeenCalledTimes(2);
    expect(childWindow.document.documentElement.style.colorScheme).toBe('light');
  });

  it('offers JSON-only subscriptions without changing any CSS', () => {
    const root = childWindow.document.documentElement;
    root.style.setProperty('--background', '0 0% 100%');
    const client = connect({ applyCss: false });
    message(update());
    expect(client.getSnapshot()?.cssVariables['--background']).toBe('210 20% 10%');
    expect(root.style.getPropertyValue('--background')).toBe('0 0% 100%');
    expect(root.style.colorScheme).toBe('');
    client.dispose();
    expect(root.style.getPropertyValue('--background')).toBe('0 0% 100%');
  });

  it('restores previous values and priorities while preserving later consumer edits', () => {
    const root = childWindow.document.documentElement;
    root.style.setProperty('--background', '0 0% 100%', 'important');
    root.style.setProperty('color-scheme', 'light', 'important');
    const client = connect();
    const listener = vi.fn();
    client.subscribe(listener);
    message(update());
    root.style.setProperty('--font-ui', 'Consumer font');
    client.dispose();
    client.dispose();
    expect(root.style.getPropertyValue('--background')).toBe('0 0% 100%');
    expect(root.style.getPropertyPriority('--background')).toBe('important');
    expect(root.style.colorScheme).toBe('light');
    expect(root.style.getPropertyPriority('color-scheme')).toBe('important');
    expect(root.style.getPropertyValue('--font-ui')).toBe('Consumer font');
    message(update({ mode: 'light' }));
    message({ type: 'intent:theme:init', version: 1 });
    const late = vi.fn();
    client.subscribe(late);
    expect(late).not.toHaveBeenCalled();
    expect(listener).toHaveBeenCalledOnce();
    expect(hostWindow.postMessage).toHaveBeenCalledOnce();
  });

  it('remembers consumer edits made between theme updates for subsequent cleanup', () => {
    const client = connect();
    const root = childWindow.document.documentElement;
    message(update());
    root.style.setProperty('--background', '0 0% 99%', 'important');
    message(update({ mode: 'light', cssVariables: { '--background': '0 0% 97%' } }));
    client.dispose();
    expect(root.style.getPropertyValue('--background')).toBe('0 0% 99%');
    expect(root.style.getPropertyPriority('--background')).toBe('important');
  });

  it('is inert in standalone pages and during server rendering', () => {
    vi.stubGlobal('window', hostWindow);
    const standalone = connect();
    expect(standalone.getSnapshot()).toBeNull();
    expect(hostWindow.postMessage).not.toHaveBeenCalled();
    vi.stubGlobal('window', undefined);
    const server = connect();
    expect(server.getSnapshot()).toBeNull();
    expect(() => server.dispose()).not.toThrow();
  });
});
