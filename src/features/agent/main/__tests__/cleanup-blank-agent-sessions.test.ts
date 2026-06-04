// @vitest-environment node

import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const state = { rootDir: '' };
  return {
    state,
    agentsPath: vi.fn((workspaceId: string) => `${state.rootDir}/${workspaceId}/.workspace/agents`),
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    workspaceService: {
      listAllWorkspaces: vi.fn(),
    },
    unifiedPersistence: {
      listAgents: vi.fn(),
      deleteAgent: vi.fn(),
    },
  };
});

vi.mock('$shared/logger', () => ({
  Logger: vi.fn(function MockLogger() {
    return mocks.logger;
  }),
}));

vi.mock('$shared/main/config', () => ({
  WorkspaceConfig: {
    paths: {
      agents: mocks.agentsPath,
    },
  },
}));

vi.mock('../../../workspace/main/workspace.service', () => ({
  workspaceService: mocks.workspaceService,
}));

vi.mock('../agent-persistence', () => ({
  unifiedPersistence: mocks.unifiedPersistence,
}));

import { cleanupBlankAgentSessions } from '../cleanup-blank-agent-sessions';

const STALE_MS = 2 * 60 * 1000;
const RECENT_MS = 10 * 1000;

async function writeAgentFile(
  workspaceId: string,
  agentId: string,
  content: string,
  ageMs: number,
): Promise<string> {
  const agentsDir = mocks.agentsPath(workspaceId);
  await fs.mkdir(agentsDir, { recursive: true });
  const agentPath = path.join(agentsDir, `${agentId}.json`);
  await fs.writeFile(agentPath, content, 'utf-8');
  const mtime = new Date(Date.now() - ageMs);
  await fs.utimes(agentPath, mtime, mtime);
  return agentPath;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

describe('cleanupBlankAgentSessions', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.state.rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'blank-agent-cleanup-'));
    mocks.workspaceService.listAllWorkspaces.mockResolvedValue({ ok: true, data: [] });
    mocks.unifiedPersistence.listAgents.mockResolvedValue([]);
    mocks.unifiedPersistence.deleteAgent.mockResolvedValue({ success: true });
  });

  afterEach(async () => {
    await fs.rm(mocks.state.rootDir, { recursive: true, force: true });
  });

  it('removes stale blank agent session files and leaves non-blank, corrupted, and recent files', async () => {
    const workspaceId = 'workspace-one';
    const blankOne = 'agent-11111111-1111-4111-8111-111111111111';
    const blankTwo = 'agent-22222222-2222-4222-8222-222222222222';
    const nonBlank = 'agent-33333333-3333-4333-8333-333333333333';
    const corrupted = 'agent-44444444-4444-4444-8444-444444444444';
    const recentBlank = 'agent-55555555-5555-4555-8555-555555555555';

    const blankOnePath = await writeAgentFile(workspaceId, blankOne, '{"messages":[]}', STALE_MS);
    const blankTwoPath = await writeAgentFile(workspaceId, blankTwo, '{"messages":[]}', STALE_MS);
    const nonBlankPath = await writeAgentFile(
      workspaceId,
      nonBlank,
      '{"messages":[{"role":"user","content":"hello"}]}',
      STALE_MS,
    );
    const corruptedPath = await writeAgentFile(workspaceId, corrupted, '{bad json', STALE_MS);
    const recentBlankPath = await writeAgentFile(
      workspaceId,
      recentBlank,
      '{"messages":[]}',
      RECENT_MS,
    );

    mocks.workspaceService.listAllWorkspaces.mockResolvedValue({
      ok: true,
      data: [{ id: workspaceId }],
    });
    mocks.unifiedPersistence.listAgents.mockResolvedValue([
      blankOne,
      blankTwo,
      nonBlank,
      corrupted,
      recentBlank,
    ]);
    mocks.unifiedPersistence.deleteAgent.mockImplementation(async (agentId: string) => {
      await fs.rm(path.join(mocks.agentsPath(workspaceId), `${agentId}.json`), { force: true });
      return { success: true };
    });

    await expect(cleanupBlankAgentSessions()).resolves.toEqual({
      scanned: 5,
      removed: 2,
      errors: 0,
    });

    expect(mocks.unifiedPersistence.deleteAgent).toHaveBeenCalledTimes(2);
    expect(mocks.unifiedPersistence.deleteAgent.mock.calls).toEqual(
      expect.arrayContaining([
        [blankOne, workspaceId],
        [blankTwo, workspaceId],
      ]),
    );
    await expect(exists(blankOnePath)).resolves.toBe(false);
    await expect(exists(blankTwoPath)).resolves.toBe(false);
    await expect(exists(nonBlankPath)).resolves.toBe(true);
    await expect(exists(corruptedPath)).resolves.toBe(true);
    await expect(exists(recentBlankPath)).resolves.toBe(true);
    expect(mocks.logger.info).toHaveBeenCalledWith(
      'Cleaned up blank agent session files on startup',
      { scanned: 5, removed: 2, errors: 0 },
    );
  });

  it('returns zeros for an empty workspace list', async () => {
    mocks.workspaceService.listAllWorkspaces.mockResolvedValue({ ok: true, data: [] });

    await expect(cleanupBlankAgentSessions()).resolves.toEqual({
      scanned: 0,
      removed: 0,
      errors: 0,
    });

    expect(mocks.unifiedPersistence.listAgents).not.toHaveBeenCalled();
    expect(mocks.logger.info).not.toHaveBeenCalled();
  });

  it('returns zeros and logs a warning when listAllWorkspaces fails', async () => {
    mocks.workspaceService.listAllWorkspaces.mockResolvedValue({ ok: false, error: 'boom' });

    await expect(cleanupBlankAgentSessions()).resolves.toEqual({
      scanned: 0,
      removed: 0,
      errors: 0,
    });

    expect(mocks.logger.warn).toHaveBeenCalledWith(
      'Failed to list workspaces for blank agent session cleanup',
      { error: 'boom' },
    );
    expect(mocks.unifiedPersistence.listAgents).not.toHaveBeenCalled();
  });

  it('uses unifiedPersistence.deleteAgent rather than unlinking directly', async () => {
    const workspaceId = 'workspace-two';
    const agentId = 'agent-66666666-6666-4666-8666-666666666666';
    const agentPath = await writeAgentFile(workspaceId, agentId, '{"messages":[]}', STALE_MS);
    const unlinkSpy = vi.spyOn(fs, 'unlink');

    mocks.workspaceService.listAllWorkspaces.mockResolvedValue({
      ok: true,
      data: [{ id: workspaceId }],
    });
    mocks.unifiedPersistence.listAgents.mockResolvedValue([agentId]);
    mocks.unifiedPersistence.deleteAgent.mockResolvedValue({ success: true });

    await expect(cleanupBlankAgentSessions()).resolves.toEqual({
      scanned: 1,
      removed: 1,
      errors: 0,
    });

    expect(mocks.unifiedPersistence.deleteAgent).toHaveBeenCalledWith(agentId, workspaceId);
    expect(unlinkSpy).not.toHaveBeenCalled();
    await expect(exists(agentPath)).resolves.toBe(true);
    unlinkSpy.mockRestore();
  });
});
