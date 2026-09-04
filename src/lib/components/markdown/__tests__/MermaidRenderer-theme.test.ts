import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/svelte';

const mermaidMocks = vi.hoisted(() => ({
  initialize: vi.fn(),
  registerLayoutLoaders: vi.fn(),
  render: vi.fn(async () => ({ svg: '<svg aria-roledescription="sequence"></svg>' })),
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

describe('MermaidRenderer theme updates', () => {
  beforeEach(() => {
    mermaidMocks.initialize.mockClear();
    mermaidMocks.render.mockClear();
    for (const [name, value] of Object.entries(tokens)) {
      document.documentElement.style.setProperty(name, value);
    }
  });

  afterEach(() => {
    cleanup();
    for (const name of Object.keys(tokens)) {
      document.documentElement.style.removeProperty(name);
    }
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

  it('keeps class diagrams on SVG labels for geometry repair', async () => {
    render(MermaidRenderer, { code: 'classDiagram\n  class PreviewDefinition' });
    await waitFor(() => expect(mermaidMocks.initialize).toHaveBeenCalledOnce());
    expect(mermaidMocks.initialize.mock.calls[0]?.[0].htmlLabels).toBe(false);
  });

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
});
