/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';

import ChatReferenceBlock from '../ChatReferenceBlock.svelte';

describe('ChatReferenceBlock', () => {
  it('opens the file on click when a filePath is present', async () => {
    const onOpenFile = vi.fn();
    render(ChatReferenceBlock, {
      props: {
        reference: { filePath: 'src/lib/foo.ts', semanticId: 'src/lib/foo.ts' },
        onOpenFile,
      },
    });

    await fireEvent.click(screen.getByRole('button'));

    expect(onOpenFile).toHaveBeenCalledWith({
      path: 'src/lib/foo.ts',
      line: undefined,
      openInAdjacentPanel: false,
      sourcePanelId: undefined,
    });
  });

  it('derives the path and line from a line-anchored semanticId', async () => {
    const onOpenFile = vi.fn();
    render(ChatReferenceBlock, {
      props: {
        reference: { semanticId: 'src/lib/bar.ts#L10-20' },
        onOpenFile,
      },
    });

    await fireEvent.click(screen.getByRole('button'));

    expect(onOpenFile).toHaveBeenCalledWith({
      path: 'src/lib/bar.ts',
      line: 10,
      openInAdjacentPanel: false,
      sourcePanelId: undefined,
    });
  });

  it('clamps a 0-based "#L0" anchor to line 1 so the jump target is not dropped', async () => {
    const onOpenFile = vi.fn();
    render(ChatReferenceBlock, {
      props: {
        reference: { semanticId: 'src/lib/bar.ts#L0' },
        onOpenFile,
      },
    });

    await fireEvent.click(screen.getByRole('button'));

    expect(onOpenFile).toHaveBeenCalledWith({
      path: 'src/lib/bar.ts',
      line: 1,
      openInAdjacentPanel: false,
      sourcePanelId: undefined,
    });
  });

  it('strips a single-line "#L" anchor carried in filePath and derives the line', async () => {
    const onOpenFile = vi.fn();
    render(ChatReferenceBlock, {
      props: {
        reference: { filePath: 'src/lib/foo.ts#L42' },
        onOpenFile,
      },
    });

    await fireEvent.click(screen.getByRole('button'));

    expect(onOpenFile).toHaveBeenCalledWith({
      path: 'src/lib/foo.ts',
      line: 42,
      openInAdjacentPanel: false,
      sourcePanelId: undefined,
    });
  });

  it('strips a range "#L<n>-<m>" anchor carried in filePath and uses the start line', async () => {
    const onOpenFile = vi.fn();
    render(ChatReferenceBlock, {
      props: {
        reference: { filePath: 'src/lib/foo.ts#L10-20' },
        onOpenFile,
      },
    });

    await fireEvent.click(screen.getByRole('button'));

    expect(onOpenFile).toHaveBeenCalledWith({
      path: 'src/lib/foo.ts',
      line: 10,
      openInAdjacentPanel: false,
      sourcePanelId: undefined,
    });
  });

  it('uses a filePath containing "#symbol:" verbatim (only "#L" anchors are stripped)', async () => {
    const onOpenFile = vi.fn();
    render(ChatReferenceBlock, {
      props: {
        reference: { filePath: 'docs/spec#symbol:notes' },
        onOpenFile,
      },
    });

    await fireEvent.click(screen.getByRole('button'));

    expect(onOpenFile).toHaveBeenCalledWith({
      path: 'docs/spec#symbol:notes',
      line: undefined,
      openInAdjacentPanel: false,
      sourcePanelId: undefined,
    });
  });

  it('uses a filePath containing a literal "#" verbatim', async () => {
    const onOpenFile = vi.fn();
    render(ChatReferenceBlock, {
      props: {
        reference: { filePath: 'docs/notes#section-one' },
        onOpenFile,
      },
    });

    await fireEvent.click(screen.getByRole('button'));

    expect(onOpenFile).toHaveBeenCalledWith({
      path: 'docs/notes#section-one',
      line: undefined,
      openInAdjacentPanel: false,
      sourcePanelId: undefined,
    });
  });

  it('derives the file path from a symbol semanticId', async () => {
    const onOpenFile = vi.fn();
    render(ChatReferenceBlock, {
      props: {
        reference: { semanticId: 'src/lib/baz.ts#symbol:Foo' },
        onOpenFile,
      },
    });

    await fireEvent.click(screen.getByRole('button'));

    expect(onOpenFile).toHaveBeenCalledWith({
      path: 'src/lib/baz.ts',
      line: undefined,
      openInAdjacentPanel: false,
      sourcePanelId: undefined,
    });
  });

  it('requests the adjacent panel when cmd/ctrl is held', async () => {
    const onOpenFile = vi.fn();
    render(ChatReferenceBlock, {
      props: {
        reference: { filePath: 'src/lib/foo.ts' },
        onOpenFile,
      },
    });

    await fireEvent.click(screen.getByRole('button'), { metaKey: true });

    expect(onOpenFile).toHaveBeenCalledWith(
      expect.objectContaining({ openInAdjacentPanel: true }),
    );
  });

  it('renders a non-clickable header when the reference has no file path', () => {
    const onOpenFile = vi.fn();
    render(ChatReferenceBlock, {
      props: {
        reference: { description: 'Some reference' },
        onOpenFile,
      },
    });

    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders a non-clickable header when no onOpenFile callback is provided', () => {
    render(ChatReferenceBlock, {
      props: {
        reference: { filePath: 'src/lib/foo.ts' },
      },
    });

    expect(screen.queryByRole('button')).toBeNull();
  });
});
