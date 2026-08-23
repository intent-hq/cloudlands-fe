/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { taskProgressFlip, taskProgressRowTransition } from '../task-progress-motion';

afterEach(() => vi.restoreAllMocks());

describe('task progress reduced motion', () => {
  it('removes row movement and disclosure motion', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: true,
      media: '(prefers-reduced-motion: reduce)',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    });
    const rect = new DOMRect(0, 0, 20, 20);
    expect(taskProgressFlip(document.createElement('div'), { from: rect, to: rect })).toEqual({
      duration: 0,
    });
    expect(taskProgressRowTransition(document.createElement('div'))).toEqual({ duration: 0 });
  });
});
