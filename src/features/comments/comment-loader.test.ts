import { expect, it, vi } from 'vitest';
vi.mock('$features/notes/notes-read-service', () => ({ isPagedNoteSession: vi.fn() }));
vi.mock('./comments.client', () => ({ commentsClient: { list: vi.fn() } }));
import { isPagedNoteSession } from '$features/notes/notes-read-service';
import { commentsClient } from './comments.client';
import { loadComments } from './comment-loader';
it('does not seed whole comments into an opted-in page session', async () => {
  vi.mocked(isPagedNoteSession).mockReturnValue(true);
  expect(await loadComments({ workspaceId: 'ws', noteId: 'spec' })).toEqual([]);
  expect(commentsClient.list).not.toHaveBeenCalled();
});
it('drops whole-comment hydration that races page ownership', async () => {
  vi.mocked(isPagedNoteSession).mockReturnValueOnce(false).mockReturnValueOnce(true);
  vi.mocked(commentsClient.list).mockResolvedValue({ ok: true, data: [{ id: 'whole' } as never] });
  expect(await loadComments({ workspaceId: 'ws', noteId: 'spec' })).toEqual([]);
});
