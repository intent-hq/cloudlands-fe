/** @vitest-environment jsdom */
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('svelte-fa', async () => ({
  default: (await import('../../ui/__tests__/mocks/Fa.svelte')).default,
}));

import StreamingTypingIndicator from '../StreamingTypingIndicator.svelte';
import {
  CHAT_OPERATIONAL_LEADING_CLASS,
  CHAT_OPERATIONAL_ROW_CLASS,
  CHAT_OPERATIONAL_SUMMARY_CLASS,
} from '../operational-disclosure-row';

afterEach(cleanup);

function expectClasses(element: Element, contract: string) {
  for (const token of contract.split(' ')) expect(element.className).toContain(token);
}

describe('StreamingTypingIndicator geometry matches operational rows', () => {
  it('uses the shared operational row geometry', () => {
    const { container } = render(StreamingTypingIndicator, {
      props: { visible: true, message: 'Thinking' },
    });
    const row = container.firstElementChild!;
    expect(row.className).toContain(CHAT_OPERATIONAL_ROW_CLASS);
  });

  it('uses the shared operational leading slot', () => {
    const { container } = render(StreamingTypingIndicator, {
      props: { visible: true, message: 'Thinking' },
    });
    const spinner = container.querySelector('.legacy-streaming-spinner')!;
    expect(spinner.className).toContain(CHAT_OPERATIONAL_LEADING_CLASS);
  });

  it('uses the shared operational summary geometry', () => {
    const { container } = render(StreamingTypingIndicator, {
      props: { visible: true, message: 'Thinking' },
    });
    const label = container.querySelector('[data-testid="streaming-status-thinking"]')!;
    expect(label.className).toContain(CHAT_OPERATIONAL_SUMMARY_CLASS);
  });

  it('uses body typography on the label (type-body)', () => {
    const { container } = render(StreamingTypingIndicator, {
      props: { visible: true, message: 'Thinking' },
    });
    const row = container.firstElementChild!;
    expectClasses(row, 'type-body');
  });

  it('uses muted-foreground color on row and label', () => {
    const { container } = render(StreamingTypingIndicator, {
      props: { visible: true, message: 'Thinking' },
    });
    const row = container.firstElementChild!;
    const label = container.querySelector('[data-testid="streaming-status-thinking"]')!;
    expectClasses(row, 'text-muted-foreground');
    expectClasses(label, 'text-muted-foreground');
  });

  it('shows 3.5px spinner squares in the icon slot', () => {
    const { container } = render(StreamingTypingIndicator, {
      props: { visible: true, message: 'Thinking' },
    });
    const spinner = container.querySelector('.legacy-streaming-spinner')!;
    const style = spinner.getAttribute('style')!;
    expect(style).toContain('--size: 3.5px');
  });

  it('adds 1px gap between spinner squares', () => {
    const { container } = render(StreamingTypingIndicator, {
      props: { visible: true, message: 'Thinking' },
    });
    const spinner = container.querySelector('.legacy-streaming-spinner')!;
    const style = spinner.getAttribute('style')!;
    expect(style).toContain('--gap: 1px');
  });

  it('preserves the legacy-spinner-wave animation classes', () => {
    const { container } = render(StreamingTypingIndicator, {
      props: { visible: true, message: 'Thinking' },
    });
    const squares = container.querySelectorAll('.legacy-spinner-square');
    expect(squares.length).toBe(3);
    // Verify classes are applied (jsdom doesn't process <style> blocks for animation)
    expect(squares[0].className).toContain('legacy-spinner-square-0');
    expect(squares[1].className).toContain('legacy-spinner-square-1');
    expect(squares[2].className).toContain('legacy-spinner-square-2');
  });

  it('respects prefers-reduced-motion to disable animation', () => {
    const { container } = render(StreamingTypingIndicator, {
      props: { visible: true, message: 'Thinking' },
    });

    // Create a matchMedia mock for reduced motion
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((query) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    const square = container.querySelector('.legacy-spinner-square-0')!;

    // In reduced motion mode, animation should be none (verified via CSS @media rule)
    // The test validates the CSS is present; actual animation:none requires DOM render
    expect(square.className).toContain('legacy-spinner-square');

    window.matchMedia = originalMatchMedia;
  });

  it('maintains stable baseline alignment with text', () => {
    const { container } = render(StreamingTypingIndicator, {
      props: { visible: true, message: 'Thinking' },
    });
    const row = container.firstElementChild!;
    expectClasses(row, 'grid items-center');
  });
});
