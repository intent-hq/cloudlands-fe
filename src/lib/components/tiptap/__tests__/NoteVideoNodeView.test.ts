/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { NodeViewProps } from '@tiptap/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import NoteVideoNodeView from '../NoteVideoNodeView.svelte';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function makeProps(): NodeViewProps {
  return {
    node: { attrs: { src: 'workspace-file://workspace-1/out/demo.mp4', name: 'demo' } },
    selected: false,
    editor: { view: { dom: document.createElement('div') } },
    extension: { options: { workspaceId: 'workspace-1' } },
  } as unknown as NodeViewProps;
}

describe('NoteVideoNodeView', () => {
  it('keeps saved WebM download recovery using its MIME type after a decode error', async () => {
    const src = 'workspace-asset://workspace-1/mfr7-1234abcd.webm';
    const props = makeProps();
    props.node = { attrs: { src, name: 'Saved demo' } } as NodeViewProps['node'];
    const fetchVideo = vi
      .fn()
      .mockResolvedValue({ ok: true, blob: async () => new Blob(['video']) });
    vi.stubGlobal('fetch', fetchVideo);
    vi.stubGlobal(
      'URL',
      Object.assign(URL, {
        createObjectURL: vi.fn(() => 'blob:saved-video'),
        revokeObjectURL: vi.fn(),
      }),
    );
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(NoteVideoNodeView, { props });
    await fireEvent.error(screen.getByLabelText('Saved demo'));
    expect(screen.getByTestId('media-unavailable').dataset.reason).toBe('load-failed');
    expect(screen.queryByRole('button', { name: /open file|copy path/i })).toBeNull();
    const options = screen.getByRole('button', { name: /video options/i });
    options.focus();
    await fireEvent.keyDown(options, { key: 'ArrowDown' });
    await fireEvent.click(await screen.findByRole('menuitem', { name: /download/i }));
    await waitFor(() => expect(anchorClick).toHaveBeenCalledOnce());
    expect(fetchVideo).toHaveBeenCalledWith(src);
    expect((anchorClick.mock.instances[0] as HTMLAnchorElement).download).toBe('Saved demo.webm');
  });

  it('keeps path actions without treating a video error as confirmed absence', async () => {
    render(NoteVideoNodeView, { props: makeProps() });

    await fireEvent.error(screen.getByLabelText('demo'));

    expect(screen.getByTestId('media-unavailable').dataset.reason).toBe('load-failed');
    expect(screen.getByRole('button', { name: /copy path/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /open file/i })).toBeTruthy();
  });

  it('opens the video lightbox from its explicit action', async () => {
    render(NoteVideoNodeView, { props: makeProps() });

    await fireEvent.click(screen.getByRole('button', { name: /play demo/i }));

    expect(screen.getByRole('dialog', { name: /video preview/i })).toBeTruthy();
  });
});
