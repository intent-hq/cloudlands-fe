import type { ReferencePrimitive } from '$shared/types/notes-primitives';

export type ResolvedReferenceSnapshot = {
  code: string;
  languageId: string;
  range: { startLine: number; endLine: number } | null;
};

/** Resolve the persisted snapshot used by ReferenceBlock without reading the working tree. */
export function resolveReferenceSnapshot(
  primitive: ReferencePrimitive,
): ResolvedReferenceSnapshot | null {
  if (!primitive.snapshot) return null;
  return {
    code: primitive.snapshot.code,
    languageId:
      primitive.snapshot.languageId ||
      (primitive.snapshot as { language?: string }).language ||
      'text',
    range: primitive.target?.range ?? null,
  };
}
