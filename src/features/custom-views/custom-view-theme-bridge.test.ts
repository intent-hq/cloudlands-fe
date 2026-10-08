import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachCustomViewThemeBridge } from './custom-view-theme-bridge';

const motion = vi.hoisted(() => ({
  reduced: false,
  notify: undefined as undefined | (() => void),
  unsubscribe: vi.fn(),
}));
vi.mock('$lib/utils/reduced-motion', () => ({
  prefersReducedMotion: () => motion.reduced,
  onReducedMotionChange: (listener: () => void) => {
    motion.notify = listener;
    return motion.unsubscribe;
  },
}));

describe('custom view host theme bridge', () => {
  let iframe: HTMLIFrameElement;
  let post: ReturnType<typeof vi.spyOn>;
  let dispose: (() => void) | undefined;
  const origin = 'http://127.0.0.1:4317';
  const ready = { type: 'intent:theme:ready', version: 1 };
  const flush = async () => {
    await Promise.resolve();
    await Promise.resolve();
  };
  const receive = (source: MessageEventSource | null, from: string, data: unknown) => {
    window.dispatchEvent(new MessageEvent('message', { source, origin: from, data }));
  };

  beforeEach(async () => {
    document.documentElement.removeAttribute('style');
    document.documentElement.className = '';
    document.documentElement.style.setProperty('--background', '0 0% 100%');
    document.documentElement.style.setProperty('--space-3', '0.75rem');
    document.documentElement.style.setProperty('--private-workspace-path', '/private');
    motion.reduced = false;
    motion.unsubscribe.mockClear();
    iframe = document.createElement('iframe');
    await new Promise<void>((resolve) => {
      iframe.addEventListener('load', () => resolve(), { once: true });
      document.body.append(iframe);
    });
    post = vi.spyOn(iframe.contentWindow!, 'postMessage').mockImplementation(() => {});
  });

  afterEach(() => {
    dispose?.();
    dispose = undefined;
    iframe.remove();
    document.documentElement.removeAttribute('style');
    document.documentElement.className = '';
    vi.restoreAllMocks();
  });

  it('sends only public computed variables and metadata to the registered origin', () => {
    dispose = attachCustomViewThemeBridge(iframe, `${origin}/`);
    iframe.dispatchEvent(new Event('load'));
    expect(post).toHaveBeenNthCalledWith(1, { type: 'intent:theme:init', version: 1 }, origin);
    expect(post).toHaveBeenLastCalledWith(
      {
        type: 'intent:theme:update',
        version: 1,
        theme: {
          version: 1,
          mode: 'light',
          reducedMotion: false,
          cssVariables: { '--background': '0 0% 100%', '--space-3': '0.75rem' },
        },
      },
      origin,
    );
  });

  it('waits through the initial blank document but can attach to an already loaded frame', () => {
    const stop = attachCustomViewThemeBridge(iframe, origin);
    expect(post).not.toHaveBeenCalled();
    stop();
    vi.spyOn(iframe, 'contentDocument', 'get').mockReturnValue(null);
    dispose = attachCustomViewThemeBridge(iframe, origin);
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('rejects messages from another frame, origin, or protocol version', () => {
    dispose = attachCustomViewThemeBridge(iframe, origin);
    post.mockClear();
    receive(window, origin, ready);
    receive(iframe.contentWindow, 'http://127.0.0.1:4318', ready);
    receive(iframe.contentWindow, 'null', ready);
    receive(iframe.contentWindow, origin, { ...ready, version: 2 });
    receive(iframe.contentWindow, origin, { ...ready, command: 'start' });
    expect(post).not.toHaveBeenCalled();
    receive(iframe.contentWindow, origin, ready);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('resends the snapshot for late SDK startup and iframe reload', () => {
    dispose = attachCustomViewThemeBridge(iframe, origin);
    post.mockClear();
    receive(iframe.contentWindow, origin, ready);
    receive(iframe.contentWindow, origin, ready);
    expect(post).toHaveBeenCalledTimes(2);
    iframe.dispatchEvent(new Event('load'));
    expect(post).toHaveBeenCalledTimes(4);
    expect(post.mock.calls[2][0]).toEqual({ type: 'intent:theme:init', version: 1 });
  });

  it('coalesces theme changes and sends live overrides and motion preferences', async () => {
    dispose = attachCustomViewThemeBridge(iframe, origin);
    post.mockClear();
    document.documentElement.classList.add('dark');
    document.documentElement.style.setProperty('--background', '220 10% 8%');
    window.dispatchEvent(new Event('theme-changed'));
    await flush();
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][0].theme).toMatchObject({
      mode: 'dark',
      cssVariables: { '--background': '220 10% 8%' },
    });
    window.dispatchEvent(new Event('theme-changed'));
    await flush();
    expect(post).toHaveBeenCalledTimes(1);
    motion.reduced = true;
    motion.notify?.();
    await flush();
    expect(post.mock.calls[1][0].theme.reducedMotion).toBe(true);
  });

  it('sends a replacement snapshot when an override disappears', async () => {
    dispose = attachCustomViewThemeBridge(iframe, origin);
    post.mockClear();
    document.documentElement.style.removeProperty('--space-3');
    await flush();
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][0].theme.cssVariables).not.toHaveProperty('--space-3');
  });

  it('cleans up listeners and ignores queued updates after disposal', async () => {
    const stop = attachCustomViewThemeBridge(iframe, origin);
    post.mockClear();
    window.dispatchEvent(new Event('theme-changed'));
    stop();
    receive(iframe.contentWindow, origin, ready);
    iframe.dispatchEvent(new Event('load'));
    document.documentElement.classList.add('dark');
    motion.notify?.();
    await flush();
    expect(post).not.toHaveBeenCalled();
    expect(motion.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it.each(['bad url', 'https://example.com', 'http://localhost:4317', 'file:///tmp/view'])(
    'does not bridge an unregistered server URL: %s',
    (url) => {
      dispose = attachCustomViewThemeBridge(iframe, url);
      receive(iframe.contentWindow, origin, ready);
      expect(post).not.toHaveBeenCalled();
    },
  );
});
