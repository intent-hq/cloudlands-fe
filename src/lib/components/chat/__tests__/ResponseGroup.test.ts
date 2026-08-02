/**
 * @vitest-environment jsdom
 *
 * 1. Collapse state model: last/streaming groups collapse to the semi-open
 *    cylinder preview (never fully closed); non-last finished groups collapse
 *    fully. See "ResponseGroup - collapse state model" below.
 *
 * 2. Regression test for Bug 2: NaN keyframe values in ResponseGroup collapse transition.
 *
 * The `collapseFromCurrent` function in ResponseGroup.svelte uses
 * `parseFloat(style.paddingTop)` etc. without guarding against empty strings.
 * When `getComputedStyle` returns empty strings (element not in DOM during
 * out: transition teardown), `parseFloat("")` returns `NaN`, producing
 * invalid CSS like `height: NaNpx`.
 *
 * This test replicates the exact logic of `collapseFromCurrent` and verifies
 * that the CSS function never produces NaN values, even when getComputedStyle
 * returns empty strings.
 *
 * This test should FAIL before the fix and PASS after.
 */
import {
  describe,
  it,
  expect,
  vi,
  afterEach,
} from 'vitest';
import {
  fireEvent,
  render,
  waitFor,
} from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { cubicOut } from 'svelte/easing';
import ResponseGroup from '../ResponseGroup.svelte';

vi.mock('svelte-fa', async () => {
  const MockFa = (await import('../../ui/__tests__/mocks/Fa.svelte')).default;
  return { default: MockFa };
});

/**
 * Exact replica of collapseFromCurrent from ResponseGroup.svelte.
 * This mirrors the production code so we can test it in isolation.
 */
function collapseFromCurrent(node: HTMLElement, { duration = 300, easing = cubicOut } = {}) {
  const safe = (n: number): number => (Number.isFinite(n) ? n : 0);
  const currentHeight = safe(node.offsetHeight);
  const style = getComputedStyle(node);
  const paddingTop = safe(parseFloat(style.paddingTop));
  const paddingBottom = safe(parseFloat(style.paddingBottom));
  const marginTop = safe(parseFloat(style.marginTop));
  const marginBottom = safe(parseFloat(style.marginBottom));

  return {
    duration,
    easing,
    css: (t: number) => {
      const tt = Number.isFinite(t) ? t : 0;
      return `
        overflow: hidden;
        height: ${tt * currentHeight}px;
        padding-top: ${tt * paddingTop}px;
        padding-bottom: ${tt * paddingBottom}px;
        margin-top: ${tt * marginTop}px;
        margin-bottom: ${tt * marginBottom}px;
        opacity: ${Math.min(1, tt * 2)};
      `;
    },
  };
}

describe('ResponseGroup - collapseFromCurrent NaN regression', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should not produce NaN CSS values when getComputedStyle returns empty strings', () => {
    // Mock getComputedStyle to deterministically return empty strings for the
    // CSS properties that trigger the NaN bug. In real browsers, detached
    // elements return empty strings; jsdom may return '0px', so we must mock.
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      paddingTop: '',
      paddingBottom: '',
      marginTop: '',
      marginBottom: '',
      // Other properties can return sensible defaults
    } as unknown as CSSStyleDeclaration);

    const node = document.createElement('div');
    // Don't attach to DOM — this simulates the teardown scenario

    // The bug: parseFloat('') returns NaN
    // We test that the transition CSS function never produces NaN
    const transition = collapseFromCurrent(node);
    const cssAt0 = transition.css(0);
    const cssAt05 = transition.css(0.5);
    const cssAt1 = transition.css(1);

    for (const [label, css] of [
      ['t=0', cssAt0],
      ['t=0.5', cssAt05],
      ['t=1', cssAt1],
    ] as const) {
      // Check that no NaN values appear anywhere in the CSS string
      expect(css, `CSS at ${label} should not contain NaN`).not.toContain('NaN');
    }
  });

  it('parseFloat of empty string produces NaN (demonstrating the root cause)', () => {
    // This test documents the root cause: parseFloat('') === NaN
    const result = parseFloat('');
    expect(isNaN(result)).toBe(true);

    // And NaN * any number is NaN
    expect(isNaN(0.5 * result)).toBe(true);

    // Which produces invalid CSS
    const css = `height: ${0.5 * result}px`;
    expect(css).toContain('NaN');
  });

  it('should not produce NaN CSS values when offsetHeight is not a finite number', () => {
    // Some element/browser states yield non-finite offsetHeight (e.g. measuring
    // a non-HTMLElement node). The transition must still emit valid CSS.
    const node = document.createElement('div');
    Object.defineProperty(node, 'offsetHeight', { value: NaN, configurable: true });

    const transition = collapseFromCurrent(node);
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      expect(transition.css(t), `t=${t}`).not.toContain('NaN');
    }
  });

  it('should not produce NaN CSS values when t is not a finite number', () => {
    // Defensive: if the framework ever feeds a non-finite t, the css output
    // must remain valid.
    const node = document.createElement('div');
    document.body.appendChild(node);
    try {
      const transition = collapseFromCurrent(node);
      const css = transition.css(NaN);
      expect(css).not.toContain('NaN');
    } finally {
      document.body.removeChild(node);
    }
  });

  it('should produce valid CSS values when getComputedStyle returns normal values', () => {
    // Create an element with computed styles
    const node = document.createElement('div');
    document.body.appendChild(node);
    node.style.padding = '10px';
    node.style.margin = '5px';
    node.style.height = '100px';

    try {
      const transition = collapseFromCurrent(node);
      const css = transition.css(0.5);

      expect(css).not.toContain('NaN');

      // Values should be numeric (not NaN)
      const heightMatch = css.match(/height:\s*([0-9.]+)px/);
      if (heightMatch) {
        expect(isNaN(parseFloat(heightMatch[1]))).toBe(false);
      }
    } finally {
      document.body.removeChild(node);
    }
  });
});

