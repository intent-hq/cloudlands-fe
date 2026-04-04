/**
 * Event Store JSONL Persistence Tests
 *
 * Tests the JSONL file format, append-only writes, migration, and error handling.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventStore } from '../main/event-store';
import { WorkspaceEvent, WorkspaceEventType } from '../types';
import * as fs from 'fs/promises';
import * as path from 'path';
import { existsSync } from 'fs';
import { tmpdir } from 'os';

describe('EventStore JSONL Persistence', () => {
  let store: EventStore;
  let testDir: string;
  const workspaceId = 'test-jsonl-workspace';

  beforeEach(async () => {
    // Create a unique temp directory for each test
    testDir = path.join(
      tmpdir(),
      `event-store-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up
    if (store) {
      await store.dispose();
    }
    // Remove test directory
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  function createEvent(
    id: string,
    type: WorkspaceEventType = 'file:changed' as WorkspaceEventType,
  ): WorkspaceEvent {
    return {
      id,
      type,
      workspaceId,
      timestamp: new Date().toISOString(),
      actor: { type: 'user', name: 'test' },
      data: { path: `file-${id}.ts` },
    };
  }

  describe('JSONL File Format', () => {
    it('should save events in JSONL format (one per line)', async () => {
      store = new EventStore(workspaceId, {
        persistToDisk: true,
        storageDir: testDir,
        maxEvents: 100,
      });

      // Add events
      store.add(createEvent('1'));
      store.add(createEvent('2'));
      store.add(createEvent('3'));

      // Force save
      await store.forceSave();

      // Read the file
      const filePath = path.join(testDir, 'events.jsonl');
      expect(existsSync(filePath)).toBe(true);

      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.trim().split('\n');

      expect(lines.length).toBe(3);

      // Each line should be valid JSON
      for (const line of lines) {
        const event = JSON.parse(line);
        expect(event).toHaveProperty('id');
        expect(event).toHaveProperty('type');
        expect(event).toHaveProperty('workspaceId');
      }
    });

    it('should load events from JSONL file', async () => {
      // Create a JSONL file manually
      const filePath = path.join(testDir, 'events.jsonl');
      const events = [createEvent('load-1'), createEvent('load-2'), createEvent('load-3')];
      const content = events.map((e) => JSON.stringify(e)).join('\n') + '\n';
      await fs.writeFile(filePath, content, 'utf-8');

      // Create store and let it load
      store = new EventStore(workspaceId, {
        persistToDisk: true,
        storageDir: testDir,
        maxEvents: 100,
      });

      // Wait for load
      await store.initialize();

      // Verify events loaded
      const allEvents = store.getAll();
      expect(allEvents.length).toBe(3);
      expect(allEvents[0].id).toBe('load-1');
      expect(allEvents[1].id).toBe('load-2');
      expect(allEvents[2].id).toBe('load-3');
    });

    it('should append new events without rewriting entire file', async () => {
      store = new EventStore(workspaceId, {
        persistToDisk: true,
        storageDir: testDir,
        maxEvents: 100,
      });

      // Add initial events
      store.add(createEvent('initial-1'));
      store.add(createEvent('initial-2'));
      await store.forceSave();

      // Get file size after initial save
      const filePath = path.join(testDir, 'events.jsonl');
      const initialSize = (await fs.stat(filePath)).size;

      // Add more events
      store.add(createEvent('append-1'));
      await store.forceSave();

      // File should have grown (appended)
      const newSize = (await fs.stat(filePath)).size;
      expect(newSize).toBeGreaterThan(initialSize);

      // Verify all events are there
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.trim().split('\n');
      expect(lines.length).toBe(3);
    });
  });

  describe('Event Sanitization', () => {
    it('should strip large content fields but preserve diff from file events', async () => {
      store = new EventStore(workspaceId, {
        persistToDisk: true,
        storageDir: testDir,
        maxEvents: 100,
      });

      // Add event with large fields - content fields should be stripped, diff preserved
      const eventWithLargeFields: WorkspaceEvent = {
        id: 'large-1',
        type: 'file:changed' as WorkspaceEventType,
        workspaceId,
        timestamp: new Date().toISOString(),
        actor: { type: 'user', name: 'test' },
        data: {
          path: 'test.ts',
          diff: 'x'.repeat(10000), // Diff within 50KB cap - should be PRESERVED
          oldContent: 'y'.repeat(10000), // Large old content - should be stripped
          newContent: 'z'.repeat(10000), // Large new content - should be stripped
          content: 'w'.repeat(10000), // Large content - should be stripped
          // These should be preserved
          additions: 5,
          deletions: 2,
        },
      };

      store.add(eventWithLargeFields);
      await store.forceSave();

      // Read the file and verify content fields are stripped but diff is preserved
      const filePath = path.join(testDir, 'events.jsonl');
      const content = await fs.readFile(filePath, 'utf-8');
      const savedEvent = JSON.parse(content.trim());

      // Diff is preserved (under 50KB cap)
      expect(savedEvent.data.diff).toBe('x'.repeat(10000));
      // Content fields are stripped
      expect(savedEvent.data.oldContent).toBeUndefined();
      expect(savedEvent.data.newContent).toBeUndefined();
      expect(savedEvent.data.content).toBeUndefined();
      // Preserved fields
      expect(savedEvent.data.path).toBe('test.ts');
      expect(savedEvent.data.additions).toBe(5);
      expect(savedEvent.data.deletions).toBe(2);
    });

    it('should strip oversized diffs that exceed the size cap', async () => {
      store = new EventStore(workspaceId, {
        persistToDisk: true,
        storageDir: testDir,
        maxEvents: 100,
      });

      // Add event with a diff that exceeds the 50KB cap
      const eventWithHugeDiff: WorkspaceEvent = {
        id: 'huge-diff-1',
        type: 'file:changed' as WorkspaceEventType,
        workspaceId,
        timestamp: new Date().toISOString(),
        actor: { type: 'user', name: 'test' },
        data: {
          path: 'big-file.ts',
          diff: 'x'.repeat(60000), // Over 50KB cap - should be stripped
          additions: 100,
          deletions: 50,
        },
      };

      store.add(eventWithHugeDiff);
      await store.forceSave();

      const filePath = path.join(testDir, 'events.jsonl');
      const content = await fs.readFile(filePath, 'utf-8');
      const savedEvent = JSON.parse(content.trim());

      // Oversized diff is stripped
      expect(savedEvent.data.diff).toBeUndefined();
      // Other fields preserved
      expect(savedEvent.data.path).toBe('big-file.ts');
      expect(savedEvent.data.additions).toBe(100);
      expect(savedEvent.data.deletions).toBe(50);
    });

    it('should truncate large terminal output', async () => {
      store = new EventStore(workspaceId, {
        persistToDisk: true,
        storageDir: testDir,
        maxEvents: 100,
      });

      const eventWithLargeOutput: WorkspaceEvent = {
        id: 'terminal-1',
        type: 'terminal:command' as WorkspaceEventType,
        workspaceId,
        timestamp: new Date().toISOString(),
        actor: { type: 'user', name: 'test' },
        data: {
          command: 'npm test',
          output: 'x'.repeat(2000), // Large output
        },
      };

      store.add(eventWithLargeOutput);
      await store.forceSave();

      const filePath = path.join(testDir, 'events.jsonl');
      const content = await fs.readFile(filePath, 'utf-8');
      const savedEvent = JSON.parse(content.trim());

      // Output should be truncated to ~500 chars + truncation marker
      expect(savedEvent.data.output.length).toBeLessThan(600);
      expect(savedEvent.data.output).toContain('[truncated]');
    });
  });

  describe('Legacy Migration', () => {
    it('should migrate from legacy events.json to events.jsonl', async () => {
      // Create a legacy JSON file with the expected format (version 1)
      const legacyPath = path.join(testDir, 'events.json');
      const legacyEvents = [createEvent('legacy-1'), createEvent('legacy-2')];
      const legacyData = {
        version: 1,
        workspaceId,
        savedAt: new Date().toISOString(),
        events: legacyEvents,
      };
      await fs.writeFile(legacyPath, JSON.stringify(legacyData, null, 2), 'utf-8');

      // Create store - should migrate
      store = new EventStore(workspaceId, {
        persistToDisk: true,
        storageDir: testDir,
        maxEvents: 100,
      });

      await store.initialize();

      // Verify events loaded
      const allEvents = store.getAll();
      expect(allEvents.length).toBe(2);
      expect(allEvents[0].id).toBe('legacy-1');

      // Force save to trigger migration
      await store.forceSave();

      // JSONL file should exist
      const jsonlPath = path.join(testDir, 'events.jsonl');
      expect(existsSync(jsonlPath)).toBe(true);

      // Legacy file should still exist (backup)
      expect(existsSync(legacyPath)).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should handle corrupted lines gracefully', async () => {
      // Create a JSONL file with some corrupted lines
      const filePath = path.join(testDir, 'events.jsonl');
      const validEvent1 = JSON.stringify(createEvent('valid-1'));
      const validEvent2 = JSON.stringify(createEvent('valid-2'));
      const content = `${validEvent1}\n{corrupted json\n${validEvent2}\n`;
      await fs.writeFile(filePath, content, 'utf-8');

      // Create store - should load valid events and skip corrupted
      store = new EventStore(workspaceId, {
        persistToDisk: true,
        storageDir: testDir,
        maxEvents: 100,
      });

      await store.initialize();

      // Should have loaded the valid events
      const allEvents = store.getAll();
      expect(allEvents.length).toBe(2);
      expect(allEvents[0].id).toBe('valid-1');
      expect(allEvents[1].id).toBe('valid-2');
    });

    it('should handle empty lines gracefully', async () => {
      const filePath = path.join(testDir, 'events.jsonl');
      const validEvent = JSON.stringify(createEvent('valid-1'));
      const content = `\n${validEvent}\n\n\n`;
      await fs.writeFile(filePath, content, 'utf-8');

      store = new EventStore(workspaceId, {
        persistToDisk: true,
        storageDir: testDir,
        maxEvents: 100,
      });

      await store.initialize();

      const allEvents = store.getAll();
      expect(allEvents.length).toBe(1);
      expect(allEvents[0].id).toBe('valid-1');
    });

    it('should handle missing file gracefully', async () => {
      store = new EventStore(workspaceId, {
        persistToDisk: true,
        storageDir: testDir,
        maxEvents: 100,
      });

      await store.initialize();

      // Should start with empty events
      const allEvents = store.getAll();
      expect(allEvents.length).toBe(0);
    });
  });

  describe('Compaction', () => {
    it('should rewrite file after compaction', async () => {
      store = new EventStore(workspaceId, {
        persistToDisk: true,
        storageDir: testDir,
        maxEvents: 5, // Small limit to trigger removal
      });

      // Add more events than maxEvents
      for (let i = 0; i < 10; i++) {
        store.add(createEvent(`event-${i}`));
      }

      await store.forceSave();

      // Should only have maxEvents
      const allEvents = store.getAll();
      expect(allEvents.length).toBe(5);

      // File should only have 5 events
      const filePath = path.join(testDir, 'events.jsonl');
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.trim().split('\n');
      expect(lines.length).toBe(5);

      // Should have the most recent events
      const lastEvent = JSON.parse(lines[4]);
      expect(lastEvent.id).toBe('event-9');
    });
  });

  describe('Edge Cases', () => {
    it('should handle rapid sequential adds and saves', async () => {
      store = new EventStore(workspaceId, {
        persistToDisk: true,
        storageDir: testDir,
        maxEvents: 100,
        saveDebounceMs: 50, // Short debounce for testing
      });

      // Rapidly add events
      for (let i = 0; i < 20; i++) {
        store.add(createEvent(`rapid-${i}`));
      }

      // Force save
      await store.forceSave();

      // All events should be saved
      const filePath = path.join(testDir, 'events.jsonl');
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.trim().split('\n');
      expect(lines.length).toBe(20);
    });

    it('should handle multiple save calls correctly', async () => {
      store = new EventStore(workspaceId, {
        persistToDisk: true,
        storageDir: testDir,
        maxEvents: 100,
      });

      store.add(createEvent('multi-1'));
      await store.forceSave();

      store.add(createEvent('multi-2'));
      await store.forceSave();

      store.add(createEvent('multi-3'));
      await store.forceSave();

      // All events should be in file
      const filePath = path.join(testDir, 'events.jsonl');
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.trim().split('\n');
      expect(lines.length).toBe(3);

      // Verify order
      expect(JSON.parse(lines[0]).id).toBe('multi-1');
      expect(JSON.parse(lines[1]).id).toBe('multi-2');
      expect(JSON.parse(lines[2]).id).toBe('multi-3');
    });

    it('should persist events across store instances', async () => {
      // First store instance
      store = new EventStore(workspaceId, {
        persistToDisk: true,
        storageDir: testDir,
        maxEvents: 100,
      });

      store.add(createEvent('persist-1'));
      store.add(createEvent('persist-2'));
      await store.forceSave();
      await store.dispose();

      // Second store instance - should load persisted events
      const store2 = new EventStore(workspaceId, {
        persistToDisk: true,
        storageDir: testDir,
        maxEvents: 100,
      });

      await store2.initialize();

      const allEvents = store2.getAll();
      expect(allEvents.length).toBe(2);
      expect(allEvents[0].id).toBe('persist-1');
      expect(allEvents[1].id).toBe('persist-2');

      // Add more events
      store2.add(createEvent('persist-3'));
      await store2.forceSave();

      // Verify file has all 3
      const filePath = path.join(testDir, 'events.jsonl');
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.trim().split('\n');
      expect(lines.length).toBe(3);

      await store2.dispose();
      store = null as any; // Prevent afterEach from disposing again
    });

    it('should handle clear and re-add correctly', async () => {
      store = new EventStore(workspaceId, {
        persistToDisk: true,
        storageDir: testDir,
        maxEvents: 100,
      });

      // Add events
      store.add(createEvent('before-clear-1'));
      store.add(createEvent('before-clear-2'));
      await store.forceSave();

      // Clear
      await store.clear();

      // File should be empty or not exist
      const filePath = path.join(testDir, 'events.jsonl');
      if (existsSync(filePath)) {
        const content = await fs.readFile(filePath, 'utf-8');
        expect(content.trim()).toBe('');
      }

      // Add new events
      store.add(createEvent('after-clear-1'));
      await store.forceSave();

      // Should only have new event
      const allEvents = store.getAll();
      expect(allEvents.length).toBe(1);
      expect(allEvents[0].id).toBe('after-clear-1');
    });

    it('should not duplicate events on reload', async () => {
      store = new EventStore(workspaceId, {
        persistToDisk: true,
        storageDir: testDir,
        maxEvents: 100,
      });

      store.add(createEvent('no-dup-1'));
      store.add(createEvent('no-dup-2'));
      await store.forceSave();
      await store.dispose();

      // Reload multiple times
      for (let i = 0; i < 3; i++) {
        const tempStore = new EventStore(workspaceId, {
          persistToDisk: true,
          storageDir: testDir,
          maxEvents: 100,
        });
        await tempStore.initialize();

        const allEvents = tempStore.getAll();
        expect(allEvents.length).toBe(2);

        await tempStore.dispose();
      }

      store = null as any;
    });

    it('should handle events with special characters in data', async () => {
      store = new EventStore(workspaceId, {
        persistToDisk: true,
        storageDir: testDir,
        maxEvents: 100,
      });

      const specialEvent: WorkspaceEvent = {
        id: 'special-chars',
        type: 'agent:message' as WorkspaceEventType,
        workspaceId,
        timestamp: new Date().toISOString(),
        actor: { type: 'user', name: 'test' },
        data: {
          message: 'Line1\nLine2\tTabbed\r\nWindows line',
          unicode: '日本語 🎉 émojis',
          quotes: '"double" and \'single\'',
          backslash: 'path\\to\\file',
        },
      };

      store.add(specialEvent);
      await store.forceSave();

      // Reload and verify
      await store.dispose();

      const store2 = new EventStore(workspaceId, {
        persistToDisk: true,
        storageDir: testDir,
        maxEvents: 100,
      });

      await store2.initialize();

      const allEvents = store2.getAll();
      expect(allEvents.length).toBe(1);
      const data = allEvents[0].data as any;
      expect(data.message).toBe('Line1\nLine2\tTabbed\r\nWindows line');
      expect(data.unicode).toBe('日本語 🎉 émojis');
      expect(data.quotes).toBe('"double" and \'single\'');
      expect(data.backslash).toBe('path\\to\\file');

      await store2.dispose();
      store = null as any;
    });
  });
});
