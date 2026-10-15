import { call, cancelled, fork, join, put, takeEvery, type SagaGenerator } from 'typed-redux-saga';
import type { ComposerContextItem } from '../../transient-ui/transient-ui-types';
import { setComposerContextItems } from '../../transient-ui/transient-ui-slice';
import { chatDraftSaveScheduled } from '../chat-drafts-slice';
import {
  composerAttachmentsSelected,
  composerAttachmentRemoved,
  composerAttachmentRetryRequested,
  composerAttachmentsReleased,
} from '../chat-drafts-slice';
import { serializeDraftAttachments } from '$lib/components/chat/chat-draft-attachments';
import { getCachedDraft } from '$lib/components/chat/chat-draft-cache';
import { m } from '$shared/paraglide/messages.js';
import type { createChatDraftOwnership } from '../../../../../features/agent/chat-draft-ownership';
type CaptureOwnership = ReturnType<typeof createChatDraftOwnership>;

type EffectReader<A extends unknown[], R> = { effect(...args: A): SagaGenerator<R> };
type Resource = {
  file: File;
  workspaceId: string;
  agentId: string;
  isCurrent: ReturnType<CaptureOwnership>;
  aborter?: AbortController;
};
type Placement = {
  attachmentId: string;
  fileName: string;
  path: string;
  size: number;
  mimeType?: string;
};

