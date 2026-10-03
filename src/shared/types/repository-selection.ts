/** Native selection observations; the Store owns the actual editing snapshot. */
import { z } from 'zod';
import {
  ExecutionScopeSchema,
  RepositoryContextRevisionSchema,
  RepositoryRootIdentitySchema,
  RepositorySavedChoiceSchema,
  type RepositoryRootIdentity,
} from './repository-context';

const counter = RepositoryContextRevisionSchema.shape.sequence;
const id = z.string().min(1).max(4096);
export const SelectionRootSchema = z.discriminatedUnion('kind', [
  RepositoryRootIdentitySchema.options[0].strict(),
  RepositoryRootIdentitySchema.options[1].strict(),
]);
export const SelectionQuerySchema = z.object({ workspaceId: id, gitRootId: id.nullish() }).strict();
const choice = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('automatic') }).strict(),
  z
    .object({
      mode: z.literal('explicit-remote'),
      remoteName: z
        .string()
        .min(1)
        .refine(
          (name) =>
            !/^\p{White_Space}|\p{White_Space}$/u.test(name) &&
            !/\p{Cc}/u.test(name) &&
            !/[\uD800-\uDFFF]/u.test(name) &&
            new TextEncoder().encode(name).length <= 1024,
        ),
    })
    .strict(),
]);
export const SelectionCommandSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('save'), choice }).strict(),
  z.object({ kind: z.literal('reset') }).strict(),
]);
const snapshot = z
  .object({
    root: SelectionRootSchema,
    rootIncarnation: counter,
    selectionRevision: counter,
    selection: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('neverSaved') }).strict(),
      z.object({ kind: z.literal('reset') }).strict(),
      z.object({ kind: z.literal('saved'), value: RepositorySavedChoiceSchema }).strict(),
    ]),
  })
  .strict();
export const SelectionPreviewSchema = z
  .object({
    scope: ExecutionScopeSchema.strict(),
    root: SelectionRootSchema,
    snapshot,
    expiresAfterMs: z.literal(300_000),
  })
  .strict();
export const SelectionCaptureSchema = SelectionPreviewSchema.extend({
  selectionId: id,
  retirementSequence: counter,
}).strict();
const receipt = z
  .object({
    result: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('applied'), snapshot }).strict(),
      z.object({ kind: z.literal('unchanged'), snapshot }).strict(),
      z.object({ kind: z.literal('conflict'), snapshot }).strict(),
      z.object({ kind: z.literal('missingRoot') }).strict(),
      z
        .object({
          kind: z.literal('failed'),
          code: z.enum([
            'admission-retired',
            'authority-unavailable',
            'storage-failed',
            'completion-unobserved',
          ]),
        })
        .strict(),
    ]),
    persistence: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('notAttempted') }).strict(),
      z.object({ kind: z.literal('noEffect') }).strict(),
      z.object({ kind: z.literal('committed'), selectionRevision: counter }).strict(),
      z.object({ kind: z.literal('unknown') }).strict(),
    ]),
  })
  .strict();
const attempt = z.discriminatedUnion('status', [
  z.object({ status: z.literal('notStarted') }).strict(),
  z.object({ status: z.literal('pending') }).strict(),
  z.object({ status: z.literal('settled'), receipt }).strict(),
]);
export const SelectionAttemptSchema = z
  .object({ selectionId: id, root: SelectionRootSchema, attempt })
  .strict();
export const SelectionNoticeSchema = z
  .object({
    selectionIds: z.array(id).max(64),
    sequence: counter,
    allRetired: z.boolean(),
    terminal: z.boolean(),
  })
  .strict();
export const SelectionObservationSchema = z
  .object({
    current: z.boolean(),
    attempt: attempt.nullable(),
    uncertain: z.boolean(),
  })
  .strict();
export type SelectionCommand = z.infer<typeof SelectionCommandSchema>;
export type SelectionPreview = z.infer<typeof SelectionPreviewSchema>;
export type SelectionObservation = z.infer<typeof SelectionObservationSchema>;
export type SelectionRetirement = 'admission' | 'closed';

/** Original UI correlation only; never authority or a server reference. */
export interface RepositorySelectionEdit {
  readonly root: RepositoryRootIdentity;
  readonly editId: string;
  readonly admission: string | null;
}
export interface RepositorySelectionSession {
  readonly preview: SelectionPreview;
  onRetired(handler: (kind: SelectionRetirement) => void): () => void;
  confirm(command: SelectionCommand): Promise<SelectionObservation>;
  reconcile(): Promise<SelectionObservation>;
  release(): Promise<void>;
}
