/** @vitest-environment jsdom */
import { cleanup, render, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DiagramEmbeddingPreview, { preview } from './diagram-embedding.preview.svelte';

vi.mock('$lib/components/markdown/MarkdownViewer.svelte', async () => ({
  default: (await import('../chat/__tests__/mocks/MarkdownViewerStub.svelte')).default,
}));

vi.mock('$lib/components/diagrams/DiagramRenderer.svelte', async () => ({
  default: (await import('../workspace/initializer/__tests__/mocks/MockComponent.svelte')).default,
}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: () => ({}), dispatch: vi.fn() });
});

afterEach(cleanup);

describe('diagram embedding preview', () => {
  it('registers stable note and chat states with one deterministic fixture', () => {
    expect(preview.id).toBe('diagram-embedding');
    expect(preview.defaultState).toBe('note');
    expect(Object.keys(preview.states)).toEqual(['note', 'chat']);
    expect(preview.states.note.props.diagram).toBe(preview.states.chat.props.diagram);
    expect(preview.states.note.props.diagram.createdAt).toBe('2026-08-23T12:00:00.000Z');
  });

  it.each(['note', 'chat'] as const)(
    'renders the %s production embedding and actions',
    async (state) => {
      const result = render(DiagramEmbeddingPreview, { props: preview.states[state].props });

      expect(result.container.querySelector(`[data-embedding-context="${state}"]`)).toBeTruthy();
      expect(result.container.querySelector('[data-diagram-presentation]')).toBeTruthy();
      await waitFor(() => expect(result.getByRole('menu')).toBeTruthy());
      expect(result.getByRole('menuitem', { name: 'Copy image' })).toBeTruthy();
      expect(result.getByRole('menuitem', { name: 'Download SVG' })).toBeTruthy();
    },
  );
});
