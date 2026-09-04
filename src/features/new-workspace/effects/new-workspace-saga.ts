import { all, call, delay, put, select, type SagaGenerator } from 'typed-redux-saga';

import { appClient, type AppClient, type FileBlock, type ImageBlock } from '$lib/client';
import type { ContextItem } from '$lib/components/chat/input/context-api';
import {
  redeemStagedAttachments,
  sendHeldFirstMessage,
} from '$lib/components/workspace/initializer/staged-attachments';
import { backendRequest } from '$lib/client/live/backend-transport';
import { isDaemonErrorResponse } from '$lib/client/live/backend-transport-types';
import { newIdempotencyKey } from '$lib/client/live/live-support';
import { navigateToRoute } from '$lib/utils/navigation.client';
import type { DraftDelivery, WorkspaceDraft } from '$shared/types';
import { bulkUpsertSessions } from '$store/renderer/slices/agent-session/agent-session-slice';
import {
  selectHasCheckedOnce,
  selectProviderStatusMap,
} from '$store/renderer/slices/agent-availability/agent-availability-selectors';
import { bootstrapNewWorkspaceLayout } from '$store/renderer/slices/panel-layout/panel-layout-slice';
import { openWorkspaceTab } from '$store/renderer/slices/tab-state/tab-state-slice';
import { setInitialAgentId } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
import {
  beginWorkspaceCreateProgress,
  clearWorkspaceCreateProgress,
} from '$store/renderer/slices/workspace-create-progress/workspace-create-progress-slice';
import {
  createWorkspaceNavigationState,
  hydrateWorkspaceNavigation,
} from '$store/renderer/slices/workspace-navigation/workspace-navigation-slice';
import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';

import { effectsFor } from '../controller/effects';
import type {
  Capability,
  CapabilityStatus,
  ControllerEffect,
  ControllerEvent,
  ControllerState,
  DraftInput,
  FailureKind,
} from '../controller/types';

const SAVE_DEBOUNCE_MS = 250;
const CONFLICT_CODE = -32009;

type PromotionResult = Awaited<ReturnType<AppClient['workspaceDrafts']['promote']>>;

interface RuntimeState {
  promotionByWorkspace: Map<string, PromotionResult>;
  operationByWorkspace: Map<string, string>;
}

const runtimeByDependencies = new WeakMap<object, RuntimeState>();

export interface NewWorkspaceSagaDependencies {
  client?: AppClient;
  dispatch: (event: ControllerEvent) => void;
  getState: () => ControllerState;
  navigate?: typeof navigateToRoute;
  saveDebounceMs?: number;
}

function runtimeFor(dependencies: NewWorkspaceSagaDependencies): RuntimeState {
  let runtime = runtimeByDependencies.get(dependencies);
  if (!runtime) {
    runtime = { promotionByWorkspace: new Map(), operationByWorkspace: new Map() };
    runtimeByDependencies.set(dependencies, runtime);
  }
  return runtime;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function conflictDraft(error: unknown): WorkspaceDraft | null {
  if (!error || typeof error !== 'object') return null;
  const candidate = error as { rpcCode?: unknown; data?: unknown };
  if (
    candidate.rpcCode !== CONFLICT_CODE ||
    !candidate.data ||
    typeof candidate.data !== 'object'
  ) {
    return null;
  }
  const current = (candidate.data as { current?: unknown }).current;
  return current && typeof current === 'object' ? (current as WorkspaceDraft) : null;
}

function isMissing(error: unknown): boolean {
  return (
    !!error && typeof error === 'object' && (error as { rpcCode?: unknown }).rpcCode === -32602
  );
}

function inputPatch(input: DraftInput): DraftInput {
  return {
    ...(input.title !== undefined ? { title: input.title } : {}),
    intentText: input.intentText,
    source: input.source,
    contextLinks: input.contextLinks,
    attachments: input.attachments,
    config: input.config,
  };
}

function contextItem(value: unknown): value is ContextItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as { id?: unknown; type?: unknown; label?: unknown };
  return (
    typeof item.id === 'string' && typeof item.type === 'string' && typeof item.label === 'string'
  );
}

function pendingAttachmentIds(input: DraftInput): string[] {
  return input.attachments
    .filter(contextItem)
    .filter((item) => item.type === 'file' && !item.attachmentId && !!item.sourcePath)
    .map((item) => item.id);
}

