/**
 * Concurrency tests for `UnifiedPersistence.renameAgent`.
 *
 * The rename flow must use the same per-agent write lock as `saveAgent` so a
 * rename racing with a concurrent `saveAgent` that appends a new message
 * cannot drop the message and must leave the `.checksum` sidecar matching the
 * final session bytes.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

import { UnifiedPersistence } from '../agent-persistence';
import type { AgentSession } from '$shared/types';
import { AgentStatus } from '$shared/types/agent.types';

describe('UnifiedPersistence.renameAgent', () => {
  let persistence: UnifiedPersistence;
  let testDir: string;

  beforeEach(async () => {
    persistence = UnifiedPersistence.getInstance();
    testDir = path.join(process.cwd(), '.test-persistence-rename');
    persistence.configure({ basePath: testDir });
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  const makeAgent = (id: string): AgentSession =>
    ({
      id: id as any,
      workspaceId: '550e8400-e29b-41d4-a716-446655440000' as any,
      name: 'Initial',
      status: AgentStatus.Active,
      messages: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      backendSessionId: null,
    }) as AgentSession;

  it('patches name + nameExplicitlySet atomically and updates the checksum sidecar', async () => {
    const agent = makeAgent('agent-rename-atomic');
    await persistence.saveAgent(agent, testDir);

    const result = await persistence.renameAgent(
      agent.id as string,
      agent.workspaceId as string,
      'Patched Name',
      { workspacePath: testDir },
    );

    expect(result).toEqual({ ok: true, name: 'Patched Name' });

    const filePath = path.join(testDir, '.workspace/agents', `${agent.id}.json`);
    const bytes = await fs.readFile(filePath, 'utf-8');
    const saved = JSON.parse(bytes);
    expect(saved.name).toBe('Patched Name');
    expect(saved.nameExplicitlySet).toBe(true);

    const checksum = await fs.readFile(`${filePath}.checksum`, 'utf-8');
    expect(checksum).toBe(crypto.createHash('sha256').update(bytes).digest('hex'));
  });

  it('skips the write when nameExplicitlySet is true and skipIfExplicitlySet is set', async () => {
    const agent = makeAgent('agent-rename-skip');
    (agent as any).name = 'User Chosen';
    (agent as any).nameExplicitlySet = true;
    await persistence.saveAgent(agent, testDir);

    const result = await persistence.renameAgent(
      agent.id as string,
      agent.workspaceId as string,
      'Agent Suggested',
      { skipIfExplicitlySet: true, workspacePath: testDir },
    );

    expect(result).toEqual({ ok: true, name: 'User Chosen', skipped: true });

    const filePath = path.join(testDir, '.workspace/agents', `${agent.id}.json`);
    const saved = JSON.parse(await fs.readFile(filePath, 'utf-8'));
    expect(saved.name).toBe('User Chosen');
    expect(saved.nameExplicitlySet).toBe(true);
  });

  it('preserves messages appended by a concurrent saveAgent and keeps checksum consistent', async () => {
    const agent = makeAgent('agent-rename-race');
    await persistence.saveAgent(agent, testDir);

    const appendedMessage = {
      id: 'msg_appended_1',
      role: 'user' as const,
      contentBlocks: [{ type: 'text' as const, text: 'Appended after initial save' }],
      timestamp: new Date().toISOString(),
    };

    const savePromise = persistence.saveAgent(
      { ...agent, messages: [appendedMessage] } as AgentSession,
      testDir,
    );
    const renamePromise = persistence.renameAgent(
      agent.id as string,
      agent.workspaceId as string,
      'Raced Name',
      { workspacePath: testDir },
    );

    const [saveResult, renameResult] = await Promise.all([savePromise, renamePromise]);
    expect(saveResult.success).toBe(true);
    expect(renameResult.ok).toBe(true);

    const filePath = path.join(testDir, '.workspace/agents', `${agent.id}.json`);
    const bytes = await fs.readFile(filePath, 'utf-8');
    const saved = JSON.parse(bytes);

    // Final state must carry both the new name AND the appended message.
    expect(saved.name).toBe('Raced Name');
    expect(saved.nameExplicitlySet).toBe(true);
    const ids: string[] = (saved.messages ?? []).map((m: { id: string }) => m.id);
    expect(ids).toContain('msg_appended_1');

    // Checksum sidecar must match the final bytes on disk.
    const checksum = await fs.readFile(`${filePath}.checksum`, 'utf-8');
    expect(checksum).toBe(crypto.createHash('sha256').update(bytes).digest('hex'));
  });

  it('rejects whitespace-only names before touching disk', async () => {
    await expect(
      persistence.renameAgent('agent-x', 'ws-y', '   ', { workspacePath: testDir }),
    ).rejects.toThrow('name must not be empty or whitespace-only');
  });

  it('returns ok:false when the agent session cannot be loaded', async () => {
    const result = await persistence.renameAgent(
      'agent-missing',
      '550e8400-e29b-41d4-a716-446655440000',
      'Anything',
      { workspacePath: testDir },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('a stale explicit-flag save does not clobber a concurrent later rename', async () => {
    const agent = makeAgent('agent-stale-save-vs-rename');
    const m1 = {
      id: 'msg_seed_1',
      role: 'user' as const,
      contentBlocks: [{ type: 'text' as const, text: 'seed message' }],
      timestamp: new Date().toISOString(),
    };
    const seeded = {
      ...agent,
      name: 'A',
      nameExplicitlySet: true,
      messages: [m1],
    } as AgentSession;
    await persistence.saveAgent(seeded, testDir);

    // In-memory snapshot captured by a caller that already has
    // nameExplicitlySet: true (e.g. right after an earlier rename). The
    // snapshot adds a new message on top of the seeded message.
    const m2 = {
      id: 'msg_appended_2',
      role: 'assistant' as const,
      contentBlocks: [{ type: 'text' as const, text: 'appended during race' }],
      timestamp: new Date().toISOString(),
    };
    const saveSnapshot = {
      ...seeded,
      name: 'A',
      nameExplicitlySet: true,
      messages: [m1, m2],
    } as AgentSession;

    // Fire rename first, then save without awaiting — the save carries the
    // stale explicit flag but must not clobber the rename.
    const renamePromise = persistence.renameAgent(
      agent.id as string,
      agent.workspaceId as string,
      'B',
      { workspacePath: testDir },
    );
    const savePromise = persistence.saveAgent(saveSnapshot, testDir);

    const [renameResult, saveResult] = await Promise.all([renamePromise, savePromise]);
    expect(renameResult.ok).toBe(true);
    expect(saveResult.success).toBe(true);

    const filePath = path.join(testDir, '.workspace/agents', `${agent.id}.json`);
    const bytes = await fs.readFile(filePath, 'utf-8');
    const saved = JSON.parse(bytes);

    expect(saved.name).toBe('B');
    expect(saved.nameExplicitlySet).toBe(true);
    const ids: string[] = (saved.messages ?? []).map((m: { id: string }) => m.id);
    expect(ids).toContain('msg_seed_1');
    expect(ids).toContain('msg_appended_2');

    const checksum = await fs.readFile(`${filePath}.checksum`, 'utf-8');
    expect(checksum).toBe(crypto.createHash('sha256').update(bytes).digest('hex'));
  });

  it('clears writeQueue and writeInProgress after save+save+rename serialise', async () => {
    const agent = makeAgent('agent-lock-cleanup');
    await persistence.saveAgent(agent, testDir);

    const saveA = persistence.saveAgent(
      { ...agent, messages: [
        {
          id: 'msg_a',
          role: 'user' as const,
          contentBlocks: [{ type: 'text' as const, text: 'A' }],
          timestamp: new Date().toISOString(),
        },
      ] } as AgentSession,
      testDir,
    );
    const saveB = persistence.saveAgent(
      { ...agent, messages: [
        {
          id: 'msg_b',
          role: 'user' as const,
          contentBlocks: [{ type: 'text' as const, text: 'B' }],
          timestamp: new Date().toISOString(),
        },
      ] } as AgentSession,
      testDir,
    );
    const renameX = persistence.renameAgent(
      agent.id as string,
      agent.workspaceId as string,
      'X',
      { workspacePath: testDir },
    );

    const [rA, rB, rX] = await Promise.all([saveA, saveB, renameX]);
    expect(rA.success).toBe(true);
    expect(rB.success).toBe(true);
    expect(rX.ok).toBe(true);

    // Lock maps must be clean once every operation has resolved.
    const queue = (persistence as unknown as {
      writeQueue: Map<string, unknown>;
      writeInProgress: Map<string, unknown>;
    });
    expect(queue.writeQueue.has(agent.id as string)).toBe(false);
    expect(queue.writeInProgress.has(agent.id as string)).toBe(false);

    const filePath = path.join(testDir, '.workspace/agents', `${agent.id}.json`);
    const saved = JSON.parse(await fs.readFile(filePath, 'utf-8'));
    expect(saved.name).toBe('X');
    expect(saved.nameExplicitlySet).toBe(true);
  });
});
