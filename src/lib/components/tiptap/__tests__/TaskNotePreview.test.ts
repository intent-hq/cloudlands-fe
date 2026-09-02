import { cleanup, render, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readable } from 'svelte/store';

const mockProcessMarkdownToHTML = vi.hoisted(() => vi.fn(async () => '<p>preview</p>'));

vi.mock('$lib/utils/markdown-processor', () => ({
  processMarkdownToHTML: mockProcessMarkdownToHTML,
}));

vi.mock('$store/renderer/slices/workspace-notes/workspace-notes-selectors', () => ({
  selectNoteById: () => readable({ content: '![d](intent://local/file/docs/d.png)' }),
}));

import TaskNotePreview from '../TaskNotePreview.svelte';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('TaskNotePreview', () => {
  it('passes its workspace to markdown conversion', async () => {
    render(TaskNotePreview, {
      props: { workspaceId: 'workspace-1', noteId: 'note-1' as any },
    });

    await waitFor(() =>
      expect(mockProcessMarkdownToHTML).toHaveBeenCalledWith(
        '![d](intent://local/file/docs/d.png)',
        {
          allowEmpty: true,
          processPrimitives: false,
          workspaceId: 'workspace-1',
        },
      ),
    );
  });
});
