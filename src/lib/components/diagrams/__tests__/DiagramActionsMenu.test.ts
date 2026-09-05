/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from '$lib/components/ui/toast';
import { copyDiagramImage, copyDiagramSvg, downloadDiagramSvg } from '../diagram-export';
import DiagramActionsMenu from '../DiagramActionsMenu.svelte';

vi.mock('$lib/components/ui/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock('../diagram-export', () => ({
  copyDiagramImage: vi.fn(),
  copyDiagramSvg: vi.fn(),
  downloadDiagramSvg: vi.fn(),
}));

async function openMenu() {
  const trigger = screen.getByRole('button', { name: 'Diagram actions' });
  trigger.focus();
  await fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  await screen.findByRole('menu');
  return trigger;
}

beforeEach(() => {
  vi.mocked(copyDiagramImage).mockResolvedValue();
  vi.mocked(copyDiagramSvg).mockResolvedValue();
  vi.mocked(downloadDiagramSvg).mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('DiagramActionsMenu', () => {
  it('opens from the keyboard and exposes the shared action set', async () => {
    render(DiagramActionsMenu, { props: { container: document.createElement('div') } });
    const trigger = await openMenu();

    expect(document.activeElement).toBe(trigger);
    expect(screen.getByRole('menuitem', { name: 'Copy image' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Copy SVG' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Download SVG' })).toBeTruthy();
  });

  it('reports successful copy and download results', async () => {
    const container = document.createElement('div');
    render(DiagramActionsMenu, { props: { container, fileName: 'Architecture' } });

    await openMenu();
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Copy SVG' }));
    await waitFor(() => expect(copyDiagramSvg).toHaveBeenCalledWith(container));
    expect(toast.success).toHaveBeenCalledWith('SVG copied to clipboard');

    await openMenu();
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Download SVG' }));
    expect(downloadDiagramSvg).toHaveBeenCalledWith(container, 'Architecture');
    expect(toast.success).toHaveBeenCalledWith('SVG downloaded');
  });

  it('shows localized feedback when clipboard and download actions fail', async () => {
    vi.mocked(copyDiagramImage).mockRejectedValueOnce(new Error('clipboard denied'));
    vi.mocked(downloadDiagramSvg).mockImplementationOnce(() => {
      throw new Error('download denied');
    });
    render(DiagramActionsMenu, { props: { container: document.createElement('div') } });

    await openMenu();
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Copy image' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Could not copy the diagram'));

    await openMenu();
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Download SVG' }));
    expect(toast.error).toHaveBeenCalledWith('Could not download the diagram');
  });
});
