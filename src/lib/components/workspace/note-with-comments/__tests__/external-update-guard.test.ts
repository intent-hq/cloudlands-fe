import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
} from 'vitest';

import { shouldRejectExternalUpdateDueToUnsavedEdits } from '../external-update-guard';

describe('external-update-guard', () => {
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not reject when user has not edited since last save', () => {
    const reject = shouldRejectExternalUpdateDueToUnsavedEdits({
      hasUserEditedSinceLastSave: false,
      isUpdatingFromExternal: false,
      editor: { getHTML: vi.fn(() => '<p>x</p>') },
      newContent: 'new',
      lastKnownContent: 'old',
      processHTMLToMarkdown: vi.fn(() => 'whatever'),
      noteId: 'note-1',
      updateVersion: 1,
      logger,
    });

    expect(reject).toBe(false);
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('does not reject while applying an external update', () => {
    const reject = shouldRejectExternalUpdateDueToUnsavedEdits({
      hasUserEditedSinceLastSave: true,
      isUpdatingFromExternal: true,
      editor: { getHTML: vi.fn(() => '<p>x</p>') },
      newContent: 'new',
      lastKnownContent: 'old',
      processHTMLToMarkdown: vi.fn(() => 'different'),
      noteId: 'note-1',
      updateVersion: 2,
      logger,
    });

    expect(reject).toBe(false);
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('rejects when normalized current markdown differs from incoming content', () => {
    const reject = shouldRejectExternalUpdateDueToUnsavedEdits({
      hasUserEditedSinceLastSave: true,
      isUpdatingFromExternal: false,
      editor: { getHTML: vi.fn(() => '<p>user</p>') },
      newContent: 'incoming',
      lastKnownContent: 'saved',
      processHTMLToMarkdown: vi.fn(() => 'user-edited'),
      noteId: 'note-1',
      updateVersion: 3,
      logger,
    });

    expect(reject).toBe(true);
    expect(logger.info).toHaveBeenCalledWith(
      '[NoteWithComments] Rejecting external update - user has unsaved edits',
      expect.objectContaining({ noteId: 'note-1', updateVersion: 3 }),
    );
  });

  it('logs error when normalization throws, and rejects based on lastKnownContent fallback', () => {
    const reject = shouldRejectExternalUpdateDueToUnsavedEdits({
      hasUserEditedSinceLastSave: true,
      isUpdatingFromExternal: false,
      editor: { getHTML: vi.fn(() => '<p>user</p>') },
      newContent: 'incoming',
      lastKnownContent: 'saved',
      processHTMLToMarkdown: vi.fn(() => {
        throw new Error('boom');
      }),
      noteId: null,
      updateVersion: 4,
      logger,
    });

    expect(logger.error).toHaveBeenCalledWith(
      '[NoteWithComments] Failed to normalize current editor content',
      expect.any(Error),
    );
    // fallback currentMarkdown = lastKnownContent ('saved') which differs from incoming
    expect(reject).toBe(true);
  });
});
