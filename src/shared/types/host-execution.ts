import { z } from 'zod';

export const gitCredentialPolicySchema = z.object({
  provider: z.literal('github'),
  protocol: z.literal('https'),
  host: z.literal('github.com'),
  managedHelperEnabled: z.boolean(),
  setting: z.literal('sourceControl.github.exposeGitCredentialToChildren'),
});

/** The allowlisted projection in PROTOCOL §5.49; configured is not authorized. */
export const hostExecutionContextSchema = z.object({
  defaultProviderId: z.string().nullable(),
  defaultModelId: z.string().nullable(),
  // Older hosts may omit the projection: never infer member choices from local settings.
  enabledProviderIds: z.array(z.string().min(1)).optional(),
  repositoryConnections: z.array(
    z.object({
      provider: z.enum(['github', 'gitlab']),
      host: z.string(),
      configured: z.boolean(),
    }),
  ),
  gitCredentialPolicy: gitCredentialPolicySchema,
});

export type HostExecutionContext = z.infer<typeof hostExecutionContextSchema>;

export const executionAuthorizationSchema = z.object({
  resource: z.enum(['git', 'ai']),
  reason: z.enum(['missing', 'rejected', 'insufficient-scope']),
  providerId: z.string().nullable(),
  host: z.string().nullable(),
  recovery: z.object({
    actor: z.literal('host-owner'),
    action: z.enum(['check-git-authorization', 'check-ai-authorization']),
    setting: z.literal('sourceControl.github.exposeGitCredentialToChildren').optional(),
  }),
});
