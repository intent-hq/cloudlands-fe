import type {
  PermissionOutcome,
  PermissionResponder,
  RespondPermissionResult,
} from '../permission-client-types';
import type { BackendTransport } from './backend-transport-types';

/** Bind the shared permission response client without sending requests or starting a host. */
export function createBackendPermissionClient(
  backendRequest: BackendTransport['request'],
): PermissionResponder {
  return {
    async respondPermission(
      requestId: string,
      outcome: PermissionOutcome,
      workspaceId?: string,
    ): Promise<RespondPermissionResult> {
      // `agent.respondPermission` (PROTOCOL §8) forwards the caller's outcome to
      // the blocked provider and emits `agent:permission:resolved` so any other
      // client can clear its inline prompt. The daemon returns `{ resolved }` —
      // `false` when the pending prompt is already gone (5-min timeout or an
      // earlier response) — which we surface on top of MutationResult so callers
      // decide whether to keep the local slice entry visible for a retry.
      try {
        const result = await backendRequest<{ resolved?: unknown } | undefined>(
          'agent.respondPermission',
          { requestId, outcome, ...(workspaceId !== undefined ? { workspaceId } : {}) },
        );
        const resolved = typeof result?.resolved === 'boolean' ? result.resolved : undefined;
        return resolved !== undefined ? { success: true, resolved } : { success: true };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}
