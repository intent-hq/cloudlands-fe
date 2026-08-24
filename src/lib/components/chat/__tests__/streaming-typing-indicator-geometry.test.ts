/** @vitest-environment jsdom */
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import StreamingTypingIndicator from '../StreamingTypingIndicator.svelte';
import {
  CHAT_OPERATIONAL_LEADING_CLASS,
  CHAT_OPERATIONAL_ROW_CLASS,
  CHAT_OPERATIONAL_SUMMARY_CLASS,
} from '../operational-disclosure-row';

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

function expectClasses(element: Element, contract: string) {
  for (const token of contract.split(' ')) expect(element.className).toContain(token);
}

describe('StreamingTypingIndicator geometry matches operational rows', () => {
  it('uses the shared row geometry and a 16px five-arm currentColor mark', () => {
    const { container } = render(StreamingTypingIndicator, {
      props: { visible: true, message: 'Thinking' },
    });
    const row = container.firstElementChild!;
    const leading = container.querySelector('[data-operational-leading]')!;
    const summary = container.querySelector('[data-operational-summary]')!;
    const mark = container.querySelector('[data-slot="intent-mark-loader"]')!;

    expect(row.className).toContain(CHAT_OPERATIONAL_ROW_CLASS);
    expect(leading.className).toContain(CHAT_OPERATIONAL_LEADING_CLASS);
    expect(summary.className).toContain(CHAT_OPERATIONAL_SUMMARY_CLASS);
    expectClasses(row, 'type-body grid items-center text-muted-foreground');
    expect(mark.getAttribute('data-variant')).toBe('bloom');
    expect(mark.getAttribute('data-playing')).toBe('true');
    expect(mark.getAttribute('width')).toBe('16');
    expect(mark.getAttribute('height')).toBe('16');
    expect(mark.getAttribute('viewBox')).toBe('0 0 256 208');
    expect(mark.querySelectorAll('[data-mark-arm]')).toHaveLength(5);
    expect(container.innerHTML).not.toContain('legacy-spinner');
    expect(container.innerHTML).not.toContain('--color');
  });

  it('uses primary Thinking copy and muted non-live lifecycle detail', () => {
    const { container } = render(StreamingTypingIndicator, {
      props: {
        visible: true,
        message: 'Thinking',
        lifecycleMessage: 'Calling the daemon tool exactly as sent',
      },
    });
    const copy = container.querySelector('[data-testid="streaming-status-copy"]')!;
    const label = container.querySelector('[data-testid="streaming-status-thinking-label"]')!;
    const lifecycle = container.querySelector('[data-testid="streaming-status-phase"]')!;
    expectClasses(copy, 'inline-flex min-w-0 max-w-full items-baseline gap-[0.5ch]');
    expectClasses(label, 'shrink-0 font-normal text-foreground');
    expectClasses(lifecycle, 'min-w-0 truncate font-normal text-muted-foreground');
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

  it('cancels all motion on removal and supports rapid reactivation', async () => {
    const view = render(StreamingTypingIndicator, {
      props: { visible: true, message: 'Thinking' },
    });
    animationRecords[0].finish();
    expect(animationRecords.filter(({ options }) => options.iterations === Infinity)).toHaveLength(
      5,
    );

    view.unmount();
    expect(animationRecords.every(({ cancel }) => cancel.mock.calls.length > 0)).toBe(true);

    const reactivated = render(StreamingTypingIndicator, {
      props: { visible: true, message: 'Thinking' },
    });
    animationRecords.find(({ cancel }) => cancel.mock.calls.length === 0)?.finish();
    expect(reactivated.container.querySelector('[data-motion-state="playing"]')).not.toBeNull();
  });
});
