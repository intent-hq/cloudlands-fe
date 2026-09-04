import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import DiagramRenderer from '../DiagramRenderer.svelte';
import DiagramNodeHTML from '../DiagramNodeHTML.svelte';
import {
  DIAGRAM_WORKBENCH_CASES,
  type DiagramWorkbenchState,
} from '../diagram-workbench.preview-fixtures';
import { computeLayout } from '../layout-engine';
import { getDiagramNodeIcon } from '../diagram-node-icons';

function customDiagram(state: DiagramWorkbenchState) {
  const fixture = DIAGRAM_WORKBENCH_CASES[state];
  if (fixture.kind !== 'custom') throw new Error(`${state} is not a custom diagram fixture`);
  return fixture.diagram;
}

beforeEach(() => {
  document.documentElement.classList.add('catalog-reduced-motion');
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove('catalog-reduced-motion');
  vi.unstubAllGlobals();
});

describe('custom diagram visual contract', () => {
  it('maps supported technical node kinds to existing decorative icons', () => {
    expect(
      ['service', 'db', 'queue', 'actor', 'interface', 'file', 'state', 'process'].map(
        (kind) => getDiagramNodeIcon(kind).name,
      ),
    ).toEqual(['server', 'database', 'message', 'user', 'plug', 'file-lines', 'circle', 'gear']);
    expect(getDiagramNodeIcon('unrecognized').name).toBe('cube');

    for (const state of [
      'custom-architecture',
      'custom-sequence',
      'custom-state-machine',
      'custom-data-flow',
      'custom-flowchart',
      'custom-network',
      'custom-timeline',
      'custom-dependency-graph',
    ] satisfies DiagramWorkbenchState[]) {
      expect(
        customDiagram(state).model.nodes.every((node) => getDiagramNodeIcon(node.kind).name),
      ).toBe(true);
    }
  });

  it('renders compact left-aligned icon chips without changing accessible labels', async () => {
    const { container, getByRole } = render(DiagramRenderer, {
      props: { diagram: customDiagram('custom-architecture') },
    });

    await waitFor(() => expect(container.querySelectorAll('[data-node-icon]')).toHaveLength(2));
    expect(
      [...container.querySelectorAll('[data-node-icon]')].every(
        (icon) => icon.getAttribute('aria-hidden') === 'true',
      ),
    ).toBe(true);
    expect(
      [...container.querySelectorAll('[data-node-icon] [data-icon]')].map(
        (icon) => icon.dataset.icon,
      ),
    ).toEqual(['user', 'desktop']);
    expect(getByRole('button', { name: /Diagram workbench\s+renderer/ })).toBeTruthy();
  });

  it('includes the icon column while keeping default nodes low-profile and long labels bounded', () => {
    const diagram = customDiagram('custom-network');
    const layout = computeLayout(diagram.model, diagram.baseView, diagram.grammar);
    const multiline = computeLayout(
      {
        nodes: [
          { id: 'single', label: 'First line', kind: 'service' },
          { id: 'multiline', label: 'First line\nSecond line', kind: 'service' },
          {
            id: 'long',
            label: 'A very long technical label that must wrap without clipping',
            kind: 'file',
          },
        ],
        edges: [],
      },
      { layout: { type: 'manual' } },
      'architecture',
    );

    expect(Math.max(...layout.nodes.map((node) => node.height))).toBeLessThan(50);
    expect(multiline.nodes[1].height).toBeGreaterThan(multiline.nodes[0].height);
    expect(multiline.nodes[2].width).toBeLessThanOrEqual(250);
  });

  it('renders every state-machine label with matching semantic markers', async () => {
    const { container } = render(DiagramRenderer, {
      props: { diagram: customDiagram('custom-state-machine') },
    });

    await waitFor(() => expect(container.querySelectorAll('.edge-label-html')).toHaveLength(4));
    expect(
      [...container.querySelectorAll('.edge-label-html')].map((node) => node.textContent),
    ).toEqual(['select state', 'render succeeds', 'parse fails', 'choose another case']);
    expect(
      [...container.querySelectorAll('marker path')].every(
        (marker) =>
          marker.getAttribute('stroke-width') === '1' &&
          marker.getAttribute('stroke') === 'context-stroke',
      ),
    ).toBe(true);
    expect(container.querySelectorAll('.edge-label-leader')).toHaveLength(0);
  });

  it('allocates multiline space for long edge labels', async () => {
    const { container } = render(DiagramRenderer, {
      props: { diagram: customDiagram('custom-long-multiline-labels') },
    });

    await waitFor(() => expect(container.querySelectorAll('.edge-label-html')).toHaveLength(2));
    expect(
      [...container.querySelectorAll('.edge-label-container')].every((node) =>
        node.hasAttribute('data-edge-id'),
      ),
    ).toBe(true);
    expect(container.querySelectorAll('.edge-label-leader')).toHaveLength(0);
    const label = [...container.querySelectorAll('.edge-label-container')].find((node) =>
      node.textContent?.includes('asks for'),
    );
    expect(Number(label?.getAttribute('height'))).toBeGreaterThan(36);

    const svg = container.querySelector('.diagram-svg-layer');
    const transform = label?.parentElement?.getAttribute('transform') ?? '';
    const [, translateX = '0', translateY = '0'] = /translate\(([-\d.]+),\s*([-\d.]+)\)/.exec(
      transform,
    ) ?? ['', '0', '0'];
    expect(Number(label?.getAttribute('x')) + Number(translateX)).toBeGreaterThanOrEqual(0);
    expect(
      Number(label?.getAttribute('x')) + Number(translateX) + Number(label?.getAttribute('width')),
    ).toBeLessThanOrEqual(Number(svg?.getAttribute('width')));
    expect(Number(label?.getAttribute('y')) + Number(translateY)).toBeGreaterThanOrEqual(0);
  });

  it('anchors grouped labels to their route without crossing group headings', async () => {
    const diagram = customDiagram('custom-architecture');
    diagram.states = undefined;
    diagram.currentStateId = undefined;
    const layout = computeLayout(diagram.model, diagram.baseView, diagram.grammar);
    const { container } = render(DiagramRenderer, { props: { diagram } });

    await waitFor(() =>
      expect(container.querySelectorAll('.edge-label-container')).toHaveLength(5),
    );
    for (const label of container.querySelectorAll<SVGForeignObjectElement>(
      '.edge-label-container',
    )) {
      const edge = layout.edges.find((candidate) => candidate.id === label.dataset.edgeId)!;
      const x = Number(label.getAttribute('x'));
      const y = Number(label.getAttribute('y'));
      const width = Number(label.getAttribute('width'));
      const height = Number(label.getAttribute('height'));
      const centerX = x + width / 2;
      const centerY = y + height / 2;
      const distanceToRoute = edge.points!.slice(0, -1).reduce((minimum, point, index) => {
        const next = edge.points![index + 1];
        for (let step = 0; step <= 100; step += 1) {
          const routeX = point.x + ((next.x - point.x) * step) / 100;
          const routeY = point.y + ((next.y - point.y) * step) / 100;
          minimum = Math.min(minimum, Math.hypot(centerX - routeX, centerY - routeY));
        }
        return minimum;
      }, Number.POSITIVE_INFINITY);
      const crossesHeading = layout.groups!.some(
        (group) =>
          x < group.x + group.width &&
          x + width > group.x &&
          y < group.y + 34 &&
          y + height > group.y,
      );

      expect(distanceToRoute, edge.id).toBeLessThanOrEqual(1);
      expect(crossesHeading).toBe(false);
    }
  });

  it('uses direct force-layout network routes without duplicate segments', () => {
    const diagram = customDiagram('custom-network');
    const layout = computeLayout(diagram.model, diagram.baseView, diagram.grammar);

    for (const edge of layout.edges) {
      expect(edge.points!.length).toBeLessThanOrEqual(4);
      for (let index = 1; index < edge.points!.length; index += 1) {
        expect(edge.points![index]).not.toEqual(edge.points![index - 1]);
        if (index < edge.points!.length - 1) {
          const [previous, current, next] = edge.points!.slice(index - 1, index + 2);
          expect(
            (previous.x === current.x && current.x === next.x) ||
              (previous.y === current.y && current.y === next.y),
          ).toBe(false);
        }
      }
    }
  });

  it('preserves walkthrough updates and node bindings', async () => {
    const onUpdate = vi.fn();
    const onBindingClick = vi.fn();
    const diagram = customDiagram('custom-walkthrough');
    const { container } = render(DiagramRenderer, {
      props: { diagram, onUpdate, onBindingClick },
    });

    await waitFor(() => expect(container.querySelectorAll('.stepper-dot')).toHaveLength(3));
    await fireEvent.click(container.querySelectorAll('.stepper-dot')[1]);
    expect(onUpdate).toHaveBeenLastCalledWith({ currentStateId: 'execute' });

    const bindingDiagram = customDiagram('custom-bindings');
    const bindingRender = render(DiagramRenderer, {
      props: { diagram: bindingDiagram, onBindingClick },
    });
    await waitFor(() =>
      expect(bindingRender.container.querySelector('.node-clickable')).toBeTruthy(),
    );
    await fireEvent.click(bindingRender.container.querySelector('.node-clickable')!);
    expect(onBindingClick).toHaveBeenCalledWith(expect.any(MouseEvent), {
      type: 'note',
      target: 'bf4d5bc8-15d8-4fbb-bb82-b6fea9f2d4b2',
    });
  });

  it('keeps walkthrough highlights contained across semantic and interactive node states', async () => {
    const semanticNode = render(DiagramNodeHTML, {
      props: {
        node: {
          id: 'notes',
          label: 'Persistent notes',
          kind: 'db',
          semanticStyle: 'success',
          binding: { type: 'note', target: 'spec' },
          x: 0,
          y: 0,
          width: 140,
          height: 40,
        },
        highlighted: true,
      },
    });

    const semanticButton = semanticNode.getByRole('button', { name: /Persistent notes/ });
    expect(semanticButton.dataset.semanticStyle).toBe('success');
    expect(semanticButton.dataset.stateHighlighted).toBe('true');

    const walkthrough = render(DiagramRenderer, {
      props: { diagram: customDiagram('custom-walkthrough') },
    });
    await fireEvent.click(
      walkthrough.container.querySelector('button[aria-label="State 2: 2. Follow execution"]')!,
    );
    await waitFor(() => {
      const daemon = walkthrough.container.querySelector(
        '[data-node-id="daemon"] [data-state-highlighted]',
      ) as HTMLElement | null;
      expect(daemon?.dataset.stateHighlighted).toBe('true');
      expect(daemon?.dataset.semanticStyle).not.toBe('active');
      expect(daemon?.dataset.dimmed).toBe('false');
    });
  });

  it('keeps the complete custom sandbox matrix registered', () => {
    expect(
      Object.keys(DIAGRAM_WORKBENCH_CASES).filter((state) => state.startsWith('custom-')),
    ).toHaveLength(14);
  });
});
