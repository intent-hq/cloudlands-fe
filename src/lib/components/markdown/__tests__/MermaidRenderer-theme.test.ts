import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/svelte';
import { color } from 'd3';

const mermaidMocks = vi.hoisted(() => ({
  initialize: vi.fn(),
  registerLayoutLoaders: vi.fn(),
  render: vi.fn(async () => ({ svg: '<svg aria-roledescription="sequence"></svg>' })),
  mermaidAPI: {
    getDiagramFromText: vi.fn(async () => ({
      type: 'flowchart-v2',
      db: { getSubGraphs: () => [{ id: 'workers', nodes: ['B'] }] },
    })),
  },
}));

vi.mock('mermaid', () => ({ default: mermaidMocks }));
vi.mock('mermaid-layout-elk', () => ({ default: vi.fn() }));

import MermaidRenderer from '../MermaidRenderer.svelte';

const tokens = {
  '--background': '0 0% 100%',
  '--foreground': '0 0% 8%',
  '--card': '0 0% 98%',
  '--card-foreground': '0 0% 8%',
  '--muted': '210 12% 92%',
  '--muted-foreground': '210 8% 35%',
  '--border': '210 10% 82%',
  '--accent': '145 30% 90%',
  '--accent-foreground': '145 50% 20%',
  '--diagram-canvas': 'hsl(0 0% 100%)',
  '--diagram-node-surface': 'hsl(0 0% 96%)',
  '--diagram-connector': 'rgb(118 124 132)',
  '--font-ui': 'Inter, system-ui, sans-serif',
  '--text-caption-size': '0.8125rem',
  '--radius-small': '5px',
};

