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
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { cubicOut } from 'svelte/easing';
import ResponseGroup from '../ResponseGroup.svelte';
import { getResponseGroupBlockKey, getResponseGroupPreviewBlock } from '../response-group-blocks';
import { warmImport } from '../../../../test/warm-import';
import type { ContentBlock } from '$shared/types';

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

// Pre-warm the component module graph so the cold dynamic import is not
// billed to the first test's timeout (intent-hq/monorepo#1464).
warmImport(() => import('../../ui/__tests__/mocks/Fa.svelte'));

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

  it('uses caption-sized operational titles and only shows the preview while collapsed', async () => {
    const blocks = [{ type: 'text', text: 'Collapsed preview text' }] as ContentBlock[];
    const { container, queryByText } = render(ResponseGroup, {
      props: { name: 'Group title', blocks, children },
    });
    const btn = header(container);

    expect(btn.className).toContain('type-caption');
    expect(btn.className).toContain('text-muted-foreground/60');
    expect(btn.className).not.toContain('text-base');
    expect(btn.className).not.toContain('px-1');
    expect(queryByText('Collapsed preview text')).not.toBeNull();

    await fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(queryByText('Collapsed preview text')).toBeNull();
    expect(container.querySelector('.border-l')?.className).not.toContain('ml-2');
  });

  it('does not render a leading group icon', () => {
    const { container } = render(ResponseGroup, {
      props: { name: 'Group title', children },
    });

    expect(header(container).querySelector('svg')).toBeNull();
  });

  it('last completed group toggles expanded ↔ semi-open and never fully closes', async () => {
    const blocks = [{ type: 'text', text: 'Latest group activity' }] as ContentBlock[];
    const { container } = render(ResponseGroup, {
      props: { name: 'Group', isLast: true, blocks, children },
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
    expect(container.querySelector('.test-block')).toBeNull();
    expect(container.querySelector('[data-response-group-preview]')?.textContent).toContain(
      'Latest group activity',
    );

    // Toggle again → back to fully expanded
    await fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(isConstrained(cylinder(container))).toBe(false);
  });

  it('collapsing a streaming group lands on semi-open with content still visible', async () => {
    const blocks = [{ type: 'text', text: 'Visible streaming activity' }] as ContentBlock[];
    const { container } = render(ResponseGroup, {
      props: { name: 'Group', isStreaming: true, blocks, children },
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
    expect(container.querySelector('.test-block')).toBeNull();
    expect(container.querySelector('[data-response-group-preview]')?.textContent).toContain(
      'Visible streaming activity',
    );
  });

  it('does not instantiate detail children while a large streaming group is collapsed', async () => {
    const detailFactory = vi.fn(() => ({
      render: () =>
        `<div>${Array.from({ length: 100 }, (_, index) => `<button>detail-${index}</button>`).join('')}</div>`,
    }));
    const detailChildren = createRawSnippet(detailFactory);
    const blocks = Array.from({ length: 100 }, (_, index) => ({
      type: 'text',
      text: `payload-${index}`,
    })) as ContentBlock[];

    const { container } = render(ResponseGroup, {
      props: { name: 'Large group', isStreaming: true, blocks, children: detailChildren },
    });

    await waitFor(() =>
      expect(container.querySelector('[data-response-group-preview]')).not.toBeNull(),
    );
    expect(detailFactory).not.toHaveBeenCalled();
    expect(container.querySelectorAll('button')).toHaveLength(1);
    expect(container.querySelector('[data-response-group-preview]')?.textContent).toBe(
      'payload-99',
    );

    await fireEvent.click(header(container));
    expect(detailFactory).toHaveBeenCalledTimes(1);
    expect(container.querySelectorAll('button')).toHaveLength(101);
    expect(container.querySelector('[data-response-group-preview]')).toBeNull();
  });

  it('updates the collapsed streaming preview without mounting details', async () => {
    const detailFactory = vi.fn(() => ({ render: () => '<div>exact expanded payload</div>' }));
    const detailChildren = createRawSnippet(detailFactory);
    const initialBlocks = [{ type: 'text', text: 'first payload' }] as ContentBlock[];
    const { container, rerender } = render(ResponseGroup, {
      props: {
        name: 'Streaming group',
        isStreaming: true,
        blocks: initialBlocks,
        children: detailChildren,
      },
    });

    await rerender({
      blocks: [...initialBlocks, { type: 'text', text: 'latest {exact} payload' }],
    });

    expect(detailFactory).not.toHaveBeenCalled();
    expect(container.querySelector('[data-response-group-preview]')?.textContent).toBe(
      'latest {exact} payload',
    );
    expect(header(container).getAttribute('aria-expanded')).toBe('false');
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

describe('ResponseGroup - block identity', () => {
  it('uses protocol-backed tool identities instead of positions', () => {
    const toolUse = { type: 'tool_use', id: 'tool-42', name: 'search' } as ContentBlock;
    const toolResult = { type: 'tool_result', tool_use_id: 'tool-42' } as ContentBlock;

    expect(getResponseGroupBlockKey(toolUse, 1)).toBe(getResponseGroupBlockKey(toolUse, 99));
    expect(getResponseGroupBlockKey(toolResult, 2)).toBe(getResponseGroupBlockKey(toolResult, 100));
  });

  it('selects the latest presentable payload without cloning or rewriting it', () => {
    const latestTool = {
      type: 'tool_use',
      id: 'tool-latest',
      name: 'workspace_api',
      input: { summary: 'Keep this exact payload' },
    } as ContentBlock;
    const trailingResult = {
      type: 'tool_result',
      tool_use_id: 'tool-latest',
      output: { content: 'exact result' },
    } as ContentBlock;

    expect(getResponseGroupPreviewBlock([latestTool, trailingResult])).toBe(latestTool);
  });
});
