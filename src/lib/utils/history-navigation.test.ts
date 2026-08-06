import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  attachMouseHistoryNavigation,
  handleHistoryMouseDown,
  handleHistoryMouseUp,
  handleHistoryNavigateIpc,
  navigateHistory,
} from './history-navigation';

describe('history-navigation', () => {
  let backSpy: ReturnType<typeof vi.spyOn>;
  let forwardSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    backSpy = vi.spyOn(history, 'back').mockImplementation(() => {});
    forwardSpy = vi.spyOn(history, 'forward').mockImplementation(() => {});
  });

  afterEach(() => {
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
