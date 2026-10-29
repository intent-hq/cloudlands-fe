import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WorkspaceStatusImage from '../WorkspaceStatusImage.svelte';

vi.mock('svelte/transition', async (original) => ({
  ...(await original<typeof import('svelte/transition')>()),
  fade: () => ({ duration: 0, css: () => '' }),
}));

afterEach(cleanup);

describe('WorkspaceStatusImage', () => {
  it('uses the workspace asset URL without requiring a status message', () => {
    render(WorkspaceStatusImage, { workspaceId: 'workspace-one', assetId: 'image-one' });
    expect(screen.getByAltText('Workspace status screenshot').getAttribute('src')).toBe(
      'workspace-asset://workspace-one/image-one',
    );
  });

  it('leaves no image row when no status image exists', () => {
    render(WorkspaceStatusImage, { workspaceId: 'workspace-one' });
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.queryByRole('button', { name: 'View workspace status screenshot' })).toBeNull();
  });

  it('hides failed assets and recovers when the asset changes', async () => {
    const view = render(WorkspaceStatusImage, {
      workspaceId: 'workspace-one',
      assetId: 'missing-image',
    });
    await fireEvent.error(screen.getByRole('img'));
    expect(screen.queryByRole('img')).toBeNull();
    await view.rerender({ workspaceId: 'workspace-one', assetId: 'replacement-image' });
    expect(screen.getByRole('img').getAttribute('src')).toBe(
      'workspace-asset://workspace-one/replacement-image',
    );
  });

  it('opens the full image only on activation', async () => {
    render(WorkspaceStatusImage, { workspaceId: 'workspace-one', assetId: 'image-one' });
    expect(screen.queryByRole('dialog')).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'View workspace status screenshot' }));
    expect(await screen.findByRole('dialog', { name: /image preview/i })).toBeTruthy();
  });

  it('keeps replacement images closed after clearing or switching workspaces', async () => {
    const view = render(WorkspaceStatusImage, {
      workspaceId: 'workspace-one',
      assetId: 'image-one',
    });
    await fireEvent.click(screen.getByRole('button', { name: 'View workspace status screenshot' }));
    await screen.findByRole('dialog');
    await view.rerender({ workspaceId: 'workspace-one', assetId: undefined });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await view.rerender({ workspaceId: 'workspace-one', assetId: 'replacement-image' });
    expect(screen.queryByRole('dialog')).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'View workspace status screenshot' }));
    await screen.findByRole('dialog');
    await view.rerender({ workspaceId: 'workspace-two', assetId: 'replacement-image' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'View workspace status screenshot' }),
    );
  });
});
