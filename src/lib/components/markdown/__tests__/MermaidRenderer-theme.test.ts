import { readFileSync } from 'node:fs';
import path from 'node:path';
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
    render(MermaidRenderer, { code: 'sequenceDiagram\nA->>B: Ready' });
    await waitFor(() => expect(mermaidMocks.initialize).toHaveBeenCalledOnce());

    document.documentElement.style.setProperty('--card', '260 20% 18%');

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
    const source = readFileSync(
      path.resolve(process.cwd(), 'src/lib/components/markdown/MermaidRenderer.svelte'),
      'utf8',
    );
    const svgTypography = source.match(/\.mermaid-presentation :global\(svg\) \{([^}]*)\}/)?.[1];
    const labelTypography = source.match(
      /\.mermaid-presentation :global\(text\),[\s\S]*?\n  \}/,
    )?.[0];
    const nodeTypography = source.match(
      /\.mermaid-presentation :global\(\.node \.nodeLabel\),[\s\S]*?\n  \}/,
    )?.[0];

    expect(svgTypography).toContain('font-family: var(--mermaid-font-family)');
    expect(svgTypography).toContain(
      'font-size: var(--mermaid-root-font-size, var(--text-caption-size))',
    );
    expect(labelTypography).toContain('font-size: var(--text-caption-size)');
    expect(nodeTypography).toContain('font-family: var(--mermaid-font-family)');
    expect(nodeTypography).toContain('font-size: var(--text-caption-size)');
    expect(nodeTypography).not.toContain('var(--font-editorial)');
    expect(source).toContain('await document.fonts?.load');
    expect(source).toContain('style="--mermaid-font-family: var(--font-ui)"');
    expect(svgTypography).not.toContain('var(--font-code');
    expect(labelTypography).not.toContain('var(--font-code');
  });

  it('repairs flow labels, sequence actors, group inset, and connector weight', () => {
    const source = readFileSync(
      path.resolve(process.cwd(), 'src/lib/components/markdown/MermaidRenderer.svelte'),
      'utf8',
    );
    const geometrySource = readFileSync(
      path.resolve(process.cwd(), 'src/lib/components/markdown/mermaid-path-geometry.ts'),
      'utf8',
    );

    expect(source).toContain('centerFlowchartLabels(svg)');
    expect(source).toContain('replaceSequenceActorFigures(svg)');
    expect(source).toContain('repairFlowchartNodeOutlines(svg)');
    expect(source).toContain('routeFlowchartFeedbackLane(svg)');
    expect(source).toContain('if (shouldRewriteStateRoutes) rewriteStateRoutes(svg, narrowLayout)');
    expect(source).toContain('roundOrthogonalBends(svg)');
    expect(source).toContain('attachStateTerminalArrowheads(svg)');
    expect(source).toContain('placeStateLabelsOnFinalRoutes(svg, narrowLayout)');
    expect(source).toContain('positionCompactGroupedEdgeLabels(svg)');
    expect(source).toContain('snapFlowchartPorts(svg)');
    expect(source).toContain('balanceMermaidEdgeLabelGlyphs(svg)');
    expect(source).toContain('padMermaidEdgeLabels(svg)');
    expect(geometrySource).toContain(
      'path.dataset.cornerRadius = String(ORTHOGONAL_CORNER_RADIUS)',
    );
    expect(source).toContain('getPhosphorIconComponent(faUser)');
    expect(source).toContain("label.setAttribute('y', String(37 + labelHeight / 2))");
    expect(source).toContain('reserveFlowchartClusterHeaderBands(svg)');
    expect(geometrySource).toMatch(/cluster\.dataset\.headerHeight\s*=\s*String\(headerHeight\)/);
    expect(source).toMatch(/\.edge-thickness-thick[\s\S]*?stroke-width: 1px !important;/);
    expect(source).not.toContain('loading-spinner');
  });

  it('rebuilds measured class rows and removes Mermaid placeholder compartments', () => {
    const source = readFileSync(
      path.resolve(process.cwd(), 'src/lib/components/markdown/MermaidRenderer.svelte'),
      'utf8',
    );

    expect(source).toContain('arrangeClassTextGroup');
    expect(source).toContain("querySelectorAll(':scope > .divider')");
    expect(source).toContain("divider.classList.add('class-box-divider')");
    expect(source).not.toContain('content.y + content.height');
  });

  it('uses one size-neutral surface for nested flowchart edge labels', () => {
    const source = readFileSync(
      path.resolve(process.cwd(), 'src/lib/components/markdown/MermaidRenderer.svelte'),
      'utf8',
    );
    const surface = source.match(/:global\(span\.edgeLabel\) \{([^}]*)\}/)?.[1];
    const content = source.match(/:global\(span\.edgeLabel > p\) \{([^}]*)\}/)?.[1];
    const labelBackground = source.match(/:global\(\.labelBkg\) \{([^}]*)\}/)?.[1];
    const inlineSvg = source.match(/\.mermaid-svg :global\(svg\) \{([^}]*)\}/)?.[1];

    expect(surface).toContain('display: inline-block');
    expect(surface).toContain('border: 0');
    expect(labelBackground).toContain('background: var(--diagram-canvas) !important');
    expect(source).toMatch(/foreignObject\.dataset\.labelPaddingX\s*=\s*['"]6['"]/);
    expect(source).toMatch(/foreignObject\.dataset\.labelPaddingY\s*=\s*['"]4['"]/);
    expect(content).toContain('background: transparent');
    expect(inlineSvg).toContain('width: auto');
    expect(inlineSvg).not.toMatch(/(?:^|\n)\s*width: 100%/);
    expect(content).not.toMatch(/\b(?:border|padding):/);
    expect(source).not.toMatch(/:global\(\.edgeLabel (?:p|span)\)/);
    expect(source).toMatch(/:global\(svg\)[\s\S]*?background: transparent !important;/);
  });
});