function deliveryBlocks(input: DraftInput): {
  fileBlocks: FileBlock[];
  imageBlocks: ImageBlock[];
  contextReferences: unknown[];
} {
  const items = input.attachments.filter(contextItem);
  const fileBlocks: FileBlock[] = [];
  const imageBlocks: ImageBlock[] = [];
  const contextReferences: unknown[] = [];
  for (const item of items) {
    if (item.imageData && item.imageMimeType) {
      imageBlocks.push({ type: 'image', data: item.imageData, mimeType: item.imageMimeType });
    } else if (item.type === 'file' && item.attachmentId) {
      fileBlocks.push({
        type: 'file',
        attachmentId: item.attachmentId,
        fileName: item.label,
        ...(item.attachmentMimeType ? { mimeType: item.attachmentMimeType } : {}),
        ...(item.attachmentSize !== undefined ? { size: item.attachmentSize } : {}),
      });
    } else if (item.type !== 'file') {
      contextReferences.push(item);
    }
  }
  return { fileBlocks, imageBlocks, contextReferences };
}

function* emit(
  dependencies: NewWorkspaceSagaDependencies,
  event: ControllerEvent,
): SagaGenerator<void> {
  yield* call(dependencies.dispatch, event);
}

function* fail(
  dependencies: NewWorkspaceSagaDependencies,
  generation: number,
  kind: FailureKind,
  error: unknown,
): SagaGenerator<void> {
  if (!isDaemonErrorResponse(error)) {
    yield* emit(dependencies, { type: 'daemon.offline' });
    return;
  }
  yield* emit(dependencies, { type: 'operation.failed', generation, kind, error: message(error) });
}

function* probe(capability: Capability): SagaGenerator<CapabilityStatus> {
  if (capability === 'provider') {
    const [statuses, checked] = yield* all([
      select(selectProviderStatusMap.select),
      select(selectHasCheckedOnce.select),
    ]);
    if (
      Object.values(statuses).some((status) => status.available && status.authenticated !== false)
    ) {
      return 'ready';
    }
    return checked ? 'missing' : 'unknown';
  }
  const method =
    capability === 'git'
      ? 'host.checkGit'
      : capability === 'node'
        ? 'host.checkNode'
        : 'host.checkGh';
  try {
    const result = yield* call(backendRequest<{ available?: boolean }>, method, {});
    return result.available === true ? 'ready' : 'missing';
  } catch {
    return 'unknown';
  }
}

function rememberPromotion(runtime: RuntimeState, result: PromotionResult): void {
  runtime.promotionByWorkspace.set(result.workspace.id, result);
}

function* promote(
  effect: Extract<ControllerEffect, { type: 'promoteDraft' }>,
  dependencies: NewWorkspaceSagaDependencies,
  runtime: RuntimeState,
): SagaGenerator<void> {
  const client = dependencies.client ?? appClient;
  yield* emit(dependencies, { type: 'promote.issued', operationKey: effect.operationKey });
  yield* put(beginWorkspaceCreateProgress(effect.operationKey));
  try {
    const state = dependencies.getState();
    const result = yield* call(
      [client.workspaceDrafts, client.workspaceDrafts.promote],
      effect.draftId,
      effect.expectedRevision,
      {
        prompt: '',
        specialist: 'spec-writer',
        ...(state.input.config.model ? { model: state.input.config.model } : {}),
      },
    );
    rememberPromotion(runtime, result);
    runtime.operationByWorkspace.set(result.workspace.id, effect.operationKey);
    yield* emit(dependencies, {
      type: 'promote.ack',
      generation: effect.generation,
      operationKey: effect.operationKey,
      draft: result.draft,
      workspaceId: result.workspace.id,
      initialAgentId: result.initialAgent?.id,
    });
  } catch (error) {
    const remote = conflictDraft(error);
    if (remote) {
      yield* put(clearWorkspaceCreateProgress(effect.operationKey));
      yield* emit(dependencies, { type: 'draft.conflict', generation: effect.generation, remote });
    } else if (!isDaemonErrorResponse(error)) {
      yield* emit(dependencies, {
        type: 'promote.ackLost',
        generation: effect.generation,
        operationKey: effect.operationKey,
      });
    } else {
      yield* put(clearWorkspaceCreateProgress(effect.operationKey));
      yield* fail(dependencies, effect.generation, 'promote', error);
    }
  }
}

