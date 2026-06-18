/**
 * Tests that the single disk-write funnel (performAtomicWrite, reached through
 * saveAgent) strips transient streaming/processing flags so a crash mid-stream
 * can never persist a phantom "responding" state — while genuinely-streaming
 * sessions keep their flags and Active status.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import { UnifiedPersistence } from '../agent-persistence';
import type { AgentSession } from '$shared/types';
import { AgentStatus } from '$shared/types/agent.types';

const WORKSPACE_ID = '550e8400-e29b-41d4-a716-446655440000';

function readSaved(testDir: string, agentId: string) {
  return fs
    .readFile(path.join(testDir, '.workspace/agents', `${agentId}.json`), 'utf-8')
    .then((raw) => JSON.parse(raw));
}

describe('UnifiedPersistence — transient streaming flag stripping', () => {
  let persistence: UnifiedPersistence;
  let testDir: string;

  beforeEach(async () => {
    persistence = UnifiedPersistence.getInstance();
    testDir = path.join(process.cwd(), '.test-persistence-streaming');
    persistence.configure({ basePath: testDir });
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    persistence.invalidateAllLoadCaches();
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('writes flags false and status Idle when no message is genuinely streaming', async () => {
    const agent: AgentSession = {
      id: 'agent-phantom-stream' as any,
      workspaceId: WORKSPACE_ID as any,
      name: 'Test Agent',
      status: AgentStatus.Active,
      isStreaming: true,
      isProcessing: true,
      isResponding: true,
      messages: [
        {
          id: '550e8400-e29b-41d4-a716-446655440011',
          role: 'assistant',
          contentBlocks: [{ type: 'text', text: 'Partial answer' }],
          timestamp: '2026-05-04T10:00:00.000Z',
        },
      ] as any[],
      createdAt: new Date(),
      updatedAt: new Date(),
      backendSessionId: null,
    } as any;

    const result = await persistence.saveAgent(agent, testDir);
    expect(result.success).toBe(true);

    const saved = await readSaved(testDir, String(agent.id));
    expect(saved.isStreaming).toBe(false);
    expect(saved.isProcessing).toBe(false);
    expect(saved.isResponding).toBe(false);
    expect(saved.status).toBe(AgentStatus.Idle);
  });

  it('preserves flags and Active status when a message is genuinely streaming', async () => {
    const agent: AgentSession = {
      id: 'agent-live-stream' as any,
      workspaceId: WORKSPACE_ID as any,
      name: 'Test Agent',
      status: AgentStatus.Active,
      isStreaming: true,
      isProcessing: true,
      isResponding: true,
      messages: [
        {
          id: '550e8400-e29b-41d4-a716-446655440022',
          role: 'assistant',
          contentBlocks: [{ type: 'text', text: 'Streaming…' }],
          timestamp: '2026-05-04T10:00:00.000Z',
          isStreaming: true,
        },
      ] as any[],
      createdAt: new Date(),
      updatedAt: new Date(),
      backendSessionId: null,
    } as any;

    const result = await persistence.saveAgent(agent, testDir);
    expect(result.success).toBe(true);

    const saved = await readSaved(testDir, String(agent.id));
    expect(saved.isStreaming).toBe(true);
    expect(saved.isProcessing).toBe(true);
    expect(saved.isResponding).toBe(true);
    expect(saved.status).toBe(AgentStatus.Active);
  });

  it('does not mutate the caller session object', async () => {
    const agent: AgentSession = {
      id: 'agent-no-mutate' as any,
      workspaceId: WORKSPACE_ID as any,
      name: 'Test Agent',
      status: AgentStatus.Active,
      isStreaming: true,
      isProcessing: true,
      isResponding: true,
      messages: [
        {
          id: '550e8400-e29b-41d4-a716-446655440033',
          role: 'assistant',
          contentBlocks: [{ type: 'text', text: 'Partial' }],
          timestamp: '2026-05-04T10:00:00.000Z',
        },
      ] as any[],
      createdAt: new Date(),
      updatedAt: new Date(),
      backendSessionId: null,
    } as any;

    await persistence.saveAgent(agent, testDir);

    expect(agent.isStreaming).toBe(true);
    expect(agent.isProcessing).toBe(true);
    expect(agent.isResponding).toBe(true);
    expect(agent.status).toBe(AgentStatus.Active);
  });
});

