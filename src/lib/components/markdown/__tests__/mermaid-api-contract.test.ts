import { describe, expect, it } from 'vitest';
import mermaid from 'mermaid';
import { createMermaidConfig } from '../mermaid-theme';

// Real Mermaid (no mock): these guard the parts of Mermaid's public API that
// MermaidRenderer depends on, so a major upgrade that renames or removes them
// fails here instead of silently degrading rendered diagrams.

const tokens: Record<string, string> = {
  '--background': '0 0% 100%',
  '--foreground': '0 0% 8%',
  '--card': '0 0% 98%',
  '--card-foreground': '0 0% 8%',
  '--muted': '210 12% 92%',
  '--muted-foreground': '210 8% 35%',
  '--border': '210 10% 82%',
  '--accent': '145 30% 90%',
  '--accent-foreground': '145 50% 20%',
  '--text-caption-size': '0.8125rem',
  '--radius-small': '5px',
};

const tokenStyle = {
  fontSize: '16px',
  getPropertyValue: (name: string) => tokens[name] ?? '',
} as unknown as CSSStyleDeclaration;

const flowchart = 'flowchart TD\n  A["Start"] --> B{"Decision"}\n  B -->|yes| C["Done"]';
const sequence = 'sequenceDiagram\n  Alice->>Bob: Hello\n  Bob-->>Alice: Hi';
const state = 'stateDiagram-v2\n  [*] --> Idle\n  Idle --> Busy\n  Busy --> [*]';

describe('Mermaid public API used by MermaidRenderer', () => {
  it('pins the appearance and layout so Mermaid default changes do not restyle diagrams', () => {
    // Mermaid 12 switched the defaults to the `neo` look and the ELK layout (with a
    // new ELK preset and line hops). MermaidRenderer picks `layout` per diagram, so
    // the shared config must pin everything else to the pre-12 rendering.
    const config = createMermaidConfig(tokenStyle);
    expect(config).toMatchObject({
      theme: 'base',
      look: 'classic',
      elk: {
        preset: 'legacy',
        lineHops: false,
        straightenEdges: false,
        orientFeedbackEdges: false,
      },
      flowchart: { minNodeWidth: 0 },
      state: { minNodeWidth: 0, wrappingWidth: 200 },
    });
  });

  it('exposes the initialize, render, parse and diagram lookup entry points', () => {
    expect(typeof mermaid.initialize).toBe('function');
    expect(typeof mermaid.render).toBe('function');
    expect(typeof mermaid.parse).toBe('function');
    expect(typeof mermaid.mermaidAPI.getDiagramFromText).toBe('function');
  });

  it('reports the diagram types and databases the renderer post-processes', async () => {
    mermaid.initialize({ ...createMermaidConfig(tokenStyle), startOnLoad: false });

    const flow = await mermaid.mermaidAPI.getDiagramFromText(flowchart);
    expect(flow.type).toBe('flowchart-v2');
    expect(typeof (flow.db as unknown as { getSubGraphs: unknown }).getSubGraphs).toBe('function');

    const states = await mermaid.mermaidAPI.getDiagramFromText(state);
    expect(states.type).toBe('stateDiagram');
    expect(typeof (states.db as unknown as { getData: unknown }).getData).toBe('function');

    const seq = await mermaid.mermaidAPI.getDiagramFromText(sequence);
    expect(seq.type).toBe('sequence');
  });

  it('accepts valid flowchart and sequence sources and rejects invalid ones', async () => {
    mermaid.initialize({ ...createMermaidConfig(tokenStyle), startOnLoad: false });
    await expect(mermaid.parse(flowchart)).resolves.toMatchObject({ diagramType: 'flowchart-v2' });
    await expect(mermaid.parse(sequence)).resolves.toMatchObject({ diagramType: 'sequence' });
    await expect(mermaid.parse('not a diagram')).rejects.toThrow();
    await expect(mermaid.parse('flowchart TD\n  A -->')).rejects.toThrow();
    await expect(mermaid.parse('not a diagram', { suppressErrors: true })).resolves.toBe(false);
  });
});
