/**
 * Tests for Terminal History Tracker
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { terminalHistoryTracker } from '../terminal-history-tracker';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    get length() {
      return Object.keys(store).length;
    },
    key: (index: number) => Object.keys(store)[index] || null,
  };
})();

Object.defineProperty(window, 'localStorage', { value: localStorageMock });

describe('TerminalHistoryTracker', () => {
  const terminalId = 'test-terminal-123';
  const workspaceId = 'test-workspace-456';

  beforeEach(() => {
    localStorageMock.clear();
    // Clear the tracker's internal state
    terminalHistoryTracker.clearHistory(terminalId);
  });

  it('should track command execution', () => {
    const command = 'ls -la';
    const output = 'file1.txt\nfile2.txt\n';

    // Start command
    terminalHistoryTracker.onCommandStart(terminalId, workspaceId, command);

    // Add output
    terminalHistoryTracker.onOutput(terminalId, workspaceId, output);

    // Finish command
    terminalHistoryTracker.onCommandFinish(terminalId, workspaceId);

    // Check history
    const history = terminalHistoryTracker.getHistory(terminalId);
    expect(history).toBeDefined();
    expect(history?.lastCommand).toBe(command);
    expect(history?.lastOutput).toBe(output);
    expect(history?.commands).toHaveLength(1);
    expect(history?.commands[0].command).toBe(command);
    expect(history?.commands[0].output).toBe(output);
  });

  it('should limit command history size', () => {
    // Add more than MAX_HISTORY_SIZE (10) commands
    for (let i = 0; i < 15; i++) {
      terminalHistoryTracker.onCommandStart(terminalId, workspaceId, `command-${i}`);
      terminalHistoryTracker.onOutput(terminalId, workspaceId, `output-${i}`);
      terminalHistoryTracker.onCommandFinish(terminalId, workspaceId);
    }

    const history = terminalHistoryTracker.getHistory(terminalId);
    expect(history?.commands).toHaveLength(10); // Should be limited to 10
    expect(history?.commands[0].command).toBe('command-5'); // Oldest should be command-5
    expect(history?.commands[9].command).toBe('command-14'); // Newest should be command-14
  });

  it('should limit output length', () => {
    const command = 'cat large-file.txt';
    const longOutput = 'x'.repeat(1000); // Create output longer than MAX_OUTPUT_LENGTH (500)

    terminalHistoryTracker.onCommandStart(terminalId, workspaceId, command);
    terminalHistoryTracker.onOutput(terminalId, workspaceId, longOutput);
    terminalHistoryTracker.onCommandFinish(terminalId, workspaceId);

    const history = terminalHistoryTracker.getHistory(terminalId);
    expect(history?.lastOutput).toHaveLength(503); // 500 chars + "..."
    expect(history?.lastOutput?.endsWith('...')).toBe(true);
  });

  it('should persist history to localStorage', () => {
    const command = 'echo "test"';
    const output = 'test\n';

    terminalHistoryTracker.onCommandStart(terminalId, workspaceId, command);
    terminalHistoryTracker.onOutput(terminalId, workspaceId, output);
    terminalHistoryTracker.onCommandFinish(terminalId, workspaceId);

    // Check localStorage
    const storageKey = `terminal-history-${terminalId}`;
    const stored = localStorageMock.getItem(storageKey);
    expect(stored).toBeDefined();

    const parsed = JSON.parse(stored!);
    expect(parsed.terminalId).toBe(terminalId);
    expect(parsed.workspaceId).toBe(workspaceId);
    expect(parsed.lastCommand).toBe(command);
    expect(parsed.commands).toHaveLength(1);
  });

  it('should handle multiple terminals independently', () => {
    const terminal2Id = 'test-terminal-789';

    // Add command to first terminal
    terminalHistoryTracker.onCommandStart(terminalId, workspaceId, 'pwd');
    terminalHistoryTracker.onOutput(terminalId, workspaceId, '/home/user\n');
    terminalHistoryTracker.onCommandFinish(terminalId, workspaceId);

    // Add command to second terminal
    terminalHistoryTracker.onCommandStart(terminal2Id, workspaceId, 'whoami');
    terminalHistoryTracker.onOutput(terminal2Id, workspaceId, 'user\n');
    terminalHistoryTracker.onCommandFinish(terminal2Id, workspaceId);

    // Check histories are independent
    const history1 = terminalHistoryTracker.getHistory(terminalId);
    const history2 = terminalHistoryTracker.getHistory(terminal2Id);

    expect(history1?.lastCommand).toBe('pwd');
    expect(history2?.lastCommand).toBe('whoami');
  });

  it('should clear workspace histories', () => {
    const workspace2Id = 'test-workspace-789';
    const terminal2Id = 'test-terminal-abc';

    // Add commands to terminals in different workspaces
    terminalHistoryTracker.onCommandStart(terminalId, workspaceId, 'ls');
    terminalHistoryTracker.onCommandFinish(terminalId, workspaceId);

    terminalHistoryTracker.onCommandStart(terminal2Id, workspace2Id, 'pwd');
    terminalHistoryTracker.onCommandFinish(terminal2Id, workspace2Id);

    // Clear first workspace
    terminalHistoryTracker.clearWorkspaceHistories(workspaceId);

    // Check only first workspace was cleared
    expect(terminalHistoryTracker.getHistory(terminalId)).toBeUndefined();
    expect(terminalHistoryTracker.getHistory(terminal2Id)).toBeDefined();
  });
});
