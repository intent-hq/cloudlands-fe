import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import ContextPanel from '../ContextPanel.svelte';
import { store } from '$store/renderer/store';
import { setComposerContextItems } from '$store/renderer/slices/transient-ui/transient-ui-slice';
import { imageFilesToContextItems } from '$lib/components/chat/input/image-context-items';

describe('ContextPanel live attachments', () => {
  it('shows an image added after the empty sidebar mounts', async () => {
    const dispose = store.init();
    try {
      render(ContextPanel, { workspaceId: 'workspace-one', notes: [], showAddSection: false });
      expect(screen.queryByRole('region', { name: 'Attachments' })).toBeNull();
      const items = await imageFilesToContextItems(
        [new File(['image bytes'], 'dropped.png', { type: 'image/png' })],
        { maxBytes: 1024 },
      );
      store.dispatch(
        setComposerContextItems(
          'workspace-one',
          'agent-one',
          items.map(({ file: _file, ...item }) => item),
        ),
      );
      await waitFor(() => expect(screen.getByRole('img', { name: 'dropped.png' })).toBeTruthy());
      store.dispatch(setComposerContextItems('workspace-one', 'agent-one', []));
      await waitFor(() => expect(screen.queryByRole('region', { name: 'Attachments' })).toBeNull());
    } finally {
      cleanup();
      dispose();
    }
  });
});
