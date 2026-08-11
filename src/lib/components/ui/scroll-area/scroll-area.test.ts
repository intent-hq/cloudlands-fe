// @vitest-environment jsdom
import { fireEvent, render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseUiComponentMetadata } from '../component-metadata';
import ScrollAreaHarness from './ScrollAreaHarness.svelte';
import { scrollAreaFixtures } from './scroll-area.fixtures';
import * as scrollAreaApi from './index';

const originalResizeObserver = globalThis.ResizeObserver;

beforeEach(() => {
  globalThis.ResizeObserver = class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(() => {
  globalThis.ResizeObserver = originalResizeObserver;
});

describe('ScrollArea', () => {
  it('renders a focusable viewport and both canonical scrollbar orientations', async () => {
    const { container, getByTestId } = render(ScrollAreaHarness);
    const overflowArea = getByTestId('overflow-area');
    const viewport = overflowArea.querySelector(
      '[data-slot="scroll-area-viewport"]',
    ) as HTMLElement;
    expect(viewport.getAttribute('tabindex')).toBe('0');
    expect(viewport.className).toContain('focus-visible:ring-2');
    expect(viewport.className).toContain('focus-visible:ring-inset');
    expect(viewport.className).not.toContain('dark:');
    viewport.focus();
    await fireEvent.keyDown(viewport, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(viewport);
    expect(overflowArea.getAttribute('data-orientation')).toBe('both');
    expect(container.querySelector('[data-testid="long-scroll-content"]')).not.toBeNull();
  });

  it('contains overflow at the root and preserves a no-overflow content state', () => {
    const { getByTestId } = render(ScrollAreaHarness);
    expect(getByTestId('overflow-area').className).toContain('overflow-hidden');
    expect(getByTestId('no-overflow-area').textContent).toContain('Short content');
    expect(getByTestId('no-overflow-area').getAttribute('data-orientation')).toBe('vertical');
    expect(
      getByTestId('no-overflow-area').querySelectorAll('[data-orientation="horizontal"]'),
    ).toHaveLength(0);
  });

  it('publishes parseable metadata and the complete production public barrel', () => {
    expect(() => parseUiComponentMetadata(scrollAreaApi.scrollAreaMetadata)).not.toThrow();
    expect(scrollAreaFixtures[0].states).toEqual(
      expect.arrayContaining(['vertical', 'horizontal', 'both', 'keyboard-focus', 'no-overflow']),
    );
    expect(Object.keys(scrollAreaApi).sort()).toEqual(
      [...scrollAreaApi.scrollAreaMetadata.exports].sort(),
    );
  });
});
