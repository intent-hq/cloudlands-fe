/**
 * Shared constants for the notes system
 */

import { NoteId } from '../types/branded-ids';

/**
 * The fixed ID for the workspace specification note
 * This is a special note that stores the workspace specification
 */
export const SPEC_NOTE_ID = NoteId('spec');

/**
 * Check if a note ID is the spec note
 * Uses direct string comparison to avoid any potential issues with branded types
 */
export function isSpecNote(noteId: string | undefined | null): boolean {
  return noteId === 'spec';
}

/**
 * UTF-8 byte limit the note views request via `note.get` `maxContentBytes`
 * (§5.2 "Truncated note reads"). A larger note is shown as its first 500 KB,
 * render-only with a banner; agents and MCP keep full access.
 */
export const NOTE_VIEW_MAX_CONTENT_BYTES = 500_000;
