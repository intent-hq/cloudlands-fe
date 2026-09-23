import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiagramGrammar } from '$shared/types/notes-primitives';
import { parseIncrementalDiagramJson } from '$lib/utils/incrementalDiagramJson';
import StreamingDiagramRenderer from '../StreamingDiagramRenderer.svelte';

function header(grammar: DiagramGrammar = 'flowchart') {
  return JSON.stringify({
    id: '10000000-0000-4000-8000-000000000001',
    type: 'diagram',
    version: 1,
    createdAt: '2026-09-22T00:00:00.000Z',
    createdBy: 'agent',
    grammar,
    baseView: { layout: { type: 'layered', direction: 'LR' } },
  }).slice(0, -1);
}

const firstNode = '{"id":"a","label":"Input","binding":{"type":"file","target":"src/input.ts"}}';
const secondNode = '{"id":"b","label":"Output"}';
const start = '{"id":"start","visibleNodes":["a"]}';
const finish = '{"id":"finish","visibleNodes":["b"]}';

function props(source: string, finalized = false) {
  const result = parseIncrementalDiagramJson(source, finalized);
  return { diagram: result.diagram, isStreaming: !finalized, source, sourceError: result.error };
}

function nodes(container: HTMLElement) {
  return [...container.querySelectorAll('[data-node-id]')].map((node) =>
    node.getAttribute('data-node-id'),
  );
}

function steps(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLButtonElement>('[data-diagram-step-index]')];
}

let frames: Map<number, FrameRequestCallback>;
let frameId = 0;

