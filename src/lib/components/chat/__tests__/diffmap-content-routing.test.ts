/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ContentBlock } from '$shared/types';
import { store as appStore } from '$store/renderer/store';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('diff map chat block', () => {
  it('renders compact data and opens a clicked workspace file', async () => {
    const dispose = appStore.init();
    const dispatch = vi.spyOn(appStore, 'dispatch').mockImplementation((action: any) => action);
    const MessageContent = (await import('../MessageContent.svelte')).default;
    const text = `\`\`\`ws-block:diffmap
{"files":[{"path":"src/app.ts","additions":3,"deletions":1,"status":"modified"},{"path":"tests/app.test.ts","additions":2,"deletions":0,"status":"added"}],"annotations":[{"kind":"claim","label":"My claim","paths":["src/app.ts"],"provenance":"agent-1"},{"kind":"group","label":"UI","paths":["src/app.ts"]}]}
\`\`\``;

    render(MessageContent, {
      props: {
        content: [{ type: 'text', text } as ContentBlock],
        role: 'assistant',
        workspaceId: 'workspace-1',
      },
    });

    const file = await screen.findByRole('button', { name: /src\/app\.ts/ });
    const otherFile = await screen.findByRole('button', { name: /tests\/app\.test\.ts/ });
    await fireEvent.click(screen.getByRole('button', { name: 'My claim' }));
    await waitFor(() => expect(file.getAttribute('aria-pressed')).toBe('true'));
    await fireEvent.click(screen.getByRole('button', { name: 'UI' }));
    await waitFor(() => expect(otherFile.style.opacity).toBe('0.28'));
    await fireEvent.click(file);

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'workspaceNavigation/openWorkspaceFile',
        payload: [
          'workspace-1',
          'src/app.ts',
          expect.objectContaining({ openInAdjacentPanel: false }),
        ],
      }),
    );
    dispose();
  });
});