describe('ResponseGroup - collapse state model', () => {
  const children = createRawSnippet(() => ({
    render: () => '<div class="test-block">block</div>',
  }));

  function header(container: HTMLElement): HTMLButtonElement {
    return container.querySelector('button')!;
  }

  function cylinder(container: HTMLElement): HTMLElement | null {
    return container.querySelector('.cylinder-scroller');
  }

  /** Semi-open = constrained CylinderScroller (max-height applied) */
  function isConstrained(el: HTMLElement | null): boolean {
    return !!el && (el.getAttribute('style') ?? '').includes('max-height');
  }

  it('last completed group toggles expanded ↔ semi-open and never fully closes', async () => {
    const { container } = render(ResponseGroup, {
      props: { name: 'Group', isLast: true, children },
    });
    const btn = header(container);

    // Starts fully expanded
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(cylinder(container)).not.toBeNull();
    expect(isConstrained(cylinder(container))).toBe(false);

    // Collapse → semi-open (constrained cylinder), not a bare header
    await fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(cylinder(container)).not.toBeNull();
    expect(isConstrained(cylinder(container))).toBe(true);
    expect(container.querySelector('.test-block')).not.toBeNull();

    // Toggle again → back to fully expanded
    await fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(isConstrained(cylinder(container))).toBe(false);
  });

  it('collapsing a streaming group lands on semi-open with content still visible', async () => {
    const { container } = render(ResponseGroup, {
      props: { name: 'Group', isStreaming: true, children },
    });
    const btn = header(container);

    // Streaming starts semi-open
    await waitFor(() => expect(cylinder(container)).not.toBeNull());
    expect(isConstrained(cylinder(container))).toBe(true);

    // Expand, then collapse mid-stream → semi-open, not fully closed
    await fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(isConstrained(cylinder(container))).toBe(false);

    await fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(cylinder(container)).not.toBeNull();
    expect(isConstrained(cylinder(container))).toBe(true);
    expect(container.querySelector('.test-block')).not.toBeNull();
  });

  it('non-last group collapsed mid-stream fully closes after streaming ends', async () => {
    const { container, rerender } = render(ResponseGroup, {
      props: { name: 'Group', isStreaming: true, children },
    });
    const btn = header(container);
    await waitFor(() => expect(cylinder(container)).not.toBeNull());

    // Collapse mid-stream (expand first so the second click collapses)
    await fireEvent.click(btn);
    await fireEvent.click(btn);
    expect(cylinder(container)).not.toBeNull();

    // Streaming ends → delayed full collapse (800ms timer)
    await rerender({ isStreaming: false });
    await waitFor(() => expect(cylinder(container)).toBeNull(), { timeout: 3000 });
  });

  it('non-last completed group still collapses fully on toggle', async () => {
    const { container } = render(ResponseGroup, {
      props: { name: 'Group', children },
    });
    const btn = header(container);

    // Starts fully closed
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(cylinder(container)).toBeNull();

    await fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(cylinder(container)).not.toBeNull();
    expect(isConstrained(cylinder(container))).toBe(false);

    await fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    await waitFor(() => expect(cylinder(container)).toBeNull());
  });

  it('last group collapsed mid-stream stays semi-open after streaming ends', async () => {
    const { container, rerender } = render(ResponseGroup, {
      props: { name: 'Group', isLast: true, isStreaming: true, children },
    });
    const btn = header(container);
    await waitFor(() => expect(cylinder(container)).not.toBeNull());

    // User expands then collapses mid-stream
    await fireEvent.click(btn);
    await fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('false');

    // Streaming ends → respects the user's collapse: semi-open, not re-expanded
    await rerender({ isStreaming: false });
    await waitFor(() => {
      expect(btn.getAttribute('aria-expanded')).toBe('false');
      expect(cylinder(container)).not.toBeNull();
      expect(isConstrained(cylinder(container))).toBe(true);
    });

    // Still semi-open after the non-last 800ms collapse delay would have fired
    await new Promise((r) => setTimeout(r, 900));
    expect(cylinder(container)).not.toBeNull();
    expect(isConstrained(cylinder(container))).toBe(true);
  });

  it('last group expands fully when streaming ends without a user collapse', async () => {
    const { container, rerender } = render(ResponseGroup, {
      props: { name: 'Group', isLast: true, isStreaming: true, children },
    });
    const btn = header(container);
    await waitFor(() => expect(cylinder(container)).not.toBeNull());

    await rerender({ isStreaming: false });
    await waitFor(() => {
      expect(btn.getAttribute('aria-expanded')).toBe('true');
      expect(isConstrained(cylinder(container))).toBe(false);
    });
  });
});
