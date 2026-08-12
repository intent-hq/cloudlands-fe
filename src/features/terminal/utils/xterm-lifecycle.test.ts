import { afterEach, describe, expect, it, vi } from 'vitest';
import { disposeXtermAfterViewportSync } from './xterm-lifecycle';

describe('disposeXtermAfterViewportSync', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('lets an already-queued viewport sync run before disposing the renderer', () => {
    vi.useFakeTimers();
    let rendererAvailable = true;
    const viewportSync = vi.fn(() => {
      expect(rendererAvailable).toBe(true);
    });
    const terminal = {
      dispose: vi.fn(() => {
        rendererAvailable = false;
      }),
    };

    setTimeout(viewportSync, 0);
    disposeXtermAfterViewportSync(terminal);

    expect(terminal.dispose).not.toHaveBeenCalled();
    vi.runAllTimers();

    expect(viewportSync).toHaveBeenCalledOnce();
    expect(terminal.dispose).toHaveBeenCalledOnce();
  });

  it('reports deferred disposal errors', () => {
    vi.useFakeTimers();
    const error = new Error('dispose failed');
    const onError = vi.fn();

    disposeXtermAfterViewportSync(
      {
        dispose: () => {
          throw error;
        },
      },
      onError,
    );
    vi.runAllTimers();

    expect(onError).toHaveBeenCalledWith(error);
  });
});
