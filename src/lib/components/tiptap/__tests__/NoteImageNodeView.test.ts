/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { NodeViewProps } from '@tiptap/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import NoteImageNodeView from '../NoteImageNodeView.svelte';

afterEach(cleanup);

function makeProps(
  editable: boolean,
  attrs: Record<string, unknown> = {
    src: 'workspace-asset://asset-123',
    alt: 'Note image',
    title: null,
  },
): NodeViewProps {
  const editorElement = document.createElement('div');
  editorElement.tabIndex = 0;
  document.body.appendChild(editorElement);
  return {
    node: {
      attrs,
    },
    selected: false,
    editor: { isEditable: editable, view: { dom: editorElement } },
    extension: { options: { workspaceId: 'workspace-1' } },
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

  it('replaces a missing workspace file with path actions', async () => {
    render(NoteImageNodeView, {
      props: makeProps(false, {
        src: 'workspace-file://workspace-1/docs/missing.png',
        alt: 'Missing image',
        title: null,
      }),
    });

    await fireEvent.error(screen.getByRole('img', { name: 'Missing image' }));

    expect(screen.getByTestId('media-unavailable').dataset.reason).toBe('missing');
    expect(screen.getByRole('button', { name: /copy path/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /open file/i })).toBeTruthy();
  });

  it('renders unsupported note images as a placeholder without loading them', () => {
    render(NoteImageNodeView, {
      props: makeProps(false, {
        src: 'intent://local/file/art/logo.svg',
        alt: 'Vector logo',
        title: null,
        mediaUnsupported: 'svg',
      }),
    });

    expect(screen.queryByRole('img', { name: 'Vector logo' })).toBeNull();
    expect(screen.getByTestId('media-unavailable').dataset.reason).toBe('unsupported');
    expect(screen.getByRole('button', { name: /copy path/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /open file/i })).toBeTruthy();
  });
});
