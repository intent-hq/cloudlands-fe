import { describe, expect, it, vi } from 'vitest';
import { importSession, listImportableSessions } from './importable-sessions.client';

const row = (sessionId: string, updatedAt: string | null) => ({
  provider: 'claude-code',
  sessionId,
  title: `Session ${sessionId}`,
  cwd: '/repo',
  updatedAt,
});

describe('listImportableSessions', () => {
  it('sends the params and keeps the daemon order, undated sessions included', async () => {
    const request = vi.fn().mockResolvedValue({
      sessions: [
        row('new', '2026-02-01T00:00:00Z'),
        row('old', '2026-01-01T00:00:00Z'),
        row('undated', null),
        {},
      ],
      providers: [
        { id: 'claude-code', label: 'Claude Code', status: 'ok' },
        { id: 'codex', label: 'Codex', status: 'error', error: 'timed out' },
        { id: 'bad' },
      ],
      nextCursor: 'c2',
    });
    const result = await listImportableSessions({ query: 'cl', limit: 50 }, request);
    expect(request).toHaveBeenCalledWith('agent.importableSessions.list', {
      query: 'cl',
      limit: 50,
    });
    expect(result).toEqual({
      ok: true,
      sessions: [
        row('new', '2026-02-01T00:00:00Z'),
        row('old', '2026-01-01T00:00:00Z'),
        row('undated', null),
      ],
      providers: [
        { id: 'claude-code', label: 'Claude Code', status: 'ok' },
        { id: 'codex', label: 'Codex', status: 'error', error: 'timed out' },
      ],
      nextCursor: 'c2',
    });
  });

  it('reports a failed request as an error result', async () => {
    const request = vi.fn().mockRejectedValue(new Error('boom'));
    expect(await listImportableSessions({}, request)).toEqual({
      ok: false,
      error: 'boom',
    });
  });
});

describe('importSession', () => {
  it('returns the created agent and treats an absent forked flag as forked', async () => {
    const request = vi.fn().mockResolvedValue({ agent: { id: 'agent-1', name: 'Imported' } });
    const params = { workspaceId: 'ws-1', provider: 'claude-code', sessionId: 's-1' };
    await expect(importSession(params, request)).resolves.toEqual({
      agent: { id: 'agent-1', name: 'Imported' },
      forked: true,
    });
    expect(request).toHaveBeenCalledWith('agent.importSession', params);
  });

  it('reports a load-only import as not forked', async () => {
    const request = vi.fn().mockResolvedValue({ agent: { id: 'agent-1' }, forked: false });
    await expect(
      importSession({ workspaceId: 'w', provider: 'codex', sessionId: 's' }, request),
    ).resolves.toMatchObject({ forked: false });
  });

  it('throws when the reply has no agent', async () => {
    const request = vi.fn().mockResolvedValue({});
    await expect(
      importSession({ workspaceId: 'w', provider: 'claude-code', sessionId: 's' }, request),
    ).rejects.toThrow('returned no agent');
  });
});
