/**
 * Model/effort writes for a specialist in Settings.
 *
 * Picking a model and then a reasoning level issues two full-file writes
 * before the specialist list has refetched. Each write must start from the
 * newest pick (not the stored file, which still predates it), and the editor
 * must not resync from a refetch that answers an earlier write.
 *
 * Dependency-light on purpose: callers pass the stored file, the pick, and
 * the dispatched write promise — no store or selector imports.
 */
import type { Specialist } from '$lib/constants/specialists';
import type {
  FileSpecialist,
  FileSpecialistReference,
  FileSpecialistWritePayload,
} from '$store/renderer/slices/specialists/specialists-slice';

export interface ModelPin {
  codingAgent?: string;
  model?: string;
}

/** The user override a built-in export creates, before the store lists it. */
export function builtInExport(
  specialist: Specialist,
  behaviorPrompt: string,
  pin: ModelPin,
  reasoningEffort: string | undefined,
): FileSpecialist {
  return {
    id: specialist.id,
    name: specialist.name,
    description: specialist.description,
    codingAgent: pin.codingAgent,
    model: pin.model ?? '',
    roleReminder: specialist.roleReminder,
    modelOptions: specialist.modelOptions,
    reasoningEffort,
    behaviorPrompt: behaviorPrompt || specialist.defaultBehaviorPrompt,
    source: 'user',
    filePath: '',
  };
}

/** Rewrite `file` with `pin` and `reasoningEffort`, or delete it when redundant. */
export function modelSelectionWrite(
  file: FileSpecialist,
  pin: ModelPin,
  reasoningEffort: string | undefined,
  redundant: boolean,
  owner: { workspaceId?: string; workspacePath?: string },
):
  | { kind: 'delete'; ref: FileSpecialistReference }
  | { kind: 'save'; payload: FileSpecialistWritePayload } {
  if (redundant)
    return {
      kind: 'delete',
      // The pick's own export may not have landed; a missing file is the goal.
      ref: { id: file.id, scope: file.source, ...owner, allowMissing: true },
    };
  return {
    kind: 'save',
    payload: {
      id: file.id,
      name: file.name,
      description: file.description,
      codingAgent: pin.codingAgent,
      model: pin.model,
      roleReminder: file.roleReminder,
      modelOptions: file.modelOptions,
      reasoningEffort,
      behaviorPrompt: file.behaviorPrompt,
      scope: file.source,
      ...owner,
    },
  };
}

/**
 * Counts unsettled writes per specialist. `onFailedSettle` runs once the
 * last pending write for an id settles if any of them failed: a failure
 * leaves the store unchanged, so no refetch will resync the editor.
 */
export function createPendingWrites(onFailedSettle: (id: string) => void) {
  const pending = new Map<string, { count: number; failed: boolean }>();
  return {
    has: (id: string) => pending.has(id),
    track(id: string, result: unknown) {
      const entry = pending.get(id) ?? { count: 0, failed: false };
      entry.count++;
      pending.set(id, entry);
      void Promise.resolve(result)
        .catch(() => {
          entry.failed = true;
        })
        .finally(() => {
          if (--entry.count > 0) return;
          pending.delete(id);
          if (entry.failed) onFailedSettle(id);
        });
    },
  };
}
