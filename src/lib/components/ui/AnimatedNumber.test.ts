/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import { tick } from 'svelte';

function mockMotionPreference(reduced: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  vi.mocked(window.matchMedia).mockImplementation(
    (query) =>
      ({
        matches: reduced,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: (_type, listener) => listeners.add(listener as never),
        removeEventListener: (_type, listener) => listeners.delete(listener as never),
        dispatchEvent: vi.fn(() => true),
      }) as MediaQueryList,
  );
}

describe('AnimatedNumber', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('interpolates, retargets from the current frame, and settles exactly', async () => {
    vi.useFakeTimers();
    mockMotionPreference(false);
    const AnimatedNumber = (await import('./AnimatedNumber.svelte')).default;
    const view = render(AnimatedNumber, {
      props: { value: 100, duration: 300, format: (value: number) => String(Math.round(value)) },
    });
    const visible = view.container.querySelector('.animated-number-value')!;

    await view.rerender({
      value: 1_000,
      duration: 300,
      format: (value) => String(Math.round(value)),
    });
    await vi.advanceTimersByTimeAsync(150);
    const midpoint = Number(visible.textContent);
    expect(midpoint).toBeGreaterThan(100);
    expect(midpoint).toBeLessThan(1_000);
    expect(view.container.querySelector('.animated-number')?.className).toContain('animating-up');

    await view.rerender({
      value: 400,
      duration: 300,
      format: (value) => String(Math.round(value)),
    });
    await tick();
    await vi.advanceTimersByTimeAsync(400);
    await tick();
    expect(visible.textContent).toBe('400');
    expect(view.container.querySelector('.animated-number-target')?.textContent).toBe('400');
    expect(view.container.querySelector('.animated-number')?.className).not.toMatch(/animating-/);
  });

  it('keeps interpolation but omits pulse classes when pulse is disabled', async () => {
    vi.useFakeTimers();
    mockMotionPreference(false);
    const AnimatedNumber = (await import('./AnimatedNumber.svelte')).default;
    const view = render(AnimatedNumber, {
      props: {
        value: 1_234,
        duration: 300,
        pulse: false,
        format: (value: number) => String(Math.round(value)),
      },
    });
    const number = view.container.querySelector('.animated-number')!;
    const visible = view.container.querySelector('.animated-number-value')!;

    await view.rerender({
      value: 9_876,
      duration: 300,
      pulse: false,
      format: (value) => String(Math.round(value)),
    });
    await vi.advanceTimersByTimeAsync(150);
    expect(Number(visible.textContent)).toBeGreaterThan(1_234);
    expect(Number(visible.textContent)).toBeLessThan(9_876);
    expect(visible.textContent).not.toContain('.');
    expect(number.className).not.toMatch(/animating-/);
    expect(number.getAttribute('data-pulse')).toBe('false');

    await vi.advanceTimersByTimeAsync(200);
    expect(visible.textContent).toBe('9876');
    expect(
      view.container.querySelector('.animated-number-target')?.getAttribute('aria-atomic'),
    ).toBe('true');
  });

  it('snaps to the accessible final target under reduced motion', async () => {
    mockMotionPreference(true);
    const AnimatedNumber = (await import('./AnimatedNumber.svelte')).default;
    const view = render(AnimatedNumber, {
      props: { value: 10, format: (value: number) => `${Math.round(value)} tokens` },
    });

    await view.rerender({ value: 987, format: (value) => `${Math.round(value)} tokens` });
    expect(view.container.querySelector('.animated-number-value')?.textContent).toBe('987 tokens');
    expect(
      view.container.querySelector('.animated-number-value')?.getAttribute('aria-hidden'),
    ).toBe('true');
    expect(view.container.querySelector('.animated-number-target')?.textContent).toBe('987 tokens');
    expect(view.container.querySelector('.animated-number')?.className).not.toMatch(/animating-/);
  });
});