function* reconcilePromotion(
  effect: Extract<ControllerEffect, { type: 'reconcilePromotion' }>,
  dependencies: NewWorkspaceSagaDependencies,
  runtime: RuntimeState,
): SagaGenerator<void> {
  const client = dependencies.client ?? appClient;
  try {
    const draft = yield* call([client.workspaceDrafts, client.workspaceDrafts.get], effect.draftId);
    if (!draft) {
      yield* emit(dependencies, {
        type: 'operation.failed',
        generation: effect.generation,
        kind: 'promote',
        error: 'The draft no longer exists',
      });
      return;
    }
    if (draft.promotedWorkspaceId) {
      runtime.operationByWorkspace.set(draft.promotedWorkspaceId, effect.operationKey);
      yield* emit(dependencies, {
        type: 'draft.promoted',
        generation: effect.generation,
        draftId: draft.id,
        workspaceId: draft.promotedWorkspaceId,
        initialAgentId: draft.initialAgentId,
      });
      return;
    }
    yield* promote(
      {
        type: 'promoteDraft',
        generation: effect.generation,
        draftId: effect.draftId,
        expectedRevision: draft.revision,
        operationKey: effect.operationKey,
      },
      dependencies,
      runtime,
    );
  } catch (error) {
    yield* fail(dependencies, effect.generation, 'promote', error);
  }
}

function* adopt(
  effect: Extract<ControllerEffect, { type: 'adoptWorkspace' }>,
  dependencies: NewWorkspaceSagaDependencies,
  runtime: RuntimeState,
): SagaGenerator<void> {
  const client = dependencies.client ?? appClient;
  try {
    const cached = runtime.promotionByWorkspace.get(effect.workspaceId);
    const workspace =
      cached?.workspace ??
      (yield* call([client.workspaces, client.workspaces.get], effect.workspaceId));
    if (!workspace)
      throw Object.assign(new Error('Promoted workspace was not found'), { rpcCode: -32602 });
    const state = dependencies.getState();
    const initialAgentId = cached?.initialAgent?.id ?? state.initialAgentId ?? undefined;
    const initialAgent =
      cached?.initialAgent ??
      (initialAgentId ? yield* call([client.agents, client.agents.get], initialAgentId) : null);

    yield* put(setWorkspaceEntity(workspace));
    yield* put(setInitialAgentId(workspace.id, initialAgent?.id ?? null));
    if (initialAgent) yield* put(bulkUpsertSessions([initialAgent]));
    yield* put(
      bootstrapNewWorkspaceLayout(
        workspace.id,
        initialAgent?.id ?? null,
        initialAgent?.name ?? '',
        true,
        undefined,
        workspace.contextLinks,
      ),
    );
    yield* put(
      hydrateWorkspaceNavigation(
        workspace.id,
        createWorkspaceNavigationState(workspace.id, {
          mainPanel: { type: 'empty' },
          ui: { hasInitialized: false },
        }),
      ),
    );
    yield* put(openWorkspaceTab(workspace.id));
    yield* call(dependencies.navigate ?? navigateToRoute, `/workspace/${workspace.id}`);
    const operationKey = runtime.operationByWorkspace.get(workspace.id);
    if (operationKey) {
      yield* put(clearWorkspaceCreateProgress(operationKey));
      runtime.operationByWorkspace.delete(workspace.id);
    }

    const pending = pendingAttachmentIds(state.input);
    yield* emit(dependencies, {
      type: 'adoption.completed',
      generation: effect.generation,
      pendingAttachmentIds: pending,
    });
    if (pending.length === 0 && state.input.intentText.trim().length === 0) {
      const draftId = state.draftId;
      if (draftId) yield* call([client.workspaceDrafts, client.workspaceDrafts.delete], draftId);
    }
  } catch (error) {
    yield* fail(dependencies, effect.generation, 'adopt', error);
  }
}

function replaceAttachment(items: unknown[], replacement: ContextItem): unknown[] {
  return items.map((item) =>
    contextItem(item) && item.id === replacement.id ? replacement : item,
  );
}

