import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock executeAuggieCommand before importing the service
vi.mock('../../auggie/main/execute-auggie-command', () => ({
  executeAuggieCommand: vi.fn(),
}));

// Mock logger
vi.mock('$shared/logger', () => ({
  Logger: class {
    debug = vi.fn();
    info = vi.fn();
    warn = vi.fn();
    error = vi.fn();
  },
}));

import { getSessionStats, getAggregatedSessionStats } from './session-stats.service';
import { executeAuggieCommand } from '../../auggie/main/execute-auggie-command';

const mockExecute = vi.mocked(executeAuggieCommand);

function makeCLIResponse(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: 'sess-1',
    created: '2025-01-01T00:00:00Z',
    modified: '2025-01-02T00:00:00Z',
    title: 'Test Session',
    messageCount: 10,
    toolCount: 5,
    creditsUsed: 1.5,
    parentCreditsUsed: 1.0,
    subAgentCreditsUsed: 0.5,
    ...overrides,
  };
}

beforeEach(() => {
  mockExecute.mockReset();
});

describe('getSessionStats', () => {
  it('parses valid CLI output', async () => {
    const cliData = makeCLIResponse();
    mockExecute.mockResolvedValue({ stdout: JSON.stringify(cliData), stderr: '' });

    const result = await getSessionStats('sess-1');

    expect(result.sessionId).toBe('sess-1');
    expect(result.creditsUsed).toBe(1.5);
    expect(result.title).toBe('Test Session');
    expect(mockExecute).toHaveBeenCalledWith('session stats sess-1 --json', { timeout: 10_000 });
  });

  it('preserves null fields', async () => {
    const cliData = makeCLIResponse({
      title: null,
      creditsUsed: null,
      parentCreditsUsed: null,
      subAgentCreditsUsed: null,
    });
    mockExecute.mockResolvedValue({ stdout: JSON.stringify(cliData), stderr: '' });

    const result = await getSessionStats('sess-1');

    expect(result.title).toBeNull();
    expect(result.creditsUsed).toBeNull();
    expect(result.parentCreditsUsed).toBeNull();
    expect(result.subAgentCreditsUsed).toBeNull();
  });

  it('throws on invalid JSON', async () => {
    mockExecute.mockResolvedValue({ stdout: 'not json', stderr: '' });
    await expect(getSessionStats('sess-1')).rejects.toThrow('failed to parse CLI output as JSON');
  });

  it('throws on missing required fields', async () => {
    const cliData = makeCLIResponse();
    delete (cliData as Record<string, unknown>).messageCount;
    mockExecute.mockResolvedValue({ stdout: JSON.stringify(cliData), stderr: '' });

    await expect(getSessionStats('sess-1')).rejects.toThrow('missing or invalid required field');
  });
});

describe('getAggregatedSessionStats', () => {
  it('aggregates multiple sessions with null coercion', async () => {
    const s1 = makeCLIResponse({ sessionId: 's1', creditsUsed: 2.0, parentCreditsUsed: 1.5, subAgentCreditsUsed: 0.5 });
    const s2 = makeCLIResponse({ sessionId: 's2', creditsUsed: null, parentCreditsUsed: null, subAgentCreditsUsed: null, messageCount: 20, toolCount: 10 });

    mockExecute
      .mockResolvedValueOnce({ stdout: JSON.stringify(s1), stderr: '' })
      .mockResolvedValueOnce({ stdout: JSON.stringify(s2), stderr: '' });

    const result = await getAggregatedSessionStats(['s1', 's2']);

    expect(result.sessions).toHaveLength(2);
    expect(result.totalCreditsUsed).toBe(2.0);
    expect(result.totalParentCreditsUsed).toBe(1.5);
    expect(result.totalSubAgentCreditsUsed).toBe(0.5);
    expect(result.totalMessageCount).toBe(30);
    expect(result.totalToolCount).toBe(15);
    expect(result.hasPendingCredits).toBe(true);
  });

  it('sets hasPendingCredits false when all credits are numbers', async () => {
    const s1 = makeCLIResponse({ sessionId: 's1', creditsUsed: 1.0 });
    mockExecute.mockResolvedValueOnce({ stdout: JSON.stringify(s1), stderr: '' });

    const result = await getAggregatedSessionStats(['s1']);

    expect(result.hasPendingCredits).toBe(false);
  });

  it('returns partial results when some sessions fail', async () => {
    const s1 = makeCLIResponse({ sessionId: 's1' });
    mockExecute
      .mockResolvedValueOnce({ stdout: JSON.stringify(s1), stderr: '' })
      .mockRejectedValueOnce(new Error('CLI timeout'));

    const result = await getAggregatedSessionStats(['s1', 's2']);

    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].sessionId).toBe('s1');
  });

  it('throws when all sessions fail', async () => {
    mockExecute
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'));

    await expect(getAggregatedSessionStats(['s1', 's2'])).rejects.toThrow(
      'All 2 session stats requests failed',
    );
  });

  it('returns empty sessions for empty input', async () => {
    const result = await getAggregatedSessionStats([]);

    expect(result.sessions).toHaveLength(0);
    expect(result.totalCreditsUsed).toBe(0);
    expect(result.hasPendingCredits).toBe(false);
    expect(result.isPartial).toBe(false);
    expect(result.failedCount).toBe(0);
  });

  it('sets isPartial and failedCount when some sessions fail', async () => {
    const s1 = makeCLIResponse({ sessionId: 's1', creditsUsed: 2.0, messageCount: 5, toolCount: 3 });
    const s2 = makeCLIResponse({ sessionId: 's2', creditsUsed: 1.0, messageCount: 4, toolCount: 2 });

    mockExecute
      .mockResolvedValueOnce({ stdout: JSON.stringify(s1), stderr: '' })
      .mockRejectedValueOnce(new Error('CLI timeout'))
      .mockResolvedValueOnce({ stdout: JSON.stringify(s2), stderr: '' });

    const result = await getAggregatedSessionStats(['s1', 's-fail', 's2']);

    expect(result.isPartial).toBe(true);
    expect(result.failedCount).toBe(1);
    expect(result.sessions).toHaveLength(2);
    // Totals sum only the 2 successful sessions
    expect(result.totalCreditsUsed).toBe(3.0);
    expect(result.totalMessageCount).toBe(9);
    expect(result.totalToolCount).toBe(5);
  });

  it('limits concurrent CLI stats requests', async () => {
    const sessionIds = Array.from({ length: 12 }, (_, i) => `s${i}`);
    let inFlight = 0;
    let maxInFlight = 0;

    mockExecute.mockImplementation(async (command) => {
      const sessionId = command.split(' ')[2];
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 0));
      inFlight--;
      return {
        stdout: JSON.stringify(makeCLIResponse({ sessionId })),
        stderr: '',
      };
    });

    const result = await getAggregatedSessionStats(sessionIds);

    expect(result.sessions).toHaveLength(sessionIds.length);
    expect(mockExecute).toHaveBeenCalledTimes(sessionIds.length);
    expect(maxInFlight).toBeLessThanOrEqual(4);
  });
});
