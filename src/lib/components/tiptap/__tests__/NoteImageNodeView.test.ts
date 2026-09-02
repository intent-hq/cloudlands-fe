/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { NodeViewProps } from '@tiptap/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import NoteImageNodeView from '../NoteImageNodeView.svelte';

afterEach(cleanup);

function makeProps(editable: boolean): NodeViewProps {
  const editorElement = document.createElement('div');
  editorElement.tabIndex = 0;
  document.body.appendChild(editorElement);
  return {
    node: {
      attrs: { src: 'workspace-asset://asset-123', alt: 'Note image', title: null },
    },
    selected: false,
    editor: { isEditable: editable, view: { dom: editorElement } },
    updateAttributes: vi.fn(),
  } as unknown as NodeViewProps;
}

describe('NoteImageNodeView', () => {
  it('opens a workspace-asset image from a read-only note click', async () => {
    render(NoteImageNodeView, { props: makeProps(false) });

    await fireEvent.click(screen.getByRole('img', { name: 'Note image' }));

    expect(screen.getByRole('dialog', { name: /image preview/i })).toBeTruthy();
  });

  it('keeps editable clicks for selection and opens on double-click', async () => {
    render(NoteImageNodeView, { props: makeProps(true) });
    const image = screen.getByRole('img', { name: 'Note image' });

    await fireEvent.click(image);
    expect(screen.queryByRole('dialog')).toBeNull();
    await fireEvent.dblClick(image);

    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
  });
});
