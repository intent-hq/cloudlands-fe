import { z } from 'zod';
import {
  isCanonicalGitLabInstance,
  parseGitLabProjectLink,
  parseGitLabResourceLink,
} from '$shared/utils/gitlab-resource-link';
import { CheckoutProjectSchema } from '$shared/types/repository-checkout';
import type { RepositoryCheckoutDraft } from './repository-checkout-types';

const draftSchema = z
  .object({
    instanceBaseUrl: z.string().refine(isCanonicalGitLabInstance),
    projectPath: CheckoutProjectSchema.shape.projectPath.optional(),
    branch: z
      .string()
      .min(1)
      .refine((value) => !/[\u0000-\u001f\u007f]/.test(value))
      .optional(),
    mode: z.enum(['direct', 'cached']).optional(),
    contextUrl: z.string().optional(),
  })
  .strip();

/** Persist selection intent only. Never restore a lease, revision or claimed HEAD. */
export function readRepositoryCheckoutDraft(value: unknown): RepositoryCheckoutDraft | undefined {
  const parsed = draftSchema.safeParse(value);
  if (!parsed.success) return undefined;
  const draft = parsed.data;
  if (draft.contextUrl) {
    const target =
      parseGitLabResourceLink(draft.contextUrl, [
        { provider: 'gitlab', instanceBaseUrl: draft.instanceBaseUrl },
      ])?.repository ?? parseGitLabProjectLink(draft.contextUrl, draft.instanceBaseUrl);
    if (
      !target ||
      !CheckoutProjectSchema.shape.projectPath.safeParse(target.projectPath).success ||
      (draft.projectPath && target.projectPath !== draft.projectPath)
    )
      return undefined;
    return { ...draft, projectPath: target.projectPath };
  }
  return draft;
}
