import {
  mockInvoke,
  registerMockIpcHandler,
  unregisterMockIpcHandler,
} from '$shared/ipc-mock-router';
import {
  DEFAULT_SCENARIO_FIXTURES,
  FIXED_IDS,
  FIXED_TIMESTAMP,
  type ScenarioFixtures,
  type ScenarioScriptStep,
} from './scenarios';

export const MOCK_TRANSACTION_CHANNELS = {
  draftCreate: 'workspaceDraft.create',
  draftGet: 'workspaceDraft.get',
  draftList: 'workspaceDraft.list',
  draftUpdate: 'workspaceDraft.update',
  draftPromote: 'workspaceDraft.promote',
  draftMarkDelivery: 'workspaceDraft.markDelivery',
  draftDelete: 'workspaceDraft.delete',
  hostGit: 'host.checkGit',
  hostNode: 'host.checkNode',
  providerProbe: 'provider.probe',
  workspaceCreate: 'workspace.create',
  clone: `git:clone:${FIXED_IDS.operation}`,
  setup: `workspace:setup:${FIXED_IDS.workspace}`,
  attachmentPlace: 'attachment.place',
  send: 'agent.sendMessage',
} as const;

export type MockCallStatus = 'pending' | 'resolved' | 'rejected' | 'ack-lost' | 'replayed';

export interface MockCallLogEntry {
  id: number;
  channel: string;
  args: readonly unknown[];
  at: string;
  status: MockCallStatus;
}

interface PendingOperation {
  log: MockCallLogEntry;
  signature: string;
  response: unknown;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

export class MockTransactionDisconnectedError extends Error {
  constructor() {
    super('Sandbox transaction is disconnected.');
    this.name = 'MockTransactionDisconnectedError';
  }
}

export class MockTransactionAckLostError extends Error {
  constructor() {
    super('The operation completed, but its acknowledgement was lost.');
    this.name = 'MockTransactionAckLostError';
  }
}

function stableSignature(channel: string, args: readonly unknown[]): string {
  return `${channel}:${JSON.stringify(args)}`;
}

function timestampFor(index: number): string {
  return new Date(Date.parse(FIXED_TIMESTAMP) + index).toISOString();
}

export class MockTransactionHarness {
  readonly callLog: MockCallLogEntry[] = [];
  readonly invariantFailures: string[] = [];
  private readonly pending = new Map<number, PendingOperation>();
  private readonly appliedAfterAckLoss = new Map<string, unknown>();
  private connected = true;
  private nextCallId = 1;

  constructor(readonly fixtures: ScenarioFixtures = DEFAULT_SCENARIO_FIXTURES) {
    this.registerHandlers();
  }

  get pendingOperationIds(): number[] {
    return [...this.pending.keys()];
  }

  async runScript(script: readonly ScenarioScriptStep[] = []): Promise<void> {
    await Promise.allSettled(script.map((step) => mockInvoke(step.channel, step.params ?? {})));
  }

  advance(operationId = this.pendingOperationIds[0]): boolean {
    const operation = this.pending.get(operationId);
    if (!operation) return false;
    this.pending.delete(operationId);
    operation.log.status = 'resolved';
    operation.resolve(operation.response);
    return true;
  }

  reject(
    operationId = this.pendingOperationIds[0],
    reason = new Error('Sandbox rejection'),
  ): boolean {
    const operation = this.pending.get(operationId);
    if (!operation) return false;
    this.pending.delete(operationId);
    operation.log.status = 'rejected';
    operation.reject(reason);
    return true;
  }

  loseAck(operationId = this.pendingOperationIds[0]): boolean {
    const operation = this.pending.get(operationId);
    if (!operation) return false;
    this.pending.delete(operationId);
    this.appliedAfterAckLoss.set(operation.signature, operation.response);
    operation.log.status = 'ack-lost';
    operation.reject(new MockTransactionAckLostError());
    this.connected = false;
    return true;
  }

  reconnect(): void {
    this.connected = true;
  }

