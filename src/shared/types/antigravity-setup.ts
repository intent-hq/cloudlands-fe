import { z } from 'zod';

export const setupFailureSchema = z.enum([
  'unsupportedHost',
  'downloadFailed',
  'invalidArchive',
  'integrityFailed',
  'signatureFailed',
  'diskError',
  'cancelled',
  'timedOut',
  'invalidCustomPath',
  'authenticationCheckFailed',
  'signInFailed',
  'browserUnavailable',
  'modelsUnavailable',
]);

const phaseSchema = z.discriminatedUnion('phase', [
  z.object({ phase: z.literal('idle') }),
  z.object({ phase: z.literal('checking') }),
  z.object({
    phase: z.literal('downloading'),
    received: z.number().nonnegative(),
    total: z.number().positive(),
  }),
  z.object({ phase: z.literal('verifying') }),
  z.object({ phase: z.literal('signInRequired') }),
  z.object({ phase: z.literal('signingIn') }),
  z.object({ phase: z.literal('connected'), modelCount: z.number().int().positive() }),
  z.object({ phase: z.literal('cancelled') }),
  z.object({ phase: z.literal('failed'), code: setupFailureSchema }),
]);

// Construct a new object from allowlisted fields. Unknown payload members,
// including a URL from a malformed peer, never enter renderer state.
export const antigravitySetupStatusSchema = z
  .object({
    operationId: z.string().max(100).nullable(),
    supported: z.boolean(),
    cliDetected: z.boolean(),
    runtimeInstalled: z.boolean(),
  })
  .and(phaseSchema);

export type AntigravitySetupStatus = z.infer<typeof antigravitySetupStatusSchema>;
export type AntigravitySetupAction = 'status' | 'start' | 'login' | 'cancel';
export type AntigravitySetupClientError =
  | 'remoteHost'
  | 'unsupportedHost'
  | 'updateRequired'
  | 'connectionLost'
  | 'invalidResponse'
  | 'invalidOperation'
  | 'backendChanged';
export type AntigravitySetupResult =
  { ok: true; status: AntigravitySetupStatus } | { ok: false; code: AntigravitySetupClientError };

export function isAntigravitySetupBusy(status: AntigravitySetupStatus): boolean {
  return ['checking', 'downloading', 'verifying', 'signingIn'].includes(status.phase);
}
