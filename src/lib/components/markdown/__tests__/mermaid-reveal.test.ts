import { describe, expect, it } from 'vitest';
import { createMermaidRevealTracker, finishMermaidReveal } from '../mermaid-reveal';

function svg(body: string, family = 'flowchart-v2') {
  return `<svg aria-roledescription="${family}">${body}</svg>`;
}
function node(id: string, label = id, counter = 0) {
  return `<g class="node" id="flowchart-${id}-${counter}"><rect/><g class="label"><foreignObject><div>${label}</div></foreignObject></g></g>`;
}
function read(markup: string) {
  const container = document.createElement('div');
  container.innerHTML = markup;
  return container;
}
function revealing(container: ParentNode) {
  return [...container.querySelectorAll('[data-mermaid-reveal]')];
}

describe('Mermaid reveal history', () => {
  it('reveals new shapes before labels without replaying old nodes with regenerated IDs or geometry', () => {
    const tracker = createMermaidRevealTracker();
    const first = read(tracker.prepare(svg(node('A')), 'flowchart LR\nA', true));
    expect(first.querySelector('rect')?.getAttribute('data-mermaid-reveal')).toBe('shape');
    expect(first.querySelector('foreignObject')?.getAttribute('data-mermaid-reveal')).toBe('label');
    const next = read(
      tracker.prepare(svg(node('A', 'A', 99) + node('B', 'A', 100)), 'flowchart LR\nA\nB', true),
    );
    expect(revealing(next).map((element) => element.closest('.node')?.id)).toEqual([
      'flowchart-B-100',
      'flowchart-B-100',
    ]);
  });

  it('keeps old labels visible when a new member appears inside an existing node', () => {
    const tracker = createMermaidRevealTracker();
    tracker.prepare(
      svg('<g class="node" data-id="A"><rect/><text>A</text></g>', 'class'),
      'classDiagram\nclass A',
      true,
    );
    const result = read(
      tracker.prepare(
        svg('<g class="node" data-id="A"><rect/><text>A</text><text>+save()</text></g>', 'class'),
        'classDiagram\nclass A\nA : +save()',
        true,
      ),
    );
    expect(revealing(result).map((element) => element.textContent)).toEqual(['+save()']);
  });

  it('ignores the SVG-wide generated ID prefix on sanitized nodes and connections', () => {
    const tracker = createMermaidRevealTracker();
    const first =
      '<svg id="mermaid-first" aria-roledescription="flowchart-v2"><g class="node" id="mermaid-first-flowchart-A-0"><rect/><text>Draft</text></g><g class="edgePaths"><path id="mermaid-first-L_A_B_0"/></g><g class="edgeLabels"><g class="edgeLabel"><text>Go</text></g></g></svg>';
    tracker.prepare(first, 'graph LR\nA -->|Go| B', true);
    const next = first
      .replaceAll('mermaid-first', 'mermaid-next')
      .replace('flowchart-A-0', 'flowchart-A-50');
    expect(revealing(read(tracker.prepare(next, 'graph LR\nA -->|Go| B\nB', true)))).toEqual([]);
  });

  it('tracks edge and label identities separately, including parallel connections', () => {
    const tracker = createMermaidRevealTracker();
    const edge = (id: string) =>
      `<g class="edgePaths"><path data-id="${id}"/></g><g class="edgeLabels"><g class="edgeLabel"><g data-id="${id}"><text>Go</text></g></g></g>`;
    tracker.prepare(svg(edge('A_B_0')), 'graph LR\nA --> B', true);
    const result = read(
      tracker.prepare(svg(edge('A_B_0') + edge('A_B_1')), 'graph LR\nA --> B\nA --> B', true),
    );
    expect(revealing(result).map((element) => element.getAttribute('data-mermaid-reveal'))).toEqual(
      ['shape', 'label'],
    );
  });

  it('does not replay on final validation, theme or width changes', () => {
    const tracker = createMermaidRevealTracker();
    tracker.prepare(svg(node('A')), 'graph LR\nA', true);
    for (const animate of [true, false]) {
      expect(
        revealing(read(tracker.prepare(svg(node('A', 'wrapped A', 20)), 'graph LR\nA', animate))),
      ).toEqual([]);
    }
  });

  it('seeds completed and reduced-motion snapshots without entrances', () => {
    const tracker = createMermaidRevealTracker();
    expect(revealing(read(tracker.prepare(svg(node('A')), 'A', false)))).toEqual([]);
    const result = read(tracker.prepare(svg(node('A') + node('B')), 'AB', true));
    expect(revealing(result).map((element) => element.closest('.node')?.id)).toEqual([
      'flowchart-B-0',
      'flowchart-B-0',
    ]);
  });

  it('resets for source replacement even when the replacement reuses node IDs', () => {
    const tracker = createMermaidRevealTracker();
    tracker.prepare(svg(node('A')), 'graph LR\nA[Old]', true);
    expect(
      revealing(read(tracker.prepare(svg(node('A', 'New')), 'graph LR\nA[New]', true))),
    ).toHaveLength(2);
  });

  it('tracks sequence message ordinals across layout and wrapping changes', () => {
    const tracker = createMermaidRevealTracker();
    tracker.prepare(
      svg('<text class="messageText">Hello world</text><line class="messageLine0"/>', 'sequence'),
      'sequenceDiagram\nA->>B: Hello world',
      true,
    );
    const result = read(
      tracker.prepare(
        svg(
          '<text class="messageText">Hello</text><text class="messageText">world</text><line class="messageLine0"/><text class="messageText">Hello world</text><path class="messageLine1"/>',
          'sequence',
        ),
        'sequenceDiagram\nA->>B: Hello world\nB-->>A: Hello world',
        true,
      ),
    );
    expect(revealing(result).map((element) => element.localName)).toEqual(['text', 'path']);
  });

  it('leaves unknown families, unrecognized structures, and shared marker definitions visible', () => {
    const tracker = createMermaidRevealTracker();
    const body = '<defs><marker><path/></marker></defs><g><rect/><text>Unknown</text></g>';
    expect(revealing(read(tracker.prepare(svg(body), 'graph LR\nA', true)))).toEqual([]);
    expect(revealing(read(tracker.prepare(svg(node('A'), 'pie'), 'pie\nA', true)))).toEqual([]);
  });

  it('settles without changing authored styles or replaying settled content', () => {
    const tracker = createMermaidRevealTracker();
    const markup = svg('<g class="node" id="A"><rect opacity="0.5"/><text>A</text></g>');
    const result = read(tracker.prepare(markup, 'A', true));
    finishMermaidReveal(result);
    expect(revealing(result)).toEqual([]);
    expect(result.querySelector('rect')?.getAttribute('opacity')).toBe('0.5');
    expect(revealing(read(tracker.prepare(markup, 'AB', true)))).toEqual([]);
  });
});
