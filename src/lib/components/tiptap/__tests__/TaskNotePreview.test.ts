/**
 * @vitest-environment jsdom
 */
import { cleanup, render, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readable } from 'svelte/store';
import type { NoteId } from '$shared/types';

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
      props: { workspaceId: 'workspace-1', noteId: 'note-1' as NoteId },
    });

    await waitFor(() =>
      expect(mockProcessMarkdownToHTML).toHaveBeenCalledWith(
        '![d](intent://local/file/docs/d.png)',
        {
          allowEmpty: true,
          processPrimitives: false,
          workspaceId: 'workspace-1',
          workspaceFileVersion: expect.any(String),
        },
      ),
    );
  });

  it('renders as a content-only semantic tooltip without creating a nested trigger', () => {
    const { getByRole } = render(TaskNotePreview, {
      props: { workspaceId: 'workspace-1', noteId: 'note-1' as NoteId },
    });

    const tooltip = getByRole('tooltip');
    expect(tooltip.hidden).toBe(false);
    expect(tooltip.querySelector('[data-tooltip-trigger], button, input')).toBeNull();
  });
});
