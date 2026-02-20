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
