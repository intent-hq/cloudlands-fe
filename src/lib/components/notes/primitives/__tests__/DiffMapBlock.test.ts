/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DiffMapBlock from '../DiffMapBlock.svelte';

const { dispatch } = vi.hoisted(() => ({ dispatch: vi.fn() }));

vi.mock('svelte-tiptap', async () => ({
  NodeViewWrapper: (await import('./NodeViewWrapperMock.svelte')).default,
}));

vi.mock('$features/diff-map/components/DiffMapRichBlock.svelte', async () => ({
  default: (await import('./DiffMapRichBlockMock.svelte')).default,
}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: () => ({}), dispatch });
});

afterEach(cleanup);

beforeEach(() => {
  dispatch.mockClear();
});

describe('DiffMapBlock', () => {
  it.each([
    [false, false],
    [true, true],
  ])('opens a map file with ctrl=%s and adjacent=%s', async (ctrlKey, adjacent) => {
    const { container } = render(DiffMapBlock, {
      props: {
        node: {
          attrs: {
            data: {
              document: {
                files: [{ path: 'src/app.ts', additions: 3, deletions: 1, status: 'modified' }],
              },
            },
          },
        },
        extension: { options: { workspaceId: 'workspace-1' } },
      } as any,
    });
    container.firstElementChild?.setAttribute('data-panel-id', 'panel-1');

    await fireEvent.click(screen.getByRole('button', { name: 'src/app.ts' }), { ctrlKey });

    expect(dispatch).toHaveBeenCalledWith({
      type: 'workspaceNavigation/openWorkspaceFile',
      payload: [
        'workspace-1',
        'src/app.ts',
        { openInAdjacentPanel: adjacent, sourcePanelId: 'panel-1' },
      ],
    });
  });
});
