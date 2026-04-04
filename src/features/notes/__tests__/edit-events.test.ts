/**
 * Edit Events Tests
 *
 * Verify that edit events are captured and stored correctly
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { editEventsCapturer } from '../edit-events.capturer';
import { editEventsStore } from '../edit-events.store';
import type { NoteEditEvent } from '../edit-events.types';

describe('Edit Events', () => {
  let testWorkspaceId: string;
  let testNoteId: string;
  let testDir: string;

  beforeEach(async () => {
    // Create unique IDs for each test
    testWorkspaceId = `test-workspace-${randomUUID()}`;
    testNoteId = `test-note-${randomUUID()}`;
    testDir = path.join(process.cwd(), '.test-data', testWorkspaceId, 'notes');

    // Create test directory
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(path.join(process.cwd(), '.test-data', testWorkspaceId), {
        recursive: true,
        force: true,
      });
    } catch  {
      // Ignore cleanup errors
    }
  });

  describe('EditEventsCapturer', () => {
    it('should capture addition hunks', () => {
      const oldContent = 'Line 1\nLine 2\nLine 3';
      const newContent = 'Line 1\nLine 2\nNew Line\nLine 3';

      const event = editEventsCapturer.captureEdit(
        testWorkspaceId,
        testNoteId,
        oldContent,
        newContent,
        { id: 'user', name: 'Test User', type: 'user' },
        1,
      );

      expect(event.hunks).toHaveLength(1);
      expect(event.hunks[0].type).toBe('addition');
      expect(event.hunks[0].lineStart).toBe(3);
      expect(event.hunks[0].newContent).toEqual(['New Line']);
    });

    it('should capture deletion hunks', () => {
      const oldContent = 'Line 1\nLine 2\nLine 3\nLine 4';
      const newContent = 'Line 1\nLine 2\nLine 4';

      const event = editEventsCapturer.captureEdit(
        testWorkspaceId,
        testNoteId,
        oldContent,
        newContent,
        { id: 'user', name: 'Test User', type: 'user' },
        1,
      );

      expect(event.hunks).toHaveLength(1);
      expect(event.hunks[0].type).toBe('deletion');
      expect(event.hunks[0].lineStart).toBe(3);
      expect(event.hunks[0].deletedLineCount).toBe(1);
      expect(event.hunks[0].oldContent).toEqual(['Line 3']);
    });

    it('should capture modification hunks', () => {
      const oldContent = 'Line 1\nLine 2\nLine 3';
      const newContent = 'Line 1\nModified Line 2\nLine 3';

      const event = editEventsCapturer.captureEdit(
        testWorkspaceId,
        testNoteId,
        oldContent,
        newContent,
        { id: 'user', name: 'Test User', type: 'user' },
        1,
      );

      expect(event.hunks).toHaveLength(1);
      expect(event.hunks[0].type).toBe('modification');
      expect(event.hunks[0].oldContent).toEqual(['Line 2']);
      expect(event.hunks[0].newContent).toEqual(['Modified Line 2']);
    });

    it('should capture multiple hunks', () => {
      const oldContent = 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5';
      const newContent = 'Line 1\nModified Line 2\nLine 3\nLine 4\nNew Line\nLine 5';

      const event = editEventsCapturer.captureEdit(
        testWorkspaceId,
        testNoteId,
        oldContent,
        newContent,
        { id: 'user', name: 'Test User', type: 'user' },
        1,
      );

      // Should have at least 2 hunks (modification and addition)
      expect(event.hunks.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('EditEventsStore', () => {
    it('should append and read edit events', async () => {
      const event: NoteEditEvent = {
        id: randomUUID(),
        noteId: testNoteId,
        workspaceId: testWorkspaceId,
        timestamp: new Date().toISOString(),
        author: { id: 'user', name: 'Test User', type: 'user' },
        documentVersion: 1,
        hunks: [
          {
            type: 'addition',
            lineStart: 1,
            lineEnd: 1,
            newContent: ['New line'],
          },
        ],
      };

      await editEventsStore.append(event);

      const events = await editEventsStore.readAll(testWorkspaceId, testNoteId);
      expect(events).toHaveLength(1);
      expect(events[0].id).toBe(event.id);
      expect(events[0].hunks).toHaveLength(1);
    });

    it('should append multiple events', async () => {
      const event1: NoteEditEvent = {
        id: randomUUID(),
        noteId: testNoteId,
        workspaceId: testWorkspaceId,
        timestamp: new Date().toISOString(),
        author: { id: 'user', name: 'Test User', type: 'user' },
        documentVersion: 1,
        hunks: [{ type: 'addition', lineStart: 1, lineEnd: 1 }],
      };

      const event2: NoteEditEvent = {
        id: randomUUID(),
        noteId: testNoteId,
        workspaceId: testWorkspaceId,
        timestamp: new Date().toISOString(),
        author: { id: 'agent', name: 'Test Agent', type: 'agent' },
        documentVersion: 2,
        hunks: [{ type: 'modification', lineStart: 1, lineEnd: 1 }],
      };

      await editEventsStore.append(event1);
      await editEventsStore.append(event2);

      const events = await editEventsStore.readAll(testWorkspaceId, testNoteId);
      expect(events).toHaveLength(2);
      expect(events[0].documentVersion).toBe(1);
      expect(events[1].documentVersion).toBe(2);
    });

    it('should read recent events within time window', async () => {
      const oldEvent: NoteEditEvent = {
        id: randomUUID(),
        noteId: testNoteId,
        workspaceId: testWorkspaceId,
        timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
        author: { id: 'user', name: 'Test User', type: 'user' },
        documentVersion: 1,
        hunks: [{ type: 'addition', lineStart: 1, lineEnd: 1 }],
      };

      const recentEvent: NoteEditEvent = {
        id: randomUUID(),
        noteId: testNoteId,
        workspaceId: testWorkspaceId,
        timestamp: new Date().toISOString(), // Now
        author: { id: 'user', name: 'Test User', type: 'user' },
        documentVersion: 2,
        hunks: [{ type: 'addition', lineStart: 2, lineEnd: 2 }],
      };

      await editEventsStore.append(oldEvent);
      await editEventsStore.append(recentEvent);

      // Get events from last hour
      const recentEvents = await editEventsStore.readRecent(
        testWorkspaceId,
        testNoteId,
        60 * 60 * 1000, // 1 hour
      );

      expect(recentEvents).toHaveLength(1);
      expect(recentEvents[0].id).toBe(recentEvent.id);
    });

    it('should update metadata', async () => {
      const event: NoteEditEvent = {
        id: randomUUID(),
        noteId: testNoteId,
        workspaceId: testWorkspaceId,
        timestamp: new Date().toISOString(),
        author: { id: 'user', name: 'Test User', type: 'user' },
        documentVersion: 1,
        hunks: [{ type: 'addition', lineStart: 1, lineEnd: 1 }],
      };

      await editEventsStore.append(event);

      const metadata = await editEventsStore.getMetadata(testWorkspaceId, testNoteId);
      expect(metadata).not.toBeNull();
      expect(metadata?.currentVersion).toBe(1);
      expect(metadata?.totalEvents).toBe(1);
    });
  });
});
