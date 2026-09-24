import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { m } from '$shared/paraglide/messages.js';
import FileRow from './FileRow.svelte';

afterEach(cleanup);
const file = { path: 'src/example.ts', staged: false, additions: 2, deletions: 1 };

describe('changed-file context commands', () => {
  it.each(['pointer', 'keyboard'])('routes stage to the same exact file from %s', async (entry) => {
    const onStage = vi.fn();
    const onFileClick = vi.fn();
    render(FileRow, {
      file,
      contextKey: 'ws:primary',
      showStageAction: true,
      onStage,
      onFileClick,
    });
    const row = screen.getByRole('button', { name: /example.ts/ });
    if (entry === 'pointer') await fireEvent.contextMenu(row);
    else await fireEvent.keyDown(row, { key: 'F10', shiftKey: true });
    await fireEvent.click(
      screen.getByRole('menuitem', { name: m.fileTracking_fileRow_stage_label() }),
    );
    expect(onStage).toHaveBeenCalledExactlyOnceWith('src/example.ts');
    expect(onFileClick).not.toHaveBeenCalled();
  });

  it.each(['workspace', 'file', 'staged'])(
    'dismisses when the %s target changes',
    async (change) => {
      const onStage = vi.fn();
      const { rerender } = render(FileRow, {
        file,
        contextKey: 'ws:primary',
        showStageAction: true,
        onStage,
      });
      await fireEvent.keyDown(screen.getByRole('button', { name: /example.ts/ }), {
        key: 'ContextMenu',
      });
      expect(screen.getByRole('menu')).toBeTruthy();
      await rerender({
        file:
          change === 'file'
            ? { ...file, path: 'src/other.ts' }
            : change === 'staged'
              ? { ...file, staged: true }
              : file,
        contextKey: change === 'workspace' ? 'ws:secondary' : 'ws:primary',
      });
      await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
      expect(onStage).not.toHaveBeenCalled();
    },
  );

  it('removes mutating commands when a live target becomes locked, but keeps navigation', async () => {
    const onStage = vi.fn();
    const onFileClick = vi.fn();
    const { rerender } = render(FileRow, {
      file,
      showStageAction: true,
      showRevertAction: true,
      onStage,
      onFileClick,
    });
    await fireEvent.contextMenu(screen.getByRole('button', { name: /example.ts/ }));
    await rerender({ locked: true });
    expect(
      screen.queryByRole('menuitem', { name: m.fileTracking_fileRow_stage_label() }),
    ).toBeNull();
    await fireEvent.click(screen.getByRole('menuitem', { name: m.fileExplorer_tree_open_label() }));
    expect(onFileClick).toHaveBeenCalledWith('src/example.ts', undefined, false, undefined);
    expect(onStage).not.toHaveBeenCalled();
  });
});
