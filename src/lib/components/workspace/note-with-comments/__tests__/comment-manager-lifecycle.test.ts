import {
  describe,
  it,
  expect,
  beforeEach,
  vi,
} from 'vitest';

vi.mock('../comment-manager-utils', () => ({
  createAndInitializeCommentManagerV2: vi.fn().mockResolvedValue({ id: 'mock-manager' }),
  destroyCommentManagerV2: vi.fn(),
}));

import {
  destroyAndClearCommentManagerV2,
  maybeCreateCommentManagerV2,
} from '../comment-manager-lifecycle';
import {
  createAndInitializeCommentManagerV2,
  destroyCommentManagerV2,
} from '../comment-manager-utils';

describe('comment-manager-lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('maybeCreateCommentManagerV2', () => {
    it('returns null and does not create when showComments is false', async () => {
      const result = await maybeCreateCommentManagerV2({
        showComments: false,
        workspaceId: 'ws-1' as any,
        noteId: 'note-1',
        editor: {} as any,
        onContentChanged: vi.fn(),
      });

      expect(result).toBeNull();
      expect(createAndInitializeCommentManagerV2).not.toHaveBeenCalled();
    });

    it('returns null and does not create when ids are missing', async () => {
      const result = await maybeCreateCommentManagerV2({
        showComments: true,
        workspaceId: null,
        noteId: null,
        editor: {} as any,
        onContentChanged: vi.fn(),
      });

      expect(result).toBeNull();
      expect(createAndInitializeCommentManagerV2).not.toHaveBeenCalled();
    });

    it('creates when enabled and ids are present', async () => {
      const editor = { id: 'editor' } as any;
      const onContentChanged = vi.fn();

      const result = await maybeCreateCommentManagerV2({
        showComments: true,
        workspaceId: 'ws-1' as any,
        noteId: 'note-1',
        editor,
        onContentChanged,
      });

      expect(result).toEqual({ id: 'mock-manager' });
      expect(createAndInitializeCommentManagerV2).toHaveBeenCalledWith({
        workspaceId: 'ws-1',
        noteId: 'note-1',
        editor,
        onContentChanged,
      });
    });
  });

  describe('destroyAndClearCommentManagerV2', () => {
    it('destroys when provided and returns null', () => {
      const manager = { id: 'manager' } as any;
      const result = destroyAndClearCommentManagerV2(manager);
      expect(destroyCommentManagerV2).toHaveBeenCalledWith(manager);
      expect(result).toBeNull();
    });

    it('is safe when manager is null', () => {
      const result = destroyAndClearCommentManagerV2(null);
      expect(destroyCommentManagerV2).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });
  });
});