/** Browser File leases belong to this saga; only canonical ContextItem metadata reaches Redux. */
export function createComposerAttachmentsSaga({
  selectItems,
  selectText,
  captureOwnership,
  place,
}: {
  selectItems: EffectReader<[string, string], ComposerContextItem[]>;
  selectText: EffectReader<[string, string], string>;
  captureOwnership: CaptureOwnership;
  place: (
    workspaceId: string,
    file: File,
    options: {
      idempotencyKey: string;
      signal: AbortSignal;
      current: () => boolean;
      onProgress: (fraction: number) => void;
    },
  ) => Promise<Placement>;
}) {
  return function* composerAttachmentsSaga(): SagaGenerator<void> {
    const owners = new Map<string, Map<string, Resource>>();

    function* persist(ownerId: string, workspaceId: string, agentId: string): SagaGenerator<void> {
      const items = yield* selectItems.effect(workspaceId, agentId);
      const text = yield* selectText.effect(workspaceId, agentId);
      yield* put(
        chatDraftSaveScheduled(ownerId, crypto.randomUUID(), {
          workspaceId,
          agentId,
          text,
          attachments: serializeDraftAttachments(items),
          rollback: getCachedDraft(workspaceId, agentId) ?? null,
        }),
      );
    }

    function* patch(
      resource: Resource,
      id: string,
      changes: Partial<ComposerContextItem>,
      localFailure = false,
    ): SagaGenerator<boolean> {
      if (!localFailure && !resource.isCurrent.sameAuthority()) return false;
      const items = yield* selectItems.effect(resource.workspaceId, resource.agentId);
      if (!items.some((item) => item.id === id)) return false;
      yield* put(
        setComposerContextItems(
          resource.workspaceId,
          resource.agentId,
          items.map((item) => (item.id === id ? { ...item, ...changes } : item)),
          true,
        ),
      );
      return true;
    }

    function* upload(ownerId: string, id: string, resource: Resource): SagaGenerator<void> {
      const controller = new AbortController();
      resource.aborter = controller;
      const isCurrent = resource.isCurrent;
      const ownsResource = () =>
        !controller.signal.aborted && owners.get(ownerId)?.get(id) === resource;
      const current = () => ownsResource() && isCurrent();
      try {
        if (!current()) return;
        const items = yield* selectItems.effect(resource.workspaceId, resource.agentId);
        const item = items.find((item) => item.id === id);
        if (!item) return;
        const idempotencyKey = item.placementIdempotencyKey ?? crypto.randomUUID();
        yield* patch(resource, id, {
          placementStatus: 'placing',
          placementError: undefined,
          placementProgress: undefined,
          placementIdempotencyKey: idempotencyKey,
        });
        const result = yield* call(place, resource.workspaceId, resource.file, {
          idempotencyKey,
          signal: controller.signal,
          current: isCurrent,
          // Progress remains transport-local for now; the canonical pending pill is indeterminate.
          onProgress: () => {},
        });
        if (!current()) return;
        const changed = yield* patch(resource, id, {
          placementStatus: 'placed',
          placementProgress: undefined,
          attachmentId: result.attachmentId,
          label: result.fileName,
          path: result.path,
          attachmentSize: result.size,
          attachmentMimeType: result.mimeType ?? resource.file.type,
          ...(resource.file.type.startsWith('image/')
            ? { imageMimeType: result.mimeType ?? resource.file.type }
            : {}),
        });
        if (changed) yield* persist(ownerId, resource.workspaceId, resource.agentId);
        // A registered attachment no longer needs local File bytes or a retry lease.
        owners.get(ownerId)?.delete(id);
      } catch {
        if (!ownsResource()) return;
        const changed = yield* patch(
          resource,
          id,
          {
            placementStatus: 'failed',
            placementProgress: undefined,
            placementError: m.chat_richInput_attachmentPlaceFailed_error({
              name: resource.file.name,
            }),
          },
          true,
        );
        // A socket can fail before principal re-admission. Retire the existing
        // pill locally, but never persist through an unadmitted/replacement owner.
        if (changed && isCurrent.sameAuthority())
          yield* persist(ownerId, resource.workspaceId, resource.agentId);
      } finally {
        if (yield* cancelled()) controller.abort();
        if (resource.aborter === controller) resource.aborter = undefined;
      }
    }

    function* selected({
      payload: [ownerId, workspaceId, agentId, files],
    }: ReturnType<typeof composerAttachmentsSelected>): SagaGenerator<void> {
      const isCurrent = captureOwnership(workspaceId, agentId);
      if (!isCurrent()) return;
      const resources = owners.get(ownerId) ?? new Map<string, Resource>();
      owners.set(ownerId, resources);
      const items = [...(yield* selectItems.effect(workspaceId, agentId))];
      const incoming: Array<[string, Resource]> = [];
      for (const file of files) {
        if (
          [...resources.values()].some(
            (r) =>
              r.file.name === file.name &&
              r.file.size === file.size &&
              r.file.lastModified === file.lastModified,
          )
        )
          continue;
        const id = crypto.randomUUID();
        const resource = { file, workspaceId, agentId, isCurrent };
        resources.set(id, resource);
        incoming.push([id, resource]);
        items.push({
          id,
          type: 'file',
          label: file.name,
          attachmentMimeType: file.type,
          attachmentSize: file.size,
          placementStatus: 'placing',
          placementIdempotencyKey: crypto.randomUUID(),
        });
      }
      yield* put(setComposerContextItems(workspaceId, agentId, items, true));
      yield* persist(ownerId, workspaceId, agentId);
      for (const [id, resource] of incoming) yield* fork(upload, ownerId, id, resource);
    }

    function* remove({
      payload: [ownerId, workspaceId, agentId, id],
    }: ReturnType<typeof composerAttachmentRemoved>): SagaGenerator<void> {
      const resource = owners.get(ownerId)?.get(id);
      owners.get(ownerId)?.delete(id);
      resource?.aborter?.abort();
      if (!captureOwnership(workspaceId, agentId)()) return;
      const items = yield* selectItems.effect(workspaceId, agentId);
      yield* put(
        setComposerContextItems(
          workspaceId,
          agentId,
          items.filter((item) => item.id !== id),
          true,
        ),
      );
      yield* persist(ownerId, workspaceId, agentId);
    }

    function* retry({
      payload: [ownerId, workspaceId, agentId, id],
    }: ReturnType<typeof composerAttachmentRetryRequested>): SagaGenerator<void> {
      const resource = owners.get(ownerId)?.get(id);
      if (
        !resource ||
        resource.workspaceId !== workspaceId ||
        resource.agentId !== agentId ||
        resource.aborter ||
        !resource.isCurrent.sameAuthority()
      )
        return;
      resource.isCurrent = captureOwnership(workspaceId, agentId);
      yield* fork(upload, ownerId, id, resource);
    }

    function* release({
      payload: [ownerId],
    }: ReturnType<typeof composerAttachmentsReleased>): SagaGenerator<void> {
      const resources = owners.get(ownerId);
      owners.delete(ownerId);
      for (const [id, resource] of resources ?? []) {
        resource.aborter?.abort();
        const changed = yield* patch(
          resource,
          id,
          {
            placementStatus: 'failed',
            placementProgress: undefined,
            placementIdempotencyKey: undefined,
          },
          true,
        );
        if (changed && resource.isCurrent.sameAuthority())
          yield* persist(ownerId, resource.workspaceId, resource.agentId);
      }
    }

    try {
      const watcher = yield* takeEvery(composerAttachmentsSelected, selected);
      yield* takeEvery(composerAttachmentRemoved, remove);
      yield* takeEvery(composerAttachmentRetryRequested, retry);
      yield* takeEvery(composerAttachmentsReleased, release);
      // Keep resource ownership attached to the root saga's cancellation lifetime.
      yield* join(watcher);
    } finally {
      for (const resources of owners.values())
        for (const resource of resources.values()) resource.aborter?.abort();
      owners.clear();
    }
  };
}
