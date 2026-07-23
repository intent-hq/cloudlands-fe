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

  it('rejects when the editor holds genuinely unsaved edits (differs from lastKnownContent and incoming)', () => {
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

  it('does not reject when all local edits are saved (editor matches lastKnownContent) and the server note grew', () => {
    // Regression (STAB stale-editor incident): user edits → debounce save runs
    // (lastKnownContent = editor content) → an agent appends server-side. The
    // newer, longer server content must be applied even though the flag is set.
    const savedMarkdown = '# Spec\n\nUser paragraph.';
    const grownServerContent = '# Spec\n\nUser paragraph.\n\n## Agent-appended section\n\nMore.';

    const reject = shouldRejectExternalUpdateDueToUnsavedEdits({
      hasUserEditedSinceLastSave: true,
      isUpdatingFromExternal: false,
      editor: { getHTML: vi.fn(() => '<h1>Spec</h1><p>User paragraph.</p>') },
      newContent: grownServerContent,
      lastKnownContent: savedMarkdown,
      processHTMLToMarkdown: vi.fn(() => savedMarkdown),
      noteId: 'spec',
      updateVersion: 5,
      logger,
    });

    expect(reject).toBe(false);
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('does not reject when the editor already matches the incoming content', () => {
    const reject = shouldRejectExternalUpdateDueToUnsavedEdits({
      hasUserEditedSinceLastSave: true,
      isUpdatingFromExternal: false,
      editor: { getHTML: vi.fn(() => '<p>same</p>') },
      newContent: 'same',
      lastKnownContent: 'older-saved',
      processHTMLToMarkdown: vi.fn(() => 'same'),
      noteId: 'note-1',
      updateVersion: 6,
      logger,
    });

    expect(reject).toBe(false);
  });

  it('logs error and rejects conservatively when normalization throws', () => {
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
    // Cannot prove the editor is saved, so assume unsaved edits and reject
    expect(reject).toBe(true);
  });
});
