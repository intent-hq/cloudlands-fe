/**
 * Model/effort writes for a specialist in Settings.
 *
 * Picking a model and then a reasoning level issues full-file writes before
 * the specialist lists have refetched. The editor keeps the newest pick per
 * specialist as a {@link ModelIntent}: every write (including prompt, name,
 * description and model-option saves) carries it, and the picker shows it
 * until the stored file the editor writes from reflects it. A refetch that
 * answers an EARLIER write therefore cannot revert or briefly hide the pick.
 *
 * Dependency-light on purpose: callers pass the stored file, the intent and
 * the dispatched write promise — no store or selector imports.
 */
import type { Specialist } from '$lib/constants/specialists';
import type {
  FileSpecialist,
  FileSpecialistReference,
  FileSpecialistWritePayload,
} from '$store/renderer/slices/specialists/specialists-slice';

/** The model fields of the newest pick; `deleted` = the override is being removed. */
export interface ModelIntent {
  codingAgent?: string;
  model?: string;
  reasoningEffort?: string;
  deleted?: boolean;
}

/** The model fields a stored override file already carries. */
export function storedModelIntent(file: FileSpecialist): ModelIntent {
  return {
    codingAgent: file.codingAgent || undefined,
    model: file.model || undefined,
    reasoningEffort: file.reasoningEffort || undefined,
  };
}

/**
 * Whether the stored file reflects the intent. Omitted keys inherit from the
 * tiers below on read (PROTOCOL §5.11), so only set intent fields compare.
 */
export function intentMatches(intent: ModelIntent, file: FileSpecialist | undefined): boolean {
  if (intent.deleted) return !file;
  if (!file) return false;
  const stored = storedModelIntent(file);
  return (['codingAgent', 'model', 'reasoningEffort'] as const).every(
    (key) => intent[key] === undefined || intent[key] === stored[key],
  );
}

/** Carry the intent's model fields on any full-file write for the same specialist. */
export function applyModelIntent<T extends FileSpecialistWritePayload>(
  payload: T,
  intent: ModelIntent | undefined,
): T {
  if (!intent) return payload;
  // A pending delete reverts to inheritance: omit every model key.
  const fields = intent.deleted ? {} : intent;
  return {
    ...payload,
    codingAgent: fields.codingAgent,
    model: fields.model,
    reasoningEffort: fields.reasoningEffort,
  };
}

/** The user override a built-in export creates, before the store lists it. */
export function builtInExport(specialist: Specialist, behaviorPrompt: string): FileSpecialist {
  return {
    id: specialist.id,
    name: specialist.name,
    description: specialist.description,
    model: '',
    roleReminder: specialist.roleReminder,
    modelOptions: specialist.modelOptions,
    reasoningEffort: specialist.reasoningEffort,
    behaviorPrompt: behaviorPrompt || specialist.defaultBehaviorPrompt,
    source: 'user',
    filePath: '',
  };
}

/** Rewrite `file` with the intent's model fields, or delete it for a `deleted` intent. */
export function modelSelectionWrite(
  file: FileSpecialist,
  intent: ModelIntent,
  owner: { workspaceId?: string; workspacePath?: string },
):
  | { kind: 'delete'; ref: FileSpecialistReference }
  | { kind: 'save'; payload: FileSpecialistWritePayload } {
  if (intent.deleted)
    return {
      kind: 'delete',
      // The pick's own export may not have landed; a missing file is the goal.
      ref: { id: file.id, scope: file.source, ...owner, allowMissing: true },
    };
  return {
    kind: 'save',
    payload: applyModelIntent(
      {
        id: file.id,
        name: file.name,
        description: file.description,
        roleReminder: file.roleReminder,
        modelOptions: file.modelOptions,
        behaviorPrompt: file.behaviorPrompt,
        scope: file.source,
        ...owner,
      },
      intent,
    ),
  };
}

/**
 * Counts unsettled writes per specialist and reports when the last pending
 * write for an id settles, and whether any of them failed.
 */
export function createPendingWrites(onSettled: (id: string, failed: boolean) => void) {
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
          onSettled(id, entry.failed);
        });
    },
  };
}
