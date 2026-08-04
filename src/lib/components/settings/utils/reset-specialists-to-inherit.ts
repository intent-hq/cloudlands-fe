/**
 * Reset-to-inherit payload builder for the Settings → AI Behavior
 * "Reset all to default" action.
 *
 * Only file specialists that pin an explicit frontmatter `model` need a
 * write: clearing the key makes them inherit the global default
 * (inherit-on-omit, PROTOCOL §5.11). Built-ins without an override
 * file already inherit and are not in the file-specialist list, so no
 * override file is ever created by this action.
 */
import type {
  FileSpecialist,
  FileSpecialistWritePayload,
} from '$store/renderer/slices/specialists/specialists-slice';

/** True when any file specialist pins an explicit model. */
export function hasExplicitModelPin(fileSpecialists: FileSpecialist[]): boolean {
  return fileSpecialists.some((s) => !!s.model);
}

/**
 * Build one clearing `saveFileSpecialist` payload per pinned file specialist,
 * preserving every other field. Unpinned specialists are skipped entirely.
 */
export function buildResetToInheritPayloads(
  fileSpecialists: FileSpecialist[],
  getWorkspacePath: () => string | undefined,
): FileSpecialistWritePayload[] {
  const payloads: FileSpecialistWritePayload[] = [];
  for (const fileSpec of fileSpecialists) {
    if (!fileSpec.model) continue;
    payloads.push({
      id: fileSpec.id,
      name: fileSpec.name,
      description: fileSpec.description,
      codingAgent: fileSpec.codingAgent,
      model: undefined,
      roleReminder: fileSpec.roleReminder,
      behaviorPrompt: fileSpec.behaviorPrompt,
      scope: fileSpec.source,
      workspacePath: fileSpec.source === 'project' ? getWorkspacePath() : undefined,
    });
  }
  return payloads;
}