  dispose(): void {
    for (const channel of Object.values(MOCK_TRANSACTION_CHANNELS)) {
      unregisterMockIpcHandler(channel);
    }
    for (const operation of this.pending.values())
      operation.reject(new MockTransactionDisconnectedError());
    this.pending.clear();
  }

  private record(
    channel: string,
    args: readonly unknown[],
    status: MockCallStatus,
  ): MockCallLogEntry {
    const entry: MockCallLogEntry = {
      id: this.nextCallId,
      channel,
      args,
      at: timestampFor(this.nextCallId),
      status,
    };
    this.nextCallId += 1;
    this.callLog.push(entry);
    return entry;
  }

  private assertConnected(): void {
    if (!this.connected) throw new MockTransactionDisconnectedError();
  }

  private immediate(channel: string, response: unknown): void {
    registerMockIpcHandler(channel, async (...args) => {
      this.assertConnected();
      const log = this.record(channel, args, 'resolved');
      log.status = 'resolved';
      return response;
    });
  }

  private controlled(channel: string, response: unknown): void {
    registerMockIpcHandler(channel, (...args) => {
      this.assertConnected();
      const signature = stableSignature(channel, args);
      if (this.appliedAfterAckLoss.has(signature)) {
        const replay = this.appliedAfterAckLoss.get(signature);
        this.record(channel, args, 'replayed');
        return replay;
      }
      const log = this.record(channel, args, 'pending');
      return new Promise((resolve, reject) => {
        this.pending.set(log.id, { log, signature, response, resolve, reject });
      });
    });
  }

  private registerHandlers(): void {
    const promotedDraft = {
      ...this.fixtures.draft,
      revision: this.fixtures.draft.revision + 1,
      phase: 'promoted',
      promotedWorkspaceId: FIXED_IDS.workspace,
      initialAgentId: FIXED_IDS.agent,
      updatedAt: FIXED_TIMESTAMP,
    };
    this.immediate(MOCK_TRANSACTION_CHANNELS.draftCreate, this.fixtures.draft);
    this.immediate(MOCK_TRANSACTION_CHANNELS.draftGet, this.fixtures.draft);
    this.immediate(MOCK_TRANSACTION_CHANNELS.draftList, [this.fixtures.draft]);
    this.immediate(MOCK_TRANSACTION_CHANNELS.draftUpdate, {
      ...this.fixtures.draft,
      revision: this.fixtures.draft.revision + 1,
    });
    this.controlled(MOCK_TRANSACTION_CHANNELS.draftPromote, {
      draft: promotedDraft,
      workspace: this.fixtures.workspace,
      initialAgent: this.fixtures.initialAgent,
    });
    this.immediate(MOCK_TRANSACTION_CHANNELS.draftMarkDelivery, promotedDraft);
    this.immediate(MOCK_TRANSACTION_CHANNELS.draftDelete, { deleted: true });
    this.immediate(MOCK_TRANSACTION_CHANNELS.hostGit, this.fixtures.host.git);
    this.immediate(MOCK_TRANSACTION_CHANNELS.hostNode, this.fixtures.host.node);
    this.immediate(MOCK_TRANSACTION_CHANNELS.providerProbe, this.fixtures.provider);
    this.controlled(MOCK_TRANSACTION_CHANNELS.workspaceCreate, {
      workspace: this.fixtures.workspace,
      initialAgent: this.fixtures.initialAgent,
    });
    this.controlled(MOCK_TRANSACTION_CHANNELS.clone, {
      operationKey: FIXED_IDS.operation,
      phase: 'complete',
    });
    this.controlled(MOCK_TRANSACTION_CHANNELS.setup, {
      workspaceId: FIXED_IDS.workspace,
      state: 'succeeded',
      exitCode: 0,
      startedAt: FIXED_TIMESTAMP,
      finishedAt: FIXED_TIMESTAMP,
    });
    this.controlled(MOCK_TRANSACTION_CHANNELS.attachmentPlace, this.fixtures.attachmentPlacement);
    this.controlled(MOCK_TRANSACTION_CHANNELS.send, this.fixtures.sendResult);
  }
}

export function createMockTransactionHarness(fixtures?: ScenarioFixtures): MockTransactionHarness {
  return new MockTransactionHarness(fixtures);
}
