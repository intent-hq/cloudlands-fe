/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, within } from '@testing-library/svelte';
import type { Editor, NodeViewProps } from '@tiptap/core';
import type { ContentBlock } from '$shared/types';
import type { DiagramPrimitive } from '$shared/types/notes-primitives';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import MessageContent from '../../chat/MessageContent.svelte';
import StreamingMessageContent from '../../chat/StreamingMessageContent.svelte';
import DiagramBlock from '../../notes/primitives/DiagramBlock.svelte';
import MermaidBlockNodeView from '../../tiptap/MermaidBlockNodeView.svelte';

vi.mock('$lib/components/markdown/MarkdownViewer.svelte', async () => ({
  default: (await import('../../chat/__tests__/mocks/MarkdownViewerStub.svelte')).default,
}));

vi.mock('$lib/components/markdown/MermaidRenderer.svelte', async () => ({
  default: (await import('../../workspace/initializer/__tests__/mocks/MockComponent.svelte'))
    .default,
}));

vi.mock('$lib/components/diagrams/DiagramRenderer.svelte', async () => ({
  default: (await import('../../workspace/initializer/__tests__/mocks/MockComponent.svelte'))
    .default,
}));

vi.mock('svelte-tiptap', async () => ({
  NodeViewWrapper: (
    await import('../../workspace/initializer/__tests__/mocks/MockComponent.svelte')
  ).default,
}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: () => ({}), dispatch: vi.fn() });
});

vi.mock('$store/renderer/slices/theme/theme-selectors', async () => {
  const { createAppStoreMock } = await import('$store/renderer/utils/test-helpers/store-mock');
  const store = createAppStoreMock({ state: {} });
  return { selectIsDarkTheme: store.createSelector(() => false) };
});

const diagram: DiagramPrimitive = {
  id: '10000000-0000-4000-8000-000000000001',
  type: 'diagram',
  version: 1,
  createdAt: '2026-08-26T00:00:00.000Z',
  createdBy: 'agent',
  grammar: 'flowchart',
  model: {
    nodes: [
      { id: 'a', label: 'Start', kind: 'step' },
      { id: 'b', label: 'Finish', kind: 'step' },
    ],
    edges: [{ id: 'edge', from: 'a', to: 'b' }],
  },
  baseView: { layout: { type: 'layered', direction: 'LR' } },
};

const mermaidBlock = {
  type: 'text',
  text: '~~~mermaid\nflowchart LR\n  A --> B\n~~~',
} as ContentBlock;

const customBlock = {
  type: 'text',
  text: `~~~diagram\n${JSON.stringify(diagram)}\n~~~`,
} as ContentBlock;

function noteProps(data: DiagramPrimitive, isEditable = true, selected = false): NodeViewProps {
  return {
    node: { attrs: { data, code: 'flowchart LR; A --> B' } },
    selected,
    updateAttributes: vi.fn(),
    editor: { isEditable } as Editor,
  } as unknown as NodeViewProps;
}

afterEach(cleanup);

describe('diagram presentation integration', () => {
  it('keeps the shared surface borderless with latent UI-font actions', () => {
    const source = readFileSync('src/lib/components/diagrams/DiagramPresentation.svelte', 'utf8');
    const surface = source.match(/\.diagram-presentation \{([\s\S]*?)\n  \}/)?.[1];
    const actions = source.match(/\.diagram-presentation-actions \{([\s\S]*?)\n  \}/)?.[1];

    expect(surface).toContain('border: 0');
    expect(surface).toContain('background: transparent');
    expect(actions).toContain('opacity: 0');
    expect(actions).toContain('pointer-events: none');
    expect(source).toContain('font-family: var(--font-ui)');
    expect(source).not.toContain('var(--font-code)');
  });

  it.each([
    ['mermaid', mermaidBlock],
    ['custom', customBlock],
  ] as const)('uses the same %s surface in completed and streaming chat', (kind, block) => {
    const completed = render(MessageContent, { props: { content: [block] } });
    const completedSurface = completed.container.querySelector('[data-diagram-presentation]');
    expect(completedSurface?.getAttribute('data-diagram-kind')).toBe(kind);
    cleanup();

    const streaming = render(StreamingMessageContent, {
      props: { content: [block], isStreaming: true },
    });
    const streamingSurface = streaming.container.querySelector('[data-diagram-presentation]');
    expect(streamingSurface?.getAttribute('data-diagram-kind')).toBe(kind);
    expect(streamingSurface?.getAttribute('class')).toBe(completedSurface?.getAttribute('class'));
  });

  it('keeps the streaming surface node stable while content updates', async () => {
    const result = render(StreamingMessageContent, {
      props: { content: [mermaidBlock], isStreaming: true },
    });
    const initialSurface = result.container.querySelector('[data-diagram-presentation]');

    await result.rerender({
      content: [{ ...mermaidBlock, text: '~~~mermaid\nflowchart LR\n  A --> B --> C\n~~~' }],
      isStreaming: true,
    });

    expect(result.container.querySelector('[data-diagram-presentation]')).toBe(initialSurface);
  });

  it('uses the shared surface for editable and read-only Mermaid notes', async () => {
    const editable = render(MermaidBlockNodeView, { props: noteProps(diagram, true) });
    const editableView = within(editable.container);

    expect(editable.container.querySelector('[data-diagram-kind="mermaid"]')).toBeTruthy();
    const editableSurface = editable.container.querySelector('[data-diagram-presentation]');
    expect(editableView.getByRole('button', { name: 'Fullscreen' })).toBeTruthy();
    await fireEvent.click(editableView.getByRole('button', { name: 'Edit code' }));
    expect(editableView.getByRole('textbox')).toBeTruthy();
    expect(editable.container.querySelector('[data-diagram-presentation]')).toBe(editableSurface);

    const readOnly = render(MermaidBlockNodeView, { props: noteProps(diagram, false) });
    const readOnlyView = within(readOnly.container);
    expect(readOnly.container.querySelector('[data-diagram-kind="mermaid"]')).toBeTruthy();
    expect(readOnlyView.queryByRole('button', { name: 'Edit code' })).toBeNull();
    expect(readOnlyView.getByRole('button', { name: 'Fullscreen' })).toBeTruthy();
  });

  it('keeps note actions in a separate row before diagram content', () => {
    const result = render(MermaidBlockNodeView, { props: noteProps(diagram) });
    const actions = result.container.querySelector('[data-diagram-presentation-actions]');
    const content = result.container.querySelector('[data-diagram-presentation-content]');

    expect(actions?.querySelectorAll('button')).toHaveLength(2);
    expect(actions?.nextElementSibling).toBe(content);
    expect(content?.contains(actions)).toBe(false);
  });

  it('uses the shared surface and header for custom note diagrams', () => {
    const result = render(DiagramBlock, { props: noteProps(diagram, true, true) });
    const surface = result.container.querySelector('[data-diagram-presentation]');

    expect(surface?.getAttribute('data-diagram-kind')).toBe('custom');
    expect(surface?.classList.contains('selected')).toBe(true);
    expect(result.container.querySelector('[data-diagram-presentation-header]')).toBeTruthy();
    expect(result.container.querySelector('[data-diagram-presentation-content]')).toBeTruthy();
  });
});
