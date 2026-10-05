import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import DiagramRenderer from '../DiagramRenderer.svelte';
import {
  DIAGRAM_WORKBENCH_CASES,
  type DiagramWorkbenchState,
} from '../diagram-workbench.preview-fixtures';

function customDiagram(state: DiagramWorkbenchState) {
  const fixture = DIAGRAM_WORKBENCH_CASES[state];
  if (fixture.kind !== 'custom') throw new Error(`${state} is not a custom diagram fixture`);
  return fixture.diagram;
}

beforeEach(() => {
  document.documentElement.classList.add('catalog-reduced-motion');
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove('catalog-reduced-motion');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('custom diagram accessibility', () => {
  it('renders bound nodes as named keyboard-focusable buttons', async () => {
    const onBindingClick = vi.fn();
    const result = render(DiagramRenderer, {
      props: { diagram: customDiagram('custom-bindings'), onBindingClick },
    });

    const boundNode = await waitFor(() => {
      const node = result.container.querySelector<HTMLButtonElement>('.node-clickable');
      expect(node).toBeTruthy();
      return node!;
    });
    expect(boundNode.tagName).toBe('BUTTON');
    expect(boundNode.getAttribute('aria-label')?.replace(/\s+/g, ' ')).toContain(
      'Open Review retry criteria note binding',
    );
    boundNode.focus();
    expect(document.activeElement).toBe(boundNode);
    await fireEvent.click(boundNode);
    expect(onBindingClick).toHaveBeenCalledWith(expect.any(MouseEvent), {
      type: 'note',
      target: 'bf4d5bc8-15d8-4fbb-bb82-b6fea9f2d4b2',
    });
  });

  it('uses finite arrow-key walkthrough navigation with roving focus', async () => {
    const onUpdate = vi.fn();
    const result = render(DiagramRenderer, {
      props: { diagram: customDiagram('custom-walkthrough'), onUpdate },
    });
    const steps = await waitFor(() => {
      const nodes = result.container.querySelectorAll<HTMLButtonElement>(
        '[data-diagram-step-index]',
      );
      expect(nodes).toHaveLength(3);
      return [...nodes];
    });
    const previous = result.getByRole('button', { name: 'Previous step' });
    const next = result.getByRole('button', { name: 'Next step' });

    expect(previous.hasAttribute('disabled')).toBe(true);
    expect(steps.map((step) => step.tabIndex)).toEqual([0, -1, -1]);
    steps[0].focus();
    await fireEvent.keyDown(steps[0], { key: 'ArrowRight' });

    expect(onUpdate).toHaveBeenLastCalledWith({ currentStateId: 'execute' });
    expect(document.activeElement).toBe(steps[1]);
    expect(previous.hasAttribute('disabled')).toBe(false);
    expect(next.hasAttribute('disabled')).toBe(false);
  });

  it('exposes fit-to-width and clear empty guidance', async () => {
    const result = render(DiagramRenderer, {
      props: { diagram: customDiagram('custom-data-flow'), viewResetKey: 'data-flow' },
    });
    const scroller = result.container.querySelector('.diagram-scroll-container') as HTMLDivElement;
    const camera = result.container.querySelector('.diagram-svg-layer') as SVGSVGElement;
    Object.defineProperty(scroller, 'clientWidth', { configurable: true, value: 160 });
    const fit = result.getByRole('button', { name: 'Fit diagram to width' });
    await fireEvent.click(fit);
    expect(fit.getAttribute('aria-pressed')).toBe('true');
    expect(camera.style.transform).toMatch(/^scale\(0\./);

    await result.rerender({
      diagram: customDiagram('custom-data-flow'),
      viewResetKey: 'state-machine',
    });
    expect(fit.getAttribute('aria-pressed')).toBe('false');
    expect(camera.style.transform).toBe('');

    result.unmount();
    const empty = render(DiagramRenderer, {
      props: { diagram: customDiagram('custom-empty-content') },
    });
    expect((await empty.findByRole('status')).textContent).toContain('Diagram has no nodes');
    expect(empty.getByRole('status').textContent).toContain('Add nodes to the diagram source');
  });
});
