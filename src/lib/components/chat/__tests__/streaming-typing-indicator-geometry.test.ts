/** @vitest-environment jsdom */
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import StreamingTypingIndicator from '../StreamingTypingIndicator.svelte';

interface AnimationRecord {
  options: KeyframeAnimationOptions;
  cancel: ReturnType<typeof vi.fn>;
  finish(): void;
}

const animationRecords: AnimationRecord[] = [];
let reducedMotion = false;

beforeEach(() => {
  animationRecords.length = 0;
  reducedMotion = false;
  Element.prototype.animate = vi.fn((_frames, options) => {
    let onfinish: ((event: AnimationPlaybackEvent) => void) | null = null;
    const animation = {
      cancel: vi.fn(),
      currentTime: 0,
      playState: 'running',
      get onfinish() {
        return onfinish;
      },
      set onfinish(callback: ((event: AnimationPlaybackEvent) => void) | null) {
        onfinish = callback;
      },
    } as unknown as Animation;
    animationRecords.push({
      options: (typeof options === 'number' ? { duration: options } : options) ?? {},
      cancel: animation.cancel as ReturnType<typeof vi.fn>,
      finish: () => onfinish?.({} as AnimationPlaybackEvent),
    });
    return animation;
  });
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({
      get matches() {
        return reducedMotion;
      },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});

afterEach(cleanup);

describe('StreamingTypingIndicator', () => {
  it('exposes an accessible playing status', () => {
    const { container } = render(StreamingTypingIndicator, {
      props: { visible: true, message: 'Thinking' },
    });
    const mark = container.querySelector('[data-slot="intent-mark-loader"]')!;

    expect(mark.getAttribute('data-playing')).toBe('true');
    expect(mark.getAttribute('role')).toBe('status');
    expect(mark.getAttribute('aria-label')).toBeTruthy();
  });

  it('keeps lifecycle detail outside the live status region', () => {
    const { container } = render(StreamingTypingIndicator, {
      props: {
        visible: true,
        message: 'Thinking',
        lifecycleMessage: 'Calling the daemon tool exactly as sent',
      },
    });
    const copy = container.querySelector('[data-testid="streaming-status-copy"]')!;
    const lifecycle = container.querySelector('[data-testid="streaming-status-phase"]')!;
    expect(copy.textContent).toBe('ThinkingCalling the daemon tool exactly as sent');
    expect(lifecycle.closest('[role="status"]')).toBeNull();
    expect(lifecycle.closest('[aria-live]')).toBeNull();
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
  });

  it('holds the neutral mark immediately for reduced motion', () => {
    reducedMotion = true;
    const { container } = render(StreamingTypingIndicator, {
      props: { visible: true, message: 'Thinking' },
    });
    const mark = container.querySelector<SVGSVGElement>('[data-slot="intent-mark-loader"]')!;
    expect(mark.dataset.motionState).toBe('neutral');
    expect(animationRecords).toHaveLength(0);
  });

  it('retains accessible status and lifecycle updates when the generic label is visually suppressed', async () => {
    const view = render(StreamingTypingIndicator, {
      props: {
        visible: true,
        showMessage: false,
        message: 'Thinking',
        lifecycleMessage: 'Sent prompt…',
      },
    });
    const mark = view.getByRole('status', { name: 'Loading' });
    expect(view.getByText('Thinking')).toBeTruthy();
    expect(view.getByText('Sent prompt…')).toBeTruthy();

    await view.rerender({ lifecycleMessage: 'Receiving response…' });
    expect(view.queryByText('Sent prompt…')).toBeNull();
    expect(view.getByText('Receiving response…')).toBeTruthy();
    expect(view.getByRole('status', { name: 'Loading' })).toBe(mark);

    await view.rerender({ lifecycleMessage: null });
    expect(view.queryByText('Receiving response…')).toBeNull();
    expect(view.getByText('Thinking')).toBeTruthy();
    expect(view.getByRole('status', { name: 'Loading' })).toBe(mark);
  });

  it('cancels all motion on removal and supports rapid reactivation', async () => {
    const view = render(StreamingTypingIndicator, {
      props: { visible: true, message: 'Thinking' },
    });
    animationRecords[0].finish();
    const arms = Array.from(view.container.querySelectorAll<SVGPathElement>('[data-mark-arm]'));
    expect(arms).toHaveLength(5);
    expect(arms.every((arm) => arm.style.transform !== '')).toBe(true);
    expect(animationRecords.filter(({ options }) => options.iterations === Infinity)).toHaveLength(
      0,
    );

    const cancelFrame = vi.spyOn(globalThis, 'cancelAnimationFrame');
    view.unmount();
    expect(cancelFrame).toHaveBeenCalledOnce();
    cancelFrame.mockRestore();
    expect(animationRecords.every(({ cancel }) => cancel.mock.calls.length > 0)).toBe(true);
    expect(arms.every((arm) => !arm.isConnected)).toBe(true);

    const reactivated = render(StreamingTypingIndicator, {
      props: { visible: true, message: 'Thinking' },
    });
    animationRecords.find(({ cancel }) => cancel.mock.calls.length === 0)?.finish();
    expect(reactivated.container.querySelector('[data-motion-state="playing"]')).not.toBeNull();
  });
});
