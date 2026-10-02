import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { flushSync, tick } from 'svelte';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DiagramPrimitive } from '$shared/types/notes-primitives';
import { computeLayout, measureEdgeLabel } from '../layout-engine';
import DiagramRenderer from '../DiagramRenderer.svelte';
import { DEFAULT_NODE_STYLE } from '../types';

vi.mock('../layout-engine', async (load) => {
  const actual = await load<typeof import('../layout-engine')>();
  return {
    ...actual,
    computeLayout: vi.fn(actual.computeLayout),
    measureEdgeLabel: vi.fn(actual.measureEdgeLabel),
  };
});

let resolveFonts: () => void;
let originalFonts: PropertyDescriptor | undefined;
let glyphWidth: number;
let frames: Map<number, FrameRequestCallback>;

beforeEach(() => {
  vi.mocked(computeLayout).mockClear();
  vi.mocked(measureEdgeLabel).mockClear();
  originalFonts = Object.getOwnPropertyDescriptor(document, 'fonts');
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: {
      ready: new Promise<void>((resolve) => {
        resolveFonts = resolve;
      }),
    },
  });
  glyphWidth = 5;
  vi.stubGlobal('CanvasRenderingContext2D', class {});
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    font: '',
    measureText: (text: string) => ({ width: text.length * glyphWidth }),
  } as unknown as CanvasRenderingContext2D);
  frames = new Map();
  let frameId = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(960);
  Object.defineProperty(Element.prototype, 'getAnimations', {
    configurable: true,
    value: () => [],
  });
  document.documentElement.classList.add('catalog-reduced-motion');
});

afterEach(() => {
  cleanup();
  if (originalFonts) Object.defineProperty(document, 'fonts', originalFonts);
  else Reflect.deleteProperty(document, 'fonts');
  document.documentElement.classList.remove('catalog-reduced-motion');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function diagram(): DiagramPrimitive {
  return {
    id: 'publication',
    type: 'diagram',
    version: 1,
    createdAt: '2026-10-02T00:00:00.000Z',
    createdBy: 'user',
    grammar: 'flowchart',
    model: {
      nodes: [
        { id: 'a', label: 'Input document' },
        { id: 'b', label: 'Output document' },
      ],
      edges: [{ id: 'ab', from: 'a', to: 'b', label: 'transforms' }],
    },
    baseView: { layout: { type: 'layered', direction: 'LR' } },
  };
}

function geometry(container: HTMLElement) {
  return [...container.querySelectorAll('foreignObject[data-node-id]')].map((node) =>
    ['x', 'y', 'width', 'height'].map((attribute) => node.getAttribute(attribute)),
  );
}

async function settle() {
  await tick();
  flushSync();
}

it('remeasures ready fonts without republishing unchanged layout to edge-label placement', async () => {
  const result = render(DiagramRenderer, { diagram: diagram() });
  await settle();
  const before = geometry(result.container);
  expect(before).toHaveLength(2);
  const layouts = vi.mocked(computeLayout).mock.calls.length;
  const labels = vi.mocked(measureEdgeLabel).mock.calls.length;
  expect(labels).toBeGreaterThan(0);
  resolveFonts();
  await settle();
  expect(vi.mocked(computeLayout).mock.calls.length).toBeGreaterThan(layouts);
  expect(geometry(result.container)).toEqual(before);
  expect(measureEdgeLabel).toHaveBeenCalledTimes(labels);
  const renderer = result.container.querySelector('.diagram-renderer')!;
  expect(renderer.getAttribute('data-diagram-settled')).toBe('false');
  for (let i = 0; i < 10 && frames.size; i += 1) {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback(performance.now()));
    await settle();
  }
  expect(renderer.getAttribute('data-diagram-settled')).toBe('true');
  expect(frames.size).toBe(0);
});

it('publishes changed measured font geometry and preserves current labels', async () => {
  const result = render(DiagramRenderer, { diagram: diagram() });
  await settle();
  const before = geometry(result.container);
  glyphWidth = 12;
  resolveFonts();
  await settle();
  expect(geometry(result.container)).not.toEqual(before);
  expect(result.container.querySelector('[data-node-id="a"]')?.textContent).toContain(
    'Input document',
  );
  expect(result.container.querySelector('.edge-label-html')?.textContent).toContain('transforms');
});

it('does not remeasure or queue settlement after disposal while fonts are pending', async () => {
  const result = render(DiagramRenderer, { diagram: diagram() });
  await settle();
  result.unmount();
  const calls = vi.mocked(computeLayout).mock.calls.length;
  resolveFonts();
  await settle();
  expect(computeLayout).toHaveBeenCalledTimes(calls);
  expect(frames.size).toBe(0);
});

it('publishes replacement content, bindings and style while retaining the renderer', async () => {
  const input = diagram();
  input.model.nodes[0].binding = { type: 'file', target: 'old.ts' };
  const onBindingClick = vi.fn();
  const result = render(DiagramRenderer, { diagram: input, onBindingClick });
  await settle();
  const renderer = result.container.querySelector('.diagram-renderer');
  const before = geometry(result.container);
  const next = diagram();
  next.model.nodes[0].label = 'Replaced document';
  next.model.nodes[0].binding = { type: 'file', target: 'new.ts' };
  await result.rerender({
    diagram: next,
    onBindingClick,
    styleConfig: { ...DEFAULT_NODE_STYLE, paddingY: 24 },
  });
  await settle();
  expect(result.container.querySelector('.diagram-renderer')).toBe(renderer);
  expect(geometry(result.container)).not.toEqual(before);
  expect(result.container.querySelector('[data-node-id="a"]')?.textContent).toContain(
    'Replaced document',
  );
  await fireEvent.click(result.container.querySelector('[data-node-id="a"] button')!);
  expect(onBindingClick).toHaveBeenLastCalledWith(expect.any(MouseEvent), {
    type: 'file',
    target: 'new.ts',
  });
});

it('republishes a previously equal result after a failed layout clears the scene', async () => {
  const input = diagram();
  const result = render(DiagramRenderer, { diagram: input });
  await settle();
  const before = geometry(result.container);
  vi.mocked(computeLayout).mockImplementationOnce(() => {
    throw new Error('controlled layout failure');
  });
  await result.rerender({ diagram: diagram() });
  await settle();
  expect(result.container.querySelector('[data-node-id="a"]')).toBeNull();
  await result.rerender({ diagram: diagram() });
  await settle();
  expect(geometry(result.container)).toEqual(before);
});
