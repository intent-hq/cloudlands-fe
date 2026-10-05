import { z } from 'zod';
import { isCanonicalGitLabInstance } from '$shared/utils/gitlab-resource-link';

const nonempty = z.string().min(1);
const httpsUrl = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  });
const instanceUrl = httpsUrl.refine((value) => {
  return isCanonicalGitLabInstance(value);
});
const milliseconds = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const projectPath = z
  .string()
  .max(1024)
  .regex(/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+$/)
  .refine((value) => value.split('/').every((part) => part !== '.' && part !== '..'));
const commitSha = z.string().regex(/^[0-9a-fA-F]{40}$/);

export const CheckoutBindingSchema = z
  .object({
    checkoutId: nonempty,
    revision: nonempty,
  })
  .strict();

export const CheckoutCaptureQuerySchema = z
  .object({
    provider: z.literal('gitlab'),
    instanceBaseUrl: instanceUrl.optional(),
  })
  .strict();

export const CheckoutCaptureSchema = CheckoutBindingSchema.extend({
  provider: z.literal('gitlab'),
  instanceBaseUrl: instanceUrl,
  expiresAfterMs: milliseconds,
}).strict();

export const CheckoutProjectSchema = z
  .object({
    projectPath,
    name: z.string(),
    namespace: z.string(),
    webUrl: httpsUrl,
    cloneUrl: httpsUrl,
    defaultBranch: nonempty.optional(),
  })
  .strict();

const CheckoutBranchSchema = z
  .object({
    name: nonempty,
    commitSha,
    protected: z.boolean().optional(),
  })
  .strict();

export const CheckoutPageQuerySchema = z
  .object({
    query: z
      .string()
      .trim()
      .refine(
        (value) =>
          new TextEncoder().encode(value).length <= 256 && !/[\u0000-\u001f\u007f]/.test(value),
      )
      .optional(),
    cursor: nonempty.optional(),
    limit: z.number().int().positive().max(100).optional(),
  })
  .strict();

export const CheckoutProjectQuerySchema = z.union([
  z.object({ projectPath }).strict(),
  z.object({ url: httpsUrl }).strict(),
]);

export const CheckoutBranchesQuerySchema = CheckoutPageQuerySchema.extend({
  projectPath,
  cached: z.boolean().optional(),
}).strict();

export const CheckoutSelectionSchema = CheckoutBindingSchema.extend({
  projectPath,
  branch: nonempty,
  commitSha,
  mode: z.enum(['direct', 'cached']),
}).strict();

export const CheckoutProjectsSchema = z
  .object({
    items: z.array(CheckoutProjectSchema),
    nextCursor: nonempty.optional(),
  })
  .strict();

export const CheckoutProjectDetailSchema = z
  .object({
    project: CheckoutProjectSchema,
    contextUrl: httpsUrl.optional(),
  })
  .strict();

export const CheckoutBranchesSchema = z
  .object({
    items: z.array(CheckoutBranchSchema),
    nextCursor: nonempty.optional(),
    defaultBranch: nonempty.optional(),
    cached: z.boolean(),
  })
  .strict();

export const CheckoutWarmSchema = z
  .object({
    projectPath,
    branch: nonempty,
    commitSha,
    cached: z.boolean(),
  })
  .strict();

const CheckoutUnavailableSchema = z
  .object({
    status: z.literal('unavailable'),
    reason: z.enum([
      'disabled',
      'not-connected',
      'access-denied',
      'rate-limited',
      'unreachable',
      'retired',
      'not-found',
      'invalid-target',
      'empty-repository',
      'branch-changed',
    ]),
    retryAfterMs: milliseconds.optional(),
  })
  .strict();

export function checkoutResultSchema<T extends z.ZodTypeAny>(value: T) {
  return z.discriminatedUnion('status', [
    z.object({ status: z.literal('ready'), value }).strict(),
    CheckoutUnavailableSchema,
  ]);
}

export type CheckoutCaptureQuery = z.infer<typeof CheckoutCaptureQuerySchema>;
export type CheckoutCapture = z.infer<typeof CheckoutCaptureSchema>;
export type CheckoutProject = z.infer<typeof CheckoutProjectSchema>;
export type CheckoutBranch = z.infer<typeof CheckoutBranchSchema>;
export type CheckoutPageQuery = z.infer<typeof CheckoutPageQuerySchema>;
export type CheckoutProjectQuery = z.infer<typeof CheckoutProjectQuerySchema>;
export type CheckoutBranchesQuery = z.infer<typeof CheckoutBranchesQuerySchema>;
export type CheckoutSelection = z.infer<typeof CheckoutSelectionSchema>;
export type CheckoutProjects = z.infer<typeof CheckoutProjectsSchema>;
export type CheckoutProjectDetail = z.infer<typeof CheckoutProjectDetailSchema>;
export type CheckoutBranches = z.infer<typeof CheckoutBranchesSchema>;
type CheckoutWarm = z.infer<typeof CheckoutWarmSchema>;
export type CheckoutUnavailable = z.infer<typeof CheckoutUnavailableSchema>;
export type CheckoutResult<T> = { status: 'ready'; value: T } | CheckoutUnavailable;

/** Keep the discriminant concrete when the payload schema is generic. */
export function parseCheckoutResult<T>(schema: z.ZodType<T>, input: unknown): CheckoutResult<T> {
  const envelope = z
    .object({ status: z.enum(['ready', 'unavailable']) })
    .passthrough()
    .parse(input);
  if (envelope.status === 'unavailable') return CheckoutUnavailableSchema.parse(input);
  const result = z
    .object({ status: z.literal('ready'), value: z.unknown() })
    .strict()
    .parse(input);
  return { status: 'ready', value: schema.parse(result.value) };
}

/** One original bridge/socket/host lifetime. Never persisted as a draft or recaptured on retry. */
export interface RepositoryCheckoutSession {
  readonly capture: CheckoutCapture;
  onRetired(listener: () => void): () => void;
  projects(query: CheckoutPageQuery): Promise<CheckoutResult<CheckoutProjects>>;
  project(query: CheckoutProjectQuery): Promise<CheckoutResult<CheckoutProjectDetail>>;
  branches(query: CheckoutBranchesQuery): Promise<CheckoutResult<CheckoutBranches>>;
  warm(selection: CheckoutSelection): Promise<CheckoutResult<CheckoutWarm>>;
  release(): Promise<void>;
}
