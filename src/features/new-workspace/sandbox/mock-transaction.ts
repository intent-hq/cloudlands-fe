import type { WorkspaceDraftPromotionResult, WorkspaceDraftsClient } from '$lib/client';
import type { WorkspaceDraft } from '$shared/types';
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

class MockTransactionDisconnectedError extends Error {
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

export class MockDraftConflictError extends Error {
  readonly rpcCode = -32009;
  readonly data: { current: WorkspaceDraft };

  constructor(current: WorkspaceDraft) {
    super('The workspace draft revision is stale.');
    this.name = 'MockDraftConflictError';
    this.data = { current };
  }
}

export class MockTransactionRejectedError extends Error {
  readonly rpcCode = -32000;

  constructor() {
    super('Sandbox transaction rejected.');
    this.name = 'MockTransactionRejectedError';
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
  readonly workspaceDrafts: WorkspaceDraftsClient;
  private readonly pending = new Map<number, PendingOperation>();
  private readonly appliedAfterAckLoss = new Map<string, unknown>();
  private readonly drafts = new Map<string, WorkspaceDraft>();
  private connected = true;
  private nextCallId = 1;

  constructor(readonly fixtures: ScenarioFixtures = DEFAULT_SCENARIO_FIXTURES) {
    this.drafts.set(fixtures.draft.id, fixtures.draft);
    this.workspaceDrafts = {
      create: (request = {}) =>
        this.immediate(MOCK_TRANSACTION_CHANNELS.draftCreate, [request], fixtures.draft),
      get: (id) => {
        const found = this.drafts.get(id);
        return found
          ? this.immediate(MOCK_TRANSACTION_CHANNELS.draftGet, [{ id }], found)
          : Promise.reject(Object.assign(new Error('Draft not found'), { rpcCode: -32602 }));
      },
      list: () =>
        this.immediate(MOCK_TRANSACTION_CHANNELS.draftList, [{}], [...this.drafts.values()]),
      update: (id, expectedRevision, patch) => this.updateDraft(id, expectedRevision, patch),
      promote: (id, expectedRevision, initialAgent) =>
        this.promoteDraft(id, expectedRevision, initialAgent),
      markDelivery: (id, delivery) => this.markDelivery(id, delivery),
      delete: (id) => this.deleteDraft(id),
    };
  }

  get pendingOperationIds(): number[] {
    return [...this.pending.keys()];
  }

  async runScript(script: readonly ScenarioScriptStep[] = []): Promise<void> {
    await Promise.allSettled(script.map((step) => this.invokeScriptStep(step)));
  }

  invokeScriptStep(step: ScenarioScriptStep): Promise<unknown> {
    const params = step.params ?? {};
    switch (step.channel) {
      case MOCK_TRANSACTION_CHANNELS.draftCreate:
        return this.workspaceDrafts.create(params);
      case MOCK_TRANSACTION_CHANNELS.draftGet:
        return this.workspaceDrafts.get(String(params.id));
      case MOCK_TRANSACTION_CHANNELS.draftList:
        return this.workspaceDrafts.list();
      case MOCK_TRANSACTION_CHANNELS.draftUpdate:
        return this.workspaceDrafts.update(
          String(params.id),
          Number(params.expectedRevision),
          (params.patch ?? {}) as Parameters<WorkspaceDraftsClient['update']>[2],
        );
      case MOCK_TRANSACTION_CHANNELS.draftPromote:
        return this.workspaceDrafts.promote(
          String(params.id),
          Number(params.expectedRevision),
          params.initialAgent as Parameters<WorkspaceDraftsClient['promote']>[2],
        );
      case MOCK_TRANSACTION_CHANNELS.draftMarkDelivery:
        return this.workspaceDrafts.markDelivery(
          String(params.id),
          params.delivery as Parameters<WorkspaceDraftsClient['markDelivery']>[1],
        );
      case MOCK_TRANSACTION_CHANNELS.draftDelete:
        return this.workspaceDrafts.delete(String(params.id));
      case MOCK_TRANSACTION_CHANNELS.hostGit:
        return this.immediate(step.channel, [params], this.fixtures.host.git);
      case MOCK_TRANSACTION_CHANNELS.hostNode:
        return this.immediate(step.channel, [params], this.fixtures.host.node);
      case MOCK_TRANSACTION_CHANNELS.providerProbe:
        return this.immediate(step.channel, [params], this.fixtures.provider);
      case MOCK_TRANSACTION_CHANNELS.workspaceCreate:
        return this.controlled(step.channel, [params], {
          workspace: this.fixtures.workspace,
          initialAgent: this.fixtures.initialAgent,
        });
      case MOCK_TRANSACTION_CHANNELS.clone:
        return this.controlled(step.channel, [params], {
          operationKey: FIXED_IDS.operation,
          phase: 'complete',
        });
      case MOCK_TRANSACTION_CHANNELS.setup:
        return this.controlled(step.channel, [params], this.fixtures.setupResult);
      case MOCK_TRANSACTION_CHANNELS.attachmentPlace:
        return this.controlled(step.channel, [params], this.fixtures.attachmentPlacement);
      case MOCK_TRANSACTION_CHANNELS.send:
        return this.controlled(step.channel, [params], this.fixtures.sendResult);
      default:
        return Promise.reject(new Error(`Unregistered sandbox transaction: ${step.channel}`));
    }
  }

  advance(operationId = this.pendingOperationIds[0]): boolean {
    const operation = this.pending.get(operationId);
    if (!operation) return false;
    this.pending.delete(operationId);
    operation.log.status = 'resolved';
    this.applyResponse(operation.response);
    operation.resolve(operation.response);
    return true;
  }

  reject(
    operationId = this.pendingOperationIds[0],
    reason = new MockTransactionRejectedError(),
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
    this.applyResponse(operation.response);
    operation.reject(new MockTransactionAckLostError());
    this.connected = false;
    return true;
  }

  reconnect(): void {
    this.connected = true;
  }

  dispose(): void {
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

  private async immediate<T>(channel: string, args: readonly unknown[], response: T): Promise<T> {
    try {
      this.assertConnected();
      this.record(channel, args, 'resolved');
      return response;
    } catch (error) {
      return Promise.reject(error);
    }
  }

  private controlled<T>(channel: string, args: readonly unknown[], response: T): Promise<T> {
    try {
      this.assertConnected();
      const signature = stableSignature(channel, args);
      if (this.appliedAfterAckLoss.has(signature)) {
        const replay = this.appliedAfterAckLoss.get(signature) as T;
        this.record(channel, args, 'replayed');
        return Promise.resolve(replay);
      }
      const log = this.record(channel, args, 'pending');
      return new Promise<T>((resolve, reject) => {
        this.pending.set(log.id, {
          log,
          signature,
          response,
          resolve: (value) => resolve(value as T),
          reject,
        });
      });
    } catch (error) {
      return Promise.reject(error);
    }
  }

  private updateDraft(
    id: string,
    expectedRevision: number,
    patch: Parameters<WorkspaceDraftsClient['update']>[2],
  ): Promise<WorkspaceDraft> {
    const current = this.drafts.get(id);
    const args = [{ id, expectedRevision, patch }];
    if (!current) return Promise.reject(new Error('Draft not found'));
    if (current.revision !== expectedRevision) {
      this.record(MOCK_TRANSACTION_CHANNELS.draftUpdate, args, 'rejected');
      return Promise.reject(new MockDraftConflictError(current));
    }
    const { title, ...remainingPatch } = patch;
    const updated: WorkspaceDraft = {
      ...current,
      ...remainingPatch,
      revision: current.revision + 1,
      updatedAt: FIXED_TIMESTAMP,
    };
    if (title === null) delete updated.title;
    else if (title !== undefined) updated.title = title;
    return this.immediate(MOCK_TRANSACTION_CHANNELS.draftUpdate, args, updated).then((result) => {
      this.drafts.set(id, result);
      return result;
    });
  }

  private promoteDraft(
    id: string,
    expectedRevision: number,
    initialAgent?: Parameters<WorkspaceDraftsClient['promote']>[2],
  ): Promise<WorkspaceDraftPromotionResult> {
    const args = [{ id, expectedRevision, ...(initialAgent ? { initialAgent } : {}) }];
    try {
      this.assertConnected();
    } catch (error) {
      return Promise.reject(error);
    }
    const signature = stableSignature(MOCK_TRANSACTION_CHANNELS.draftPromote, args);
    if (this.appliedAfterAckLoss.has(signature)) {
      this.record(MOCK_TRANSACTION_CHANNELS.draftPromote, args, 'replayed');
      return Promise.resolve(
        this.appliedAfterAckLoss.get(signature) as WorkspaceDraftPromotionResult,
      );
    }
    const current = this.drafts.get(id);
    if (!current) return Promise.reject(new Error('Draft not found'));
    if (current.revision !== expectedRevision) {
      this.record(MOCK_TRANSACTION_CHANNELS.draftPromote, args, 'rejected');
      return Promise.reject(new MockDraftConflictError(current));
    }
    const draft: WorkspaceDraft = {
      ...current,
      revision: current.revision + 1,
      phase: 'promoted',
      promotedWorkspaceId: FIXED_IDS.workspace,
      initialAgentId: FIXED_IDS.agent,
      updatedAt: FIXED_TIMESTAMP,
    };
    const result = {
      draft,
      workspace: this.fixtures.workspace,
      initialAgent: this.fixtures.initialAgent,
    } as unknown as WorkspaceDraftPromotionResult;
    return this.controlled(MOCK_TRANSACTION_CHANNELS.draftPromote, args, result);
  }

  private markDelivery(
    id: string,
    delivery: Parameters<WorkspaceDraftsClient['markDelivery']>[1],
  ): Promise<WorkspaceDraft> {
    const current = this.drafts.get(id);
    if (!current) return Promise.reject(new Error('Draft not found'));
    const updated = { ...current, delivery, revision: current.revision + 1 };
    return this.immediate(
      MOCK_TRANSACTION_CHANNELS.draftMarkDelivery,
      [{ id, delivery }],
      updated,
    ).then((result) => {
      this.drafts.set(id, result);
      return result;
    });
  }

  private deleteDraft(id: string): Promise<{ deleted: boolean }> {
    const deleted = this.drafts.has(id);
    return this.immediate(MOCK_TRANSACTION_CHANNELS.draftDelete, [{ id }], { deleted }).then(
      (result) => {
        if (result.deleted) this.drafts.delete(id);
        return result;
      },
    );
  }

  private applyResponse(response: unknown): void {
    if (!response || typeof response !== 'object' || !('draft' in response)) return;
    const draft = (response as { draft?: unknown }).draft;
    if (draft && typeof draft === 'object' && 'id' in draft) {
      this.drafts.set(String(draft.id), draft as WorkspaceDraft);
    }
  }
}

export function createMockTransactionHarness(fixtures?: ScenarioFixtures): MockTransactionHarness {
  return new MockTransactionHarness(fixtures);
}
