/**
 * Version Manager
 *
 * Manages debounced versioning for notes.
 * Creates versions when:
 * - Author changes (user → agent or vice versa)
 * - 5 minutes idle since last version
 * - Note is closed/unloaded
 */

import { Logger } from '../../../../shared/logger';
import type { VersionAuthor } from './note-storage.types';
import { VERSION_CONFIG } from './note-storage.types';
import {
  appendVersion,
  readVersions,
  hasSignificantChanges,
} from './version.service';
import type { NoteId, WorkspaceId } from '../../../../shared/types';

const logger = new Logger('VersionManager');

interface VersionState {
  lastVersionContent: string;
  lastVersionAuthor: VersionAuthor | null;
  lastVersionTime: Date;
  pendingContent: string;
  pendingAuthor: VersionAuthor | null;
  idleTimer: NodeJS.Timeout | null;
}

/**
 * Tracks versioning state for active notes
 */
const noteStates = new Map<string, VersionState>();

/**
 * Get the key for a note in the state map
 */
function getNoteKey(workspaceId: WorkspaceId, noteId: NoteId): string {
  return `${workspaceId}:${noteId}`;
}

/**
 * Initialize version state for a note
 */
export async function initVersionState(
  workspaceId: WorkspaceId,
  noteId: NoteId,
  versionsFile: string,
  currentContent: string,
): Promise<VersionState> {
  const key = getNoteKey(workspaceId, noteId);

  // Read existing versions to get last author
  const versions = await readVersions(versionsFile);
  const lastVersion = versions.length > 0 ? versions[versions.length - 1] : null;

  const state: VersionState = {
    lastVersionContent: currentContent,
    lastVersionAuthor: lastVersion?.author || null,
    lastVersionTime: lastVersion ? new Date(lastVersion.date) : new Date(),
    pendingContent: currentContent,
    pendingAuthor: null,
    idleTimer: null,
  };
  noteStates.set(key, state);
  return state;
}

/**
 * Track content change and determine if version should be created
 */
export async function trackChange(
  workspaceId: WorkspaceId,
  noteId: NoteId,
  versionsFile: string,
  newContent: string,
  author: VersionAuthor,
  title?: string,
): Promise<boolean> {
  const key = getNoteKey(workspaceId, noteId);
  let state = noteStates.get(key);

  // Initialize state if not exists
  if (!state) {
    state = await initVersionState(workspaceId, noteId, versionsFile, newContent);
  }

  // Clear existing idle timer
  if (state.idleTimer) {
    clearTimeout(state.idleTimer);
    state.idleTimer = null;
  }

  // Update pending state
  state.pendingContent = newContent;
  state.pendingAuthor = author;

  // Check if we should create a version now
  let shouldVersion = false;
  const authorChanged =
    state.lastVersionAuthor !== null &&
    (state.lastVersionAuthor.id !== author.id || state.lastVersionAuthor.type !== author.type);

  if (authorChanged && hasSignificantChanges(state.lastVersionContent, newContent)) {
    // Author changed - create version immediately
    shouldVersion = true;
    logger.debug('Creating version due to author change', {
      noteId,
      oldAuthor: state.lastVersionAuthor?.id,
      newAuthor: author.id,
    });
  }

  if (shouldVersion) {
    await createVersion(workspaceId, noteId, versionsFile, newContent, author, title);
    return true;
  }

  // Set up idle timer for auto-versioning
  state.idleTimer = setTimeout(async () => {
    const currentState = noteStates.get(key);
    if (
      currentState &&
      hasSignificantChanges(currentState.lastVersionContent, currentState.pendingContent)
    ) {
      logger.debug('Creating version due to idle timeout', { noteId });
      await createVersion(
        workspaceId,
        noteId,
        versionsFile,
        currentState.pendingContent,
        currentState.pendingAuthor || author,
        title,
      );
    }
  }, VERSION_CONFIG.IDLE_TIMEOUT_MS);

  return false;
}

/**
 * Create a version and update state
 */
async function createVersion(
  workspaceId: WorkspaceId,
  noteId: NoteId,
  versionsFile: string,
  content: string,
  author: VersionAuthor,
  title?: string,
): Promise<void> {
  const key = getNoteKey(workspaceId, noteId);

  await appendVersion(versionsFile, content, author, title);

  // Update state
  const state = noteStates.get(key);
  if (state) {
    state.lastVersionContent = content;
    state.lastVersionAuthor = author;
    state.lastVersionTime = new Date();
    if (state.idleTimer) {
      clearTimeout(state.idleTimer);
      state.idleTimer = null;
    }
  }
}

/**
 * Force create version (e.g., when closing note)
 */
export async function flushPendingVersion(
  workspaceId: WorkspaceId,
  noteId: NoteId,
  versionsFile: string,
  title?: string,
): Promise<boolean> {
  const key = getNoteKey(workspaceId, noteId);
  const state = noteStates.get(key);

  if (!state) return false;

  if (state.idleTimer) {
    clearTimeout(state.idleTimer);
    state.idleTimer = null;
  }

  if (
    state.pendingAuthor &&
    hasSignificantChanges(state.lastVersionContent, state.pendingContent)
  ) {
    await createVersion(
      workspaceId,
      noteId,
      versionsFile,
      state.pendingContent,
      state.pendingAuthor,
      title,
    );
    return true;
  }

  return false;
}

/**
 * Clear state for a note (when closing/unloading)
 */
export function clearVersionState(workspaceId: WorkspaceId, noteId: NoteId): void {
  const key = getNoteKey(workspaceId, noteId);
  const state = noteStates.get(key);

  if (state?.idleTimer) {
    clearTimeout(state.idleTimer);
  }

  noteStates.delete(key);
}

/**
 * Clear all version states (for testing)
 */
export function clearAllVersionStates(): void {
  for (const state of noteStates.values()) {
    if (state.idleTimer) {
      clearTimeout(state.idleTimer);
    }
  }
  noteStates.clear();
}
