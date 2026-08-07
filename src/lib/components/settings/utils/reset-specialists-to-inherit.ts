/**
 * Reset-to-inherit payload builder for the Settings → AI Behavior
 * "Reset all to default" action.
 *
 * Only file specialists that pin an explicit frontmatter `model` need a
 * write: clearing the key makes them inherit the global default
 * (inherit-on-omit, PROTOCOL §5.11). Built-ins without an override
 * file already inherit and are not in the file-specialist list, so no
 * override file is ever created by this action.
 *
 * A pinned user-scope override of a built-in that would become identical
 * to the bundled defaults once the pin is cleared is classified as a
 * **delete** instead of a clearing save — leaving the redundant file
 * behind would keep the built-in reading as "Modified" (monorepo#1450).
 */
import type { Specialist } from '$lib/constants/specialists';
import type {
  FileSpecialist,
  FileSpecialistReference,
  FileSpecialistWritePayload,
} from '$store/renderer/slices/specialists/specialists-slice';
import { isRedundantBuiltInOverride } from './builtin-override-redundancy';

export interface ResetToInheritPayloads {
  /** Clearing `saveFileSpecialist` payloads (pin cleared, other fields kept). */
  saves: FileSpecialistWritePayload[];
  /** `deleteFileSpecialist` references for redundant built-in overrides. */
  deletes: FileSpecialistReference[];
}

/** True when any file specialist pins an explicit model. */
export function hasExplicitModelPin(fileSpecialists: FileSpecialist[]): boolean {
  return fileSpecialists.some((s) => !!s.model);
}

/**
 * Classify every pinned file specialist as either a clearing save
 * (preserving every other field) or — for user-scope built-in overrides
 * that are redundant once the pin is cleared — a delete. Unpinned
 * specialists are skipped entirely. Project-scoped specialists are also
 * skipped when no workspace path can be resolved, since
 * `writeSpecialistFile` rejects project writes without one.
 */
export function buildResetToInheritPayloads(
  fileSpecialists: FileSpecialist[],
  bundledSpecialists: Specialist[],
  getWorkspacePath: () => string | undefined,
): ResetToInheritPayloads {
  const saves: FileSpecialistWritePayload[] = [];
  const deletes: FileSpecialistReference[] = [];
  for (const fileSpec of fileSpecialists) {
    if (!fileSpec.model) continue;
    let workspacePath: string | undefined;
    if (fileSpec.source === 'project') {
      workspacePath = getWorkspacePath();
      if (!workspacePath) continue;
    }
    if (isRedundantBuiltInOverride(fileSpec, bundledSpecialists, { ignoreModelPin: true })) {
      deletes.push({ id: fileSpec.id, scope: fileSpec.source });
      continue;
    }
    saves.push({
      id: fileSpec.id,
      name: fileSpec.name,
      description: fileSpec.description,
      codingAgent: fileSpec.codingAgent,
      model: undefined,
      roleReminder: fileSpec.roleReminder,
      modelOptions: fileSpec.modelOptions,
      reasoningEffort: fileSpec.reasoningEffort,
      behaviorPrompt: fileSpec.behaviorPrompt,
      scope: fileSpec.source,
      workspacePath,
    });
  }
  return { saves, deletes };
}