beforeEach(() => {
  document.documentElement.classList.add('catalog-reduced-motion');
  frames = new Map();
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
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() });
  Object.defineProperty(Element.prototype, 'getAnimations', {
    configurable: true,
    value: () => [],
  });
});

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove('catalog-reduced-motion');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('streaming diagram presentation lifecycle', () => {
  it.each<DiagramGrammar>([
    'architecture',
    'sequence',
    'state_machine',
    'data_flow',
    'network',
    'flowchart',
    'timeline',
    'dependency_graph',
  ])(
    'renders growing %s content before JSON root closure without replacing the drawing',
    async (grammar) => {
      const prefix = `${header(grammar)},"model":{"nodes":[`;
      const result = render(StreamingDiagramRenderer, { props: props(prefix) });
      expect(result.container.querySelector('[role="status"]')).not.toBeNull();
      expect(nodes(result.container)).toEqual([]);
      const one = `${prefix}${firstNode}`;
      await result.rerender(props(one));
      await waitFor(() => expect(nodes(result.container)).toEqual(['a']));
      const drawing = result.container.querySelector('svg.diagram-svg-layer');
      const two = `${one},${secondNode}],"edges":[{"id":"ab","from":"a","to":"b"}`;
      await result.rerender(props(two));
      await waitFor(() => expect(nodes(result.container)).toEqual(['a', 'b']));
      expect(result.container.querySelector('svg.diagram-svg-layer')).toBe(drawing);
      expect(
        result.container.querySelector('[data-diagram-streaming]')?.getAttribute('aria-busy'),
      ).toBe('true');
      await result.rerender(props(`${two}]}}`, true));
      expect(result.container.querySelector('svg.diagram-svg-layer')).toBe(drawing);
      expect(
        result.container.querySelector('[data-diagram-streaming]')?.getAttribute('aria-busy'),
      ).toBe('false');
    },
  );

  it('keeps the selected step and binding through appended groups/states and final validation', async () => {
    const base = `${header()},"model":{"nodes":[${firstNode},${secondNode}],"edges":[],"groups":[{"id":"all","label":"All","nodeIds":["a","b"]}]},"states":[${start},${finish}`;
    const onBindingClick = vi.fn();
    const result = render(StreamingDiagramRenderer, { props: { ...props(base), onBindingClick } });
    await waitFor(() => expect(nodes(result.container)).toEqual(['a']));
    await fireEvent.click(
      result.container.querySelector<HTMLButtonElement>('[data-node-id="a"] button')!,
    );
    expect(onBindingClick).toHaveBeenCalledWith(expect.any(MouseEvent), {
      type: 'file',
      target: 'src/input.ts',
    });
    await fireEvent.click(steps(result.container)[1]);
    await waitFor(() => expect(nodes(result.container)).toEqual(['b']));
    const drawing = result.container.querySelector('svg.diagram-svg-layer');
    const appended = `${base},{"id":"together","visibleNodes":["a","b"],"visibleGroups":["all"]}`;
    await result.rerender({ ...props(appended), onBindingClick });
    expect(steps(result.container)).toHaveLength(3);
    expect(steps(result.container)[1].getAttribute('aria-current')).toBe('step');
    expect(nodes(result.container)).toEqual(['b']);
    expect(result.container.querySelector('svg.diagram-svg-layer')).toBe(drawing);
    await result.rerender({ ...props(`${appended}]}`, true), onBindingClick });
    expect(steps(result.container)[1].getAttribute('aria-current')).toBe('step');
    expect(result.container.querySelector('svg.diagram-svg-layer')).toBe(drawing);
    await fireEvent.click(steps(result.container)[2]);
    await waitFor(() => expect(nodes(result.container)).toEqual(['a', 'b']));
    expect(result.container.querySelector('[data-group-id="all"]')).not.toBeNull();
  });

  it('retains the last good preview on unfinished null projection but clears final invalid data', async () => {
    const source = `${header()},"model":{"nodes":[${firstNode}`;
    const result = render(StreamingDiagramRenderer, { props: props(source) });
    await waitFor(() => expect(nodes(result.container)).toEqual(['a']));
    const unfinished = source + ',{"id":"b","label":"unfinished';
    await result.rerender({ diagram: null, source: unfinished, isStreaming: true });
    expect(nodes(result.container)).toEqual(['a']);
    await result.rerender(props(unfinished, true));
    expect(nodes(result.container)).toEqual([]);
    expect(result.container.querySelector('[role="alert"]')).not.toBeNull();
    expect(result.container.querySelector('pre')?.textContent).toBe(unfinished);
  });

  it('does not invent a walkthrough before completed states arrive', async () => {
    const source = `${header()},"model":{"nodes":[${firstNode},${secondNode}],"edges":[]},"states":[`;
    const result = render(StreamingDiagramRenderer, { props: props(source) });
    await waitFor(() => expect(nodes(result.container)).toEqual(['a', 'b']));
    expect(steps(result.container)).toHaveLength(0);
    await result.rerender(props(source + start));
    await waitFor(() => expect(nodes(result.container)).toEqual(['a']));
    expect(steps(result.container)).toHaveLength(1);
    await result.rerender(props(`${source}${start},${finish}`));
    expect(nodes(result.container)).toEqual(['a']);
    expect(steps(result.container)[0].getAttribute('aria-current')).toBe('step');
  });

  it('does not retain previews across a replacement identity or non-append source', async () => {
    const source = `${header()},"model":{"nodes":[${firstNode}`;
    const result = render(StreamingDiagramRenderer, {
      props: { ...props(source), viewResetKey: 'first' },
    });
    await waitFor(() => expect(nodes(result.container)).toEqual(['a']));
    await result.rerender({ diagram: null, source, isStreaming: true, viewResetKey: 'second' });
    expect(nodes(result.container)).toEqual([]);
    await result.rerender({ ...props(source), viewResetKey: 'second' });
    await waitFor(() => expect(nodes(result.container)).toEqual(['a']));
    await result.rerender({ diagram: null, source: '{', isStreaming: true });
    expect(nodes(result.container)).toEqual([]);
    result.unmount();
    await tick();
    expect(frames.size).toBe(0);
  });
});