function* placeAttachments(
  effect: Extract<ControllerEffect, { type: 'placeAttachments' }>,
  dependencies: NewWorkspaceSagaDependencies,
): SagaGenerator<void> {
  const client = dependencies.client ?? appClient;
  const placedIds: string[] = [];
  const failures: Array<{ id: string; error: string }> = [];
  for (const id of effect.attachmentIds) {
    try {
      const draft = yield* call(
        [client.workspaceDrafts, client.workspaceDrafts.get],
        dependencies.getState().draftId ?? '',
      );
      const item = draft?.attachments.find((value) => contextItem(value) && value.id === id);
      if (!draft || !contextItem(item))
        throw new Error(`Attachment ${id} is missing from the draft`);
      const result = yield* call(redeemStagedAttachments, effect.workspaceId, [item]);
      const replacement = result.items[0];
      if (!replacement) throw new Error(`Attachment ${id} produced no placement result`);
      const updated = yield* call(
        [client.workspaceDrafts, client.workspaceDrafts.update],
        draft.id,
        draft.revision,
        { attachments: replaceAttachment(draft.attachments, replacement) },
      );
      yield* emit(dependencies, {
        type: 'draft.updated',
        generation: effect.generation,
        draft: updated,
      });
      if (result.failedCount > 0) {
        failures.push({
          id,
          error: replacement.placementError ?? `Attachment ${id} could not be placed`,
        });
      } else {
        placedIds.push(id);
      }
    } catch (error) {
      failures.push({ id, error: message(error) });
    }
  }
  yield* emit(dependencies, {
    type: 'attachments.placed',
    generation: effect.generation,
    placedIds,
    failures,
  });
}

function transcriptContains(
  messages: Array<{ id: string; appMessageId?: string }>,
  id: string,
): boolean {
  return messages.some((entry) => entry.id === id || entry.appMessageId === id);
}

function* deliver(
  effect: Extract<ControllerEffect, { type: 'sendFirstMessage' }>,
  dependencies: NewWorkspaceSagaDependencies,
  existingMessageId?: string,
  issueEvent = true,
): SagaGenerator<void> {
  const client = dependencies.client ?? appClient;
  const messageId = existingMessageId ?? newIdempotencyKey();
  try {
    if (issueEvent) yield* emit(dependencies, { type: 'send.issued' });
    const pendingDelivery: DraftDelivery = { state: 'pending', messageId };
    yield* call([client.workspaceDrafts, client.workspaceDrafts.markDelivery], effect.draftId, {
      ...pendingDelivery,
    } as DraftDelivery);
    const blocks = deliveryBlocks(effect.input);
    const result = yield* call(
      sendHeldFirstMessage,
      {
        workspaceId: effect.workspaceId,
        agentId: effect.initialAgentId ?? undefined,
        messageId,
        content: effect.input.intentText,
        imageBlocks: blocks.imageBlocks,
        contextReferences: blocks.contextReferences,
      },
      blocks.fileBlocks,
    );
    if (!result.sent) {
      if (result.deliveryUnknown) {
        const unknownDelivery: DraftDelivery = {
          state: 'unknown',
          messageId,
          ...(result.errorDetail ? { error: result.errorDetail } : {}),
        };
        yield* call([client.workspaceDrafts, client.workspaceDrafts.markDelivery], effect.draftId, {
          ...unknownDelivery,
        } as DraftDelivery);
        yield* emit(dependencies, { type: 'send.unknown', generation: effect.generation });
      } else {
        yield* emit(dependencies, {
          type: 'operation.failed',
          generation: effect.generation,
          kind: 'send',
          error: result.errorDetail ?? 'The first message was rejected',
        });
      }
      return;
    }
    const sentDelivery: DraftDelivery = { state: 'sent', messageId };
    yield* call(
      [client.workspaceDrafts, client.workspaceDrafts.markDelivery],
      effect.draftId,
      sentDelivery,
    );
    yield* call([client.workspaceDrafts, client.workspaceDrafts.delete], effect.draftId);
    yield* emit(dependencies, { type: 'send.ack', generation: effect.generation, messageId });
  } catch (error) {
    yield* fail(dependencies, effect.generation, 'send', error);
  }
}

function* reconcileDelivery(
  effect: Extract<ControllerEffect, { type: 'reconcileDelivery' }>,
  dependencies: NewWorkspaceSagaDependencies,
): SagaGenerator<void> {
  const client = dependencies.client ?? appClient;
  yield* emit(dependencies, { type: 'delivery.reconcileIssued' });
  try {
    const draft = yield* call([client.workspaceDrafts, client.workspaceDrafts.get], effect.draftId);
    if (!draft) return;
    if (draft.delivery.state === 'sent') {
      yield* emit(dependencies, {
        type: 'delivery.reconciled',
        generation: effect.generation,
        delivery: draft.delivery,
      });
      return;
    }
    const state = dependencies.getState();
    const messageId = draft.delivery.messageId;
    if (messageId && state.initialAgentId) {
      const page = yield* call(
        [client.agents, client.agents.getConversation],
        state.initialAgentId,
        200,
      );
      if (transcriptContains(page.messages, messageId)) {
        const sentDelivery: DraftDelivery = { state: 'sent', messageId };
        yield* call([client.workspaceDrafts, client.workspaceDrafts.markDelivery], effect.draftId, {
          ...sentDelivery,
        } as DraftDelivery);
        yield* call([client.workspaceDrafts, client.workspaceDrafts.delete], effect.draftId);
        yield* emit(dependencies, { type: 'send.ack', generation: effect.generation, messageId });
        return;
      }
    }
    if (state.phase === 'sending') {
      yield* deliver(
        {
          type: 'sendFirstMessage',
          generation: effect.generation,
          draftId: effect.draftId,
          workspaceId: state.workspaceId,
          initialAgentId: state.initialAgentId,
          input: state.input,
        },
        dependencies,
        messageId,
        false,
      );
    }
  } catch (error) {
    yield* fail(dependencies, effect.generation, 'send', error);
  }
}

