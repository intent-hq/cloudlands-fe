/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import type { NodeViewProps } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';
import NoteVideoNodeView from '../NoteVideoNodeView.svelte';

afterEach(cleanup);

function makeProps(): NodeViewProps {
  return {
    node: { attrs: { src: 'workspace-file://workspace-1/out/demo.mp4', name: 'demo' } },
    selected: false,
    editor: { view: { dom: document.createElement('div') } },
    extension: { options: { workspaceId: 'workspace-1' } },
  } as unknown as NodeViewProps;
}

describe('NoteVideoNodeView', () => {
  it('replaces a missing workspace video with path actions', async () => {
    render(NoteVideoNodeView, { props: makeProps() });

    await fireEvent.error(screen.getByLabelText('demo'));

    expect(screen.getByTestId('media-unavailable').dataset.reason).toBe('missing');
    expect(screen.getByRole('button', { name: /copy path/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /open file/i })).toBeTruthy();
  });

  it('opens the video lightbox from its explicit action', async () => {
    render(NoteVideoNodeView, { props: makeProps() });

    await fireEvent.click(screen.getByRole('button', { name: /play demo/i }));

    expect(screen.getByRole('dialog', { name: /video preview/i })).toBeTruthy();
  });
});
