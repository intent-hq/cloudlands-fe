import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  attachMouseHistoryNavigation,
  handleHistoryMouseDown,
  handleHistoryMouseUp,
  handleHistoryNavigateIpc,
  NAVIGATION_DEDUPE_WINDOW_MS,
  navigateHistory,
} from './history-navigation';

describe('history-navigation', () => {
  let backSpy: ReturnType<typeof vi.spyOn>;
  let forwardSpy: ReturnType<typeof vi.spyOn>;
  // Advanced past the dedupe window before every test so navigateHistory's
  // module-level same-direction suppression state never leaks across tests.
  let now = 1_000_000;

  beforeEach(() => {
    vi.useFakeTimers();
    now += 10_000;
    vi.setSystemTime(now);
    backSpy = vi.spyOn(history, 'back').mockImplementation(() => {});
    forwardSpy = vi.spyOn(history, 'forward').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('navigateHistory', () => {
    it('calls history.back for back', () => {
      navigateHistory('back');
      expect(backSpy).toHaveBeenCalledTimes(1);
      expect(forwardSpy).not.toHaveBeenCalled();
    });

    it('calls history.forward for forward', () => {
      navigateHistory('forward');
      expect(forwardSpy).toHaveBeenCalledTimes(1);
      expect(backSpy).not.toHaveBeenCalled();
    });

    describe('double-fire dedupe', () => {
      it.each(['back', 'forward'] as const)(
        'suppresses a same-direction %s dispatch within the dedupe window',
        (direction) => {
          const spy = direction === 'back' ? backSpy : forwardSpy;
          navigateHistory(direction);
          vi.setSystemTime(now + NAVIGATION_DEDUPE_WINDOW_MS - 1);
          navigateHistory(direction);
          expect(spy).toHaveBeenCalledTimes(1);
        },
      );

      it('allows a same-direction dispatch beyond the dedupe window', () => {
        navigateHistory('back');
        vi.setSystemTime(now + NAVIGATION_DEDUPE_WINDOW_MS);
        navigateHistory('back');
        expect(backSpy).toHaveBeenCalledTimes(2);
      });

      it('allows an opposite-direction dispatch within the dedupe window', () => {
        navigateHistory('back');
        vi.setSystemTime(now + 1);
        navigateHistory('forward');
        expect(backSpy).toHaveBeenCalledTimes(1);
        expect(forwardSpy).toHaveBeenCalledTimes(1);
      });

      it('dedupes across dispatch paths (mouse event then IPC)', () => {
        const e = new MouseEvent('mouseup', { button: 3, cancelable: true });
        handleHistoryMouseUp(e);
        vi.setSystemTime(now + 1);
        handleHistoryNavigateIpc('back');
        expect(backSpy).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('handleHistoryNavigateIpc', () => {
    it('calls history.back for a back payload', () => {
      handleHistoryNavigateIpc('back');
      expect(backSpy).toHaveBeenCalledTimes(1);
      expect(forwardSpy).not.toHaveBeenCalled();
    });

    it('calls history.forward for a forward payload', () => {
      handleHistoryNavigateIpc('forward');
      expect(forwardSpy).toHaveBeenCalledTimes(1);
      expect(backSpy).not.toHaveBeenCalled();
    });

    it.each([undefined, null, {}, 'backward', 'browser-backward', 42])(
      'ignores invalid payload %p',
      (payload) => {
        handleHistoryNavigateIpc(payload);
        expect(backSpy).not.toHaveBeenCalled();
        expect(forwardSpy).not.toHaveBeenCalled();
      },
    );
  });

  describe('handleHistoryMouseUp', () => {
    it('back button (3) prevents default and goes back', () => {
      const e = new MouseEvent('mouseup', { button: 3, cancelable: true });
      handleHistoryMouseUp(e);
      expect(backSpy).toHaveBeenCalledTimes(1);
      expect(forwardSpy).not.toHaveBeenCalled();
      expect(e.defaultPrevented).toBe(true);
    });

    it('forward button (4) prevents default and goes forward', () => {
      const e = new MouseEvent('mouseup', { button: 4, cancelable: true });
      handleHistoryMouseUp(e);
      expect(forwardSpy).toHaveBeenCalledTimes(1);
      expect(backSpy).not.toHaveBeenCalled();
      expect(e.defaultPrevented).toBe(true);
    });

    it.each([0, 1, 2])('button %i does nothing', (button) => {
      const e = new MouseEvent('mouseup', { button, cancelable: true });
      handleHistoryMouseUp(e);
      expect(backSpy).not.toHaveBeenCalled();
      expect(forwardSpy).not.toHaveBeenCalled();
      expect(e.defaultPrevented).toBe(false);
    });
  });

  describe('handleHistoryMouseDown', () => {
    it.each([3, 4])('prevents default for X button %i without navigating', (button) => {
      const e = new MouseEvent('mousedown', { button, cancelable: true });
      handleHistoryMouseDown(e);
      expect(e.defaultPrevented).toBe(true);
      expect(backSpy).not.toHaveBeenCalled();
      expect(forwardSpy).not.toHaveBeenCalled();
    });

    it.each([0, 1, 2])('leaves button %i untouched', (button) => {
      const e = new MouseEvent('mousedown', { button, cancelable: true });
      handleHistoryMouseDown(e);
      expect(e.defaultPrevented).toBe(false);
    });
  });

  describe('webview guest events are ignored', () => {
    let webview: HTMLElement;
    let child: HTMLElement;
    let cleanup: () => void;

    beforeEach(() => {
      webview = document.createElement('webview');
      child = document.createElement('div');
      webview.appendChild(child);
      document.body.appendChild(webview);
      cleanup = attachMouseHistoryNavigation(window);
    });

    afterEach(() => {
      cleanup();
      webview.remove();
    });

    it('back button (3) mouseup from inside a webview does not navigate', () => {
      const e = new MouseEvent('mouseup', { button: 3, bubbles: true, cancelable: true });
      child.dispatchEvent(e);
      expect(backSpy).not.toHaveBeenCalled();
      expect(forwardSpy).not.toHaveBeenCalled();
      expect(e.defaultPrevented).toBe(false);
    });

    it('forward button (4) mouseup from inside a webview does not navigate', () => {
      const e = new MouseEvent('mouseup', { button: 4, bubbles: true, cancelable: true });
      child.dispatchEvent(e);
      expect(backSpy).not.toHaveBeenCalled();
      expect(forwardSpy).not.toHaveBeenCalled();
      expect(e.defaultPrevented).toBe(false);
    });

    it.each([3, 4])('mouseup with button %i targeting the webview itself does not navigate', (button) => {
      const e = new MouseEvent('mouseup', { button, bubbles: true, cancelable: true });
      webview.dispatchEvent(e);
      expect(backSpy).not.toHaveBeenCalled();
      expect(forwardSpy).not.toHaveBeenCalled();
      expect(e.defaultPrevented).toBe(false);
    });

    it.each([3, 4])('mousedown with button %i from inside a webview keeps default', (button) => {
      const e = new MouseEvent('mousedown', { button, bubbles: true, cancelable: true });
      child.dispatchEvent(e);
      expect(e.defaultPrevented).toBe(false);
    });
  });

  describe('attachMouseHistoryNavigation', () => {
    it('registers window listeners that navigate on X-button mouseup', () => {
      const cleanup = attachMouseHistoryNavigation(window);
      try {
        window.dispatchEvent(new MouseEvent('mouseup', { button: 3, cancelable: true }));
        expect(backSpy).toHaveBeenCalledTimes(1);
        window.dispatchEvent(new MouseEvent('mouseup', { button: 4, cancelable: true }));
        expect(forwardSpy).toHaveBeenCalledTimes(1);
      } finally {
        cleanup();
      }
    });

    it('capture-phase listener navigates even when a component stops propagation', () => {
      const cleanup = attachMouseHistoryNavigation(window);
      const el = document.createElement('div');
      document.body.appendChild(el);
      el.addEventListener('mouseup', (e) => e.stopPropagation());
      try {
        el.dispatchEvent(new MouseEvent('mouseup', { button: 3, bubbles: true, cancelable: true }));
        expect(backSpy).toHaveBeenCalledTimes(1);
      } finally {
        cleanup();
        el.remove();
      }
    });

    it('cleanup removes the listeners', () => {
      const cleanup = attachMouseHistoryNavigation(window);
      cleanup();
      window.dispatchEvent(new MouseEvent('mouseup', { button: 3, cancelable: true }));
      window.dispatchEvent(new MouseEvent('mousedown', { button: 4, cancelable: true }));
      expect(backSpy).not.toHaveBeenCalled();
      expect(forwardSpy).not.toHaveBeenCalled();
    });
  });
});