function* execute(
  effect: ControllerEffect,
  dependencies: NewWorkspaceSagaDependencies,
  runtime: RuntimeState,
): SagaGenerator<void> {
  const client = dependencies.client ?? appClient;
  switch (effect.type) {
    case 'identifyBackend':
      try {
        yield* call([client.workspaceDrafts, client.workspaceDrafts.list]);
        const draftId = dependencies.getState().draftId ?? undefined;
        yield* emit(dependencies, {
          type: 'backend.connected',
          generation: effect.generation,
          draftId,
        });
      } catch (error) {
        yield* fail(dependencies, effect.generation, 'restore', error);
      }
      return;
    case 'restoreDraft':
      try {
        const draft = yield* call(
          [client.workspaceDrafts, client.workspaceDrafts.get],
          effect.draftId,
        );
        yield* emit(
          dependencies,
          draft
            ? { type: 'restore.succeeded', generation: effect.generation, draft }
            : { type: 'restore.missing', generation: effect.generation },
        );
      } catch (error) {
        if (isMissing(error)) {
          yield* emit(dependencies, { type: 'restore.missing', generation: effect.generation });
        } else {
          yield* fail(dependencies, effect.generation, 'restore', error);
        }
      }
      return;
    case 'createDraft':
      yield* emit(dependencies, { type: 'draft.createIssued', inputVersion: effect.inputVersion });
      try {
        const draft = yield* call(
          [client.workspaceDrafts, client.workspaceDrafts.create],
          inputPatch(effect.input),
        );
        yield* emit(dependencies, {
          type: 'draft.acknowledged',
          generation: effect.generation,
          inputVersion: effect.inputVersion,
          draft,
        });
      } catch (error) {
        yield* fail(dependencies, effect.generation, 'draft', error);
      }
      return;
    case 'updateDraft':
      yield* delay(dependencies.saveDebounceMs ?? SAVE_DEBOUNCE_MS);
      yield* emit(dependencies, { type: 'draft.saveIssued', inputVersion: effect.inputVersion });
      try {
        const draft = yield* call(
          [client.workspaceDrafts, client.workspaceDrafts.update],
          effect.draftId,
          effect.expectedRevision,
          inputPatch(effect.input),
        );
        yield* emit(dependencies, {
          type: 'draft.acknowledged',
          generation: effect.generation,
          inputVersion: effect.inputVersion,
          draft,
        });
      } catch (error) {
        const remote = conflictDraft(error);
        if (remote)
          yield* emit(dependencies, {
            type: 'draft.conflict',
            generation: effect.generation,
            remote,
          });
        else yield* fail(dependencies, effect.generation, 'draft', error);
      }
      return;
    case 'probeCapability':
      yield* emit(dependencies, {
        type: 'capability.result',
        generation: effect.generation,
        capability: effect.capability,
        status: yield* probe(effect.capability),
      });
      return;
    case 'promoteDraft':
      return yield* promote(effect, dependencies, runtime);
    case 'reconcilePromotion':
      return yield* reconcilePromotion(effect, dependencies, runtime);
    case 'adoptWorkspace':
      return yield* adopt(effect, dependencies, runtime);
    case 'placeAttachments':
      return yield* placeAttachments(effect, dependencies);
    case 'reconcileDelivery':
      return yield* reconcileDelivery(effect, dependencies);
    case 'sendFirstMessage':
      return yield* deliver(effect, dependencies);
  }
}

/** Execute the pure controller's current effect set through saga-owned side effects. */
export function* newWorkspaceEffectSaga(
  state: ControllerState,
  dependencies: NewWorkspaceSagaDependencies,
): SagaGenerator<void> {
  const runtime = runtimeFor(dependencies);
  yield* all(effectsFor(state).map((effect) => call(execute, effect, dependencies, runtime)));
}