// Independent WCAG oracle, matching the local label tests rather than the repair's choice.
function contrast(foreground: string, background: string): number {
  const luminance = (value: string) => {
    const { r, g, b } = color(value)!.rgb();
    const channels = [r, g, b].map((channel) => {
      const s = channel / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

describe('MermaidRenderer theme updates', () => {
  beforeEach(() => {
    mermaidMocks.initialize.mockClear();
    mermaidMocks.render.mockClear();
    mermaidMocks.mermaidAPI.getDiagramFromText.mockClear();
    for (const [name, value] of Object.entries(tokens)) {
      document.documentElement.style.setProperty(name, value);
    }
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.documentElement.classList.remove('catalog-full-motion', 'catalog-reduced-motion');
    for (const name of Object.keys(tokens)) {
      document.documentElement.style.removeProperty(name);
    }
    document.documentElement.style.removeProperty('--terminal-overlay-height');
  });

  it('rerenders with current tokens when a custom theme changes root styles', async () => {
    const result = render(MermaidRenderer, { code: 'sequenceDiagram\nA->>B: Ready' });
    await waitFor(() => expect(mermaidMocks.initialize).toHaveBeenCalledOnce());
    expect(result.container.querySelector('svg[aria-roledescription="sequence"]')).toBeTruthy();

    document.documentElement.style.setProperty('--diagram-node-surface', '260 20% 18%');

    await waitFor(() => expect(mermaidMocks.initialize).toHaveBeenCalledTimes(2));
    const latestConfig = mermaidMocks.initialize.mock.calls.at(-1)?.[0];
    expect(latestConfig.themeVariables.primaryColor).toBe('hsl(260 20% 18%)');
  });

  it('ignores root style changes that do not affect the Mermaid theme', async () => {
    render(MermaidRenderer, { code: 'sequenceDiagram\nA->>B: Ready' });
    await waitFor(() => expect(mermaidMocks.initialize).toHaveBeenCalledOnce());

    document.documentElement.style.setProperty('--terminal-overlay-height', '36px');
    await new Promise((resolve) => setTimeout(resolve, 0));
    document.documentElement.style.setProperty('--terminal-overlay-height', '48px');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mermaidMocks.initialize).toHaveBeenCalledOnce();
  });

  it('reapplies local contrast to new SVG output after a live theme change', async () => {
    const authoredPaints: { fill: string; priority: string }[] = [];
    const output = async () => {
      const svg = `<svg aria-roledescription="flowchart-v2" style="background-color:${document.documentElement.style.getPropertyValue('--diagram-canvas')}">
        <g class="node"><rect style="fill:none"/><g class="label">
          <text style="fill:#ffffff">Present label</text>
        </g></g></svg>`;
      const source = document.createElement('div');
      source.innerHTML = svg;
      const label = source.querySelector<SVGElement>('text')!;
      authoredPaints.push({
        fill: label.style.fill,
        priority: label.style.getPropertyPriority('fill'),
      });
      return { svg };
    };
    mermaidMocks.render.mockImplementationOnce(output).mockImplementationOnce(output);
    const result = render(MermaidRenderer, { code: 'flowchart TB\nA[Present label]' });
    const expectForeground = (expected: string, background: string) => {
      const text = result.container.querySelector<SVGElement>('text')!;
      const foreground = getComputedStyle(text).fill;
      expect(color(foreground)?.rgb()).toEqual(color(expected)!.rgb());
      expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
      return text;
    };
    const initialText = await waitFor(() => expectForeground('#000000', '#ffffff'));
    document.documentElement.style.setProperty('--diagram-canvas', '#000000');
    await waitFor(() => expect(mermaidMocks.render).toHaveBeenCalledTimes(2));
    await waitFor(() => {
      const text = expectForeground('#ffffff', '#000000');
      expect(text).not.toBe(initialText);
      expect(text.style.fill).toBe(authoredPaints[1].fill);
      expect(text.style.getPropertyPriority('fill')).toBe(authoredPaints[1].priority);
    });
  });

  it('keeps class diagrams on SVG labels for geometry repair', async () => {
    render(MermaidRenderer, { code: 'classDiagram\n  class PreviewDefinition' });
    await waitFor(() => expect(mermaidMocks.initialize).toHaveBeenCalledOnce());
    expect(mermaidMocks.initialize.mock.calls[0]?.[0].htmlLabels).toBe(false);
  });

  it.each(['LR', 'RL', 'TB', 'TD', 'BT'])(
    'passes authored %s source unchanged to Mermaid in a compact host',
    async (direction) => {
      vi.stubGlobal(
        'ResizeObserver',
        class {
          observe() {}
          disconnect() {}
        },
      );
      const code = `flowchart ${direction}\n  A[Workspace tab] --> B[Remembered machine]`;
      render(MermaidRenderer, { code });
      await waitFor(() => expect(mermaidMocks.render).toHaveBeenCalledOnce());
      expect(mermaidMocks.render.mock.calls[0]?.[1]).toBe(code);
    },
  );

  it('defaults state diagrams to a vertical topology without overriding an explicit one', async () => {
    const { rerender } = render(MermaidRenderer, {
      code: 'stateDiagram-v2\n  [*] --> Idle',
    });
    await waitFor(() => expect(mermaidMocks.render).toHaveBeenCalledOnce());
    expect(mermaidMocks.render.mock.calls[0]?.[1]).toContain('direction TB');
    expect(mermaidMocks.initialize.mock.calls[0]?.[0]).toMatchObject({ layout: 'elk' });

    await rerender({ code: 'stateDiagram-v2\n  direction RL\n  [*] --> Idle' });
    await waitFor(() => expect(mermaidMocks.render).toHaveBeenCalledTimes(2));
    expect(mermaidMocks.render.mock.calls[1]?.[1]).toContain('direction RL');
    expect(mermaidMocks.render.mock.calls[1]?.[1].match(/direction\s+/g)).toHaveLength(1);
    expect(mermaidMocks.initialize.mock.calls[1]?.[0]).toMatchObject({ layout: 'elk' });
  });

  it('measures and presents diagrams with the application UI typography', async () => {
    render(MermaidRenderer, { code: 'sequenceDiagram\nA->>B: Ready' });
    await waitFor(() => expect(mermaidMocks.initialize).toHaveBeenCalledOnce());

    expect(mermaidMocks.initialize.mock.calls[0]?.[0]).toMatchObject({
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize: 13,
    });
  });

  it('does not initialize or render an unmounted diagram waiting in the queue', async () => {
    let finish!: (value: { svg: string }) => void;
    mermaidMocks.render.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(MermaidRenderer, { code: 'sequenceDiagram\nA->>B: First' });
    await waitFor(() => expect(mermaidMocks.render).toHaveBeenCalledOnce());
    const stale = render(MermaidRenderer, { code: 'sequenceDiagram\nA->>B: Cancelled' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    stale.unmount();
    const current = render(MermaidRenderer, { code: 'sequenceDiagram\nA->>B: Current' });
    finish({ svg: '<svg aria-roledescription="sequence"></svg>' });
    await waitFor(() => expect(mermaidMocks.render).toHaveBeenCalledTimes(2));
    expect(mermaidMocks.initialize).toHaveBeenCalledTimes(2);
    expect(mermaidMocks.render.mock.calls[1]?.[1]).toContain('Current');
    expect(current.container.querySelector('svg')).toBeTruthy();
  });

  it('discards obsolete output and skips superseded queued code', async () => {
    let finish!: (value: { svg: string }) => void;
    mermaidMocks.render.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const view = render(MermaidRenderer, { code: 'sequenceDiagram\nA->>B: First' });
    await waitFor(() => expect(mermaidMocks.render).toHaveBeenCalledOnce());
    await view.rerender({ code: 'sequenceDiagram\nA->>B: Superseded' });
    await view.rerender({ code: 'sequenceDiagram\nA->>B: Current' });
    finish({ svg: '<svg data-obsolete="true" aria-roledescription="sequence"></svg>' });
    await waitFor(() => expect(mermaidMocks.render).toHaveBeenCalledTimes(2));
    expect(mermaidMocks.render.mock.calls[1]?.[1]).toContain('Current');
    expect(view.container.querySelector('[data-obsolete]')).toBeNull();
  });

  it('discards a cancelled group parse before publishing SVG or fitting the next generation', async () => {
    let finish!: (
      value: Awaited<ReturnType<typeof mermaidMocks.mermaidAPI.getDiagramFromText>>,
    ) => void;
    mermaidMocks.mermaidAPI.getDiagramFromText.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    mermaidMocks.render.mockResolvedValueOnce({
      svg: '<svg data-obsolete="true" aria-roledescription="flowchart-v2"><g class="cluster"/></svg>',
    });
    const view = render(MermaidRenderer, {
      code: 'flowchart TB\nsubgraph workers\nB\nend',
    });
    await waitFor(() => expect(mermaidMocks.mermaidAPI.getDiagramFromText).toHaveBeenCalledOnce());
    await view.rerender({ code: 'sequenceDiagram\nA->>B: Current' });
    finish({
      type: 'flowchart-v2',
      db: { getSubGraphs: () => [{ id: 'workers', nodes: ['B'] }] },
    });
    await waitFor(() => expect(mermaidMocks.render).toHaveBeenCalledTimes(2));
    expect(view.container.querySelector('[data-obsolete]')).toBeNull();
    expect(view.container.querySelector('svg[aria-roledescription="sequence"]')).toBeTruthy();
    expect(mermaidMocks.mermaidAPI.getDiagramFromText).toHaveBeenCalledOnce();
  });

  it.each([
    { policy: 'catalog reduced', rootClass: 'catalog-reduced-motion', mediaMatches: false },
    { policy: 'OS reduced', rootClass: '', mediaMatches: true },
    { policy: 'battery saver', rootClass: '', mediaMatches: false, batterySaver: true },
  ])(
    'settles flowchart geometry without transition delays under $policy motion',
    async (policy) => {
      const getBBox = Object.getOwnPropertyDescriptor(SVGElement.prototype, 'getBBox');
      Object.defineProperty(SVGElement.prototype, 'getBBox', {
        configurable: true,
        value: () => ({ x: 0, y: 0, width: 300, height: 180 }),
      });
      vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      });
      vi.stubGlobal('cancelAnimationFrame', vi.fn());
      vi.spyOn(window, 'matchMedia').mockImplementation(
        (query) =>
          ({
            matches: policy.mediaMatches,
            media: query,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
          }) as unknown as MediaQueryList,
      );
      if (policy.rootClass) document.documentElement.classList.add(policy.rootClass);
      if (policy.batterySaver) document.documentElement.setAttribute('data-reduce-motion', '');
      mermaidMocks.render.mockResolvedValueOnce({
        svg: '<svg aria-roledescription="flowchart-v2" viewBox="0 0 300 180"></svg>',
      });
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

      try {
        const result = render(MermaidRenderer, { code: 'flowchart TB\nA --> B' });
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(0);
        await Promise.resolve();

        expect(result.container.querySelector('.mermaid-renderer')?.dataset.renderSettled).toBe(
          'true',
        );
      } finally {
        document.documentElement.removeAttribute('data-reduce-motion');
        if (getBBox) Object.defineProperty(SVGElement.prototype, 'getBBox', getBBox);
        else delete (SVGElement.prototype as SVGElement & { getBBox?: unknown }).getBBox;
      }
    },
  );

  it('keeps transition settlement under an explicit full-motion catalog override', async () => {
    const getBBox = Object.getOwnPropertyDescriptor(SVGElement.prototype, 'getBBox');
    Object.defineProperty(SVGElement.prototype, 'getBBox', {
      configurable: true,
      value: () => ({ x: 0, y: 0, width: 300, height: 180 }),
    });
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query) =>
        ({
          matches: true,
          media: query,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        }) as unknown as MediaQueryList,
    );
    document.documentElement.classList.add('catalog-full-motion');
    mermaidMocks.render.mockResolvedValueOnce({
      svg: '<svg aria-roledescription="flowchart-v2" viewBox="0 0 300 180"></svg>',
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    try {
      const result = render(MermaidRenderer, { code: 'flowchart TB\nA --> B' });
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
      expect(result.container.querySelector('.mermaid-renderer')?.dataset.renderSettled).toBe(
        'false',
      );

      await vi.runAllTimersAsync();
      expect(result.container.querySelector('.mermaid-renderer')?.dataset.renderSettled).toBe(
        'true',
      );
    } finally {
      if (getBBox) Object.defineProperty(SVGElement.prototype, 'getBBox', getBBox);
      else delete (SVGElement.prototype as SVGElement & { getBBox?: unknown }).getBBox;
    }
  });

  it('releases the global Mermaid queue before instance geometry settles', async () => {
    const getBBox = Object.getOwnPropertyDescriptor(SVGElement.prototype, 'getBBox');
    const pendingFrames: FrameRequestCallback[] = [];
    const stateData = {
      direction: 'TB',
      nodes: [{ id: 'Idle', domId: 'state-Idle', shape: 'rect' }],
      edges: [{ id: 'edge-1', start: 'root_start', end: 'Idle' }],
    };
    Object.defineProperty(SVGElement.prototype, 'getBBox', {
      configurable: true,
      value: () => ({ x: 0, y: 0, width: 300, height: 180 }),
    });
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      pendingFrames.push(callback);
      return pendingFrames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    document.documentElement.classList.add('catalog-reduced-motion');
    mermaidMocks.render
      .mockResolvedValueOnce({
        svg: '<svg class="statediagram" aria-roledescription="stateDiagram" viewBox="0 0 300 180"></svg>',
      })
      .mockResolvedValueOnce({
        svg: '<svg aria-roledescription="flowchart-v2" viewBox="0 0 300 180"><g class="cluster" id="render-workers"><rect width="100" height="80"/></g></svg>',
      });
    mermaidMocks.mermaidAPI.getDiagramFromText
      .mockResolvedValueOnce({ type: 'stateDiagram', db: { getData: () => stateData } })
      .mockImplementationOnce(async () => {
        stateData.nodes[0].id = 'reused-by-next-parse';
        return {
          type: 'flowchart-v2',
          db: { getSubGraphs: () => [{ id: 'workers', nodes: ['B'] }] },
        };
      });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);

    try {
      const first = render(MermaidRenderer, { code: 'stateDiagram-v2\n[*] --> Idle' });
      const second = render(MermaidRenderer, {
        code: 'flowchart TB\nsubgraph workers\nB\nend',
      });
      await waitFor(() => expect(mermaidMocks.render).toHaveBeenCalledTimes(2));
      expect(mermaidMocks.mermaidAPI.getDiagramFromText).toHaveBeenCalledTimes(2);
      expect(first.container.querySelector('.mermaid-renderer')?.dataset.renderSettled).toBe(
        'false',
      );
      expect(second.container.querySelector('.mermaid-renderer')?.dataset.renderSettled).toBe(
        'false',
      );

      for (let attempt = 0; attempt < 10; attempt += 1) {
        pendingFrames.splice(0).forEach((callback) => callback(0));
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (
          first.container.querySelector('.mermaid-renderer')?.dataset.renderSettled === 'true' &&
          second.container.querySelector('.mermaid-renderer')?.dataset.renderSettled === 'true'
        )
          break;
      }
      expect(first.container.querySelector('.mermaid-renderer')?.dataset.renderSettled).toBe(
        'true',
      );
      expect(second.container.querySelector('.mermaid-renderer')?.dataset.renderSettled).toBe(
        'true',
      );
    } finally {
      if (getBBox) Object.defineProperty(SVGElement.prototype, 'getBBox', getBBox);
      else delete (SVGElement.prototype as SVGElement & { getBBox?: unknown }).getBBox;
    }
  });

  it('releases the global Mermaid queue after a render error', async () => {
    const getBBox = Object.getOwnPropertyDescriptor(SVGElement.prototype, 'getBBox');
    Object.defineProperty(SVGElement.prototype, 'getBBox', {
      configurable: true,
      value: () => ({ x: 0, y: 0, width: 300, height: 180 }),
    });
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    document.documentElement.classList.add('catalog-reduced-motion');
    mermaidMocks.render.mockRejectedValueOnce(new Error('invalid source')).mockResolvedValueOnce({
      svg: '<svg aria-roledescription="flowchart-v2" viewBox="0 0 300 180"></svg>',
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);

    try {
      const invalid = render(MermaidRenderer, { code: 'not a diagram' });
      const current = render(MermaidRenderer, { code: 'flowchart TB\nA --> B' });

      await waitFor(() => expect(mermaidMocks.render).toHaveBeenCalledTimes(2));
      await waitFor(() =>
        expect(invalid.container.querySelector('.mermaid-renderer')?.dataset.renderSettled).toBe(
          'true',
        ),
      );
      expect(invalid.container.querySelector('[role="alert"]')).toBeTruthy();
      await waitFor(() =>
        expect(current.container.querySelector('.mermaid-renderer')?.dataset.renderSettled).toBe(
          'true',
        ),
      );
      expect(
        current.container.querySelector('svg[aria-roledescription="flowchart-v2"]'),
      ).toBeTruthy();
    } finally {
      if (getBBox) Object.defineProperty(SVGElement.prototype, 'getBBox', getBBox);
      else delete (SVGElement.prototype as SVGElement & { getBBox?: unknown }).getBBox;
    }
  });

  it('joins automatic note wraps without removing authored line breaks or tspan text', async () => {
    const getBBox = Object.getOwnPropertyDescriptor(SVGElement.prototype, 'getBBox');
    const viewBox = Object.getOwnPropertyDescriptor(SVGSVGElement.prototype, 'viewBox');
    Object.defineProperty(SVGElement.prototype, 'getBBox', {
      configurable: true,
      value(this: SVGElement) {
        if (this.tagName.toLowerCase() === 'text') {
          const width = (this.textContent?.length ?? 0) * 6;
          return {
            x: Number(this.getAttribute('x')) - width / 2,
            y: Number(this.getAttribute('y')) - 10,
            width,
            height: 12,
          };
        }
        return { x: 0, y: 0, width: 300, height: 180 };
      },
    });
    Object.defineProperty(SVGSVGElement.prototype, 'viewBox', {
      configurable: true,
      get() {
        return { baseVal: { x: 0, y: 0, width: 300, height: 180 } };
      },
    });
    const canvas = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    mermaidMocks.render.mockResolvedValueOnce({
      svg: `<svg aria-roledescription="sequence" viewBox="0 0 300 180">
        <g id="automatic"><rect class="note"/><text class="noteText" x="100" y="50"><tspan x="100">Shared </tspan><tspan>browser</tspan></text><text class="noteText" x="100" y="65"><tspan x="100">rendering boundary</tspan></text></g>
        <g id="authored"><rect class="note"/><text class="noteText" x="200" y="100"><tspan x="200">First authored</tspan></text><text class="noteText" x="200" y="115"><tspan x="200">line</tspan></text><text class="noteText" x="200" y="130"><tspan x="200">Second authored line</tspan></text></g>
      </svg>`,
    });

    try {
      const result = render(MermaidRenderer, {
        code: 'sequenceDiagram\n  participant A\n  participant B\n  Note over A,B: Shared browser rendering boundary\n  Note over A,B: First authored line<br/>Second authored line',
      });
      await waitFor(() =>
        expect(result.container.querySelector('.mermaid-renderer')?.dataset.renderSettled).toBe(
          'true',
        ),
      );

      const automatic = result.container.querySelector('#automatic')!;
      const authored = result.container.querySelector('#authored')!;
      expect(automatic.querySelectorAll('text.noteText')).toHaveLength(1);
      expect(automatic.querySelector('text.noteText')?.textContent).toBe(
        'Shared browser rendering boundary',
      );
      expect(automatic.querySelectorAll('text.noteText tspan')).toHaveLength(1);
      expect(
        [...authored.querySelectorAll('text.noteText')].map((text) => text.textContent),
      ).toEqual(['First authored line', 'Second authored line']);
      expect(authored.querySelectorAll('text.noteText tspan')).toHaveLength(2);
    } finally {
      canvas.mockRestore();
      if (getBBox) Object.defineProperty(SVGElement.prototype, 'getBBox', getBBox);
      else delete (SVGElement.prototype as SVGElement & { getBBox?: unknown }).getBBox;
      if (viewBox) Object.defineProperty(SVGSVGElement.prototype, 'viewBox', viewBox);
      else delete (SVGSVGElement.prototype as SVGSVGElement & { viewBox?: unknown }).viewBox;
    }
  });
});
