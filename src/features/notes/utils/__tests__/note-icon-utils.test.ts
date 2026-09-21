/**
 * Tests for note icon utilities
 */

import { describe, it, expect } from 'vitest';
import { getNoteIcon } from '../note-icon-utils';
import {
  faStar,
  faCheckCircle,
  faCommentDots,
  faBell,
  faHourglassHalf,
  faBan,
} from '@fortawesome/free-solid-svg-icons';
import { faNote } from '$lib/icons/faNote';
import type { Note } from '$shared/types';

describe('note-icon-utils', () => {
  const createNote = (overrides: Partial<Note> = {}): Note =>
    ({
      id: 'test-note',
      title: 'Test Note',
      content: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...overrides,
    }) as Note;

  describe('getNoteIcon', () => {
    it('should return star icon for spec notes', () => {
      const note = createNote({ id: 'spec' });
      expect(getNoteIcon(note)).toBe(faStar);
    });

    it('should return checkmark for complete tasks', () => {
      const note = createNote({
        metadata: { task: { status: 'complete' } },
      });
      expect(getNoteIcon(note)).toBe(faCheckCircle);
    });

    it('should return comment dots for in_progress tasks', () => {
      const note = createNote({
        metadata: { task: { status: 'in_progress' } },
      });
      expect(getNoteIcon(note)).toBe(faCommentDots);
    });

    it('should return hourglass for waiting tasks', () => {
      const note = createNote({
        metadata: { task: { status: 'waiting' } },
      });
      expect(getNoteIcon(note)).toBe(faHourglassHalf);
    });

    it('should return bell for discussion_needed tasks', () => {
      const note = createNote({
        metadata: { task: { status: 'discussion_needed' } },
      });
      expect(getNoteIcon(note)).toBe(faBell);
    });

    it('should return bell for review_required tasks', () => {
      const note = createNote({
        metadata: { task: { status: 'review_required' } },
      });
      expect(getNoteIcon(note)).toBe(faBell);
    });

    it('should return ban for cancelled tasks', () => {
      const note = createNote({
        metadata: { task: { status: 'cancelled' } },
      });
      expect(getNoteIcon(note)).toBe(faBan);
    });

    it('should return default note icon for regular notes', () => {
      const note = createNote();
      expect(getNoteIcon(note)).toBe(faNote);
    });

    it('should return default note icon for not_started tasks', () => {
      const note = createNote({
        metadata: { task: { status: 'not_started' } },
      });
      expect(getNoteIcon(note)).toBe(faNote);
    });
  });
});
